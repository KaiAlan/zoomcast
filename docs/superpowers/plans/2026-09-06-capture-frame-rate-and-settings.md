# Capture frame rate, and a settings window

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record at 60fps by default instead of 30, and give the app its first
real settings surface so that choice — and the ones after it — belong to the
user rather than to a constant.

**Architecture:** App settings are a new concept, deliberately separate from
`Project`: a project describes one recording and travels inside its bundle,
while capture frame rate has to be known *before* any project exists. The
schema and its normaliser are pure and live in `src/shared/settings/`; the main
process owns the file at `userData/settings.json`; the renderer gets a small
IPC pair and a `#settings` route, opened from the tray.

**Tech Stack:** TypeScript, Electron (main/preload/renderer), React, vitest.

**Spec:** No spec section covers this. It comes from a measurement and a user
decision, both recorded under "Why 60" below.

## Global Constraints

- `src/shared/` must not import electron, touch the DOM, or hit the filesystem.
  That purity is why the tests run in plain node.
- Everything runs **natively on Windows in PowerShell**, never under WSL:
  `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"`.
- Main-process stdout is invisible on Windows. Use `logDiag()` from
  `src/main/log.ts`, never bare `console.error`.
- Compute the preload path with `preloadPath()` from `src/main/windows.ts`.
  Source layout and build output have different shapes.
- ESM (`.mjs`) preload requires `sandbox: false`. With the sandbox on, the
  preload silently never runs and `window.zoomcast` is undefined.
- `window-all-closed` must NOT quit. This is a tray app; a settings window
  closing must not end the process.
- The single-instance lock skips headless modes. A new window must not change
  that.
- Baseline before starting: 230 tests / 31 files, typecheck silent,
  `verify:decode` 6/6, `verify:parity` 20/20.

## Why 60

Measured on the development machine, 1080p, gdigrab, on 2026-09-06:

| requested | actually recorded |
| --- | --- |
| 30 (what the app asks for today) | 27.3fps |
| **60** | **44fps** |

`GDIGRAB_FPS = 30` in `src/main/capture/SessionController.ts:17` caps every
recording, and `src/main/capture/ScreenSource.ts`'s comment explains the choice:
gdigrab "realistically caps around 30fps at 1080p". That is measurably wrong
here — it manages 44 when asked for 60.

This matters beyond frame rate. The phase C evidence note
(`docs/superpowers/notes/2026-09-05-zoom-complaint-evidence.md`) attributes part
of the user's "the motion isn't smooth" to the source being captured at 17.7fps,
and marks it **not fixable by tuning**. That conclusion rested on the 30fps
request. It should be revisited once this lands.

**The costs are real and should not be hidden.** Roughly 1.6x the frames means
roughly 1.6x the file size and more CPU during capture, on a path that is
already CPU-bound because it is GDI readback. That is exactly why 30 stays
available rather than being removed.

## Decisions

- **Settings are app-level, not project-level.** `normalizeProject` is not the
  model to extend; capture frame rate applies before a project exists and must
  survive a bundle being deleted.
- **Same normalise-on-load discipline, though.** `normalizeSettings` merges
  field-by-field over defaults, so a hand-edited, truncated or older
  `settings.json` degrades to defaults rather than throwing. Anyone adding a
  field to `Settings` must add it to `normalizeSettings` too.
- **A window, not a tray submenu.** The user chose this. A tray checkbox would
  have been cheaper, but the surface has to hold an encoder choice, an output
  directory and the hotkey before long, and a submenu does not.
- **The window is a route on the existing renderer** (`#settings`), matching how
  `#shoot` and `#audio` already work, rather than a second HTML entry point.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/settings/types.ts` | **Create.** The `Settings` shape and `CAPTURE_FPS_CHOICES`. |
| `src/shared/settings/defaults.ts` | **Create.** `defaultSettings()`. |
| `src/shared/settings/migrate.ts` | **Create.** `normalizeSettings`, pure. |
| `src/shared/settings/migrate.test.ts` | **Create.** Node tests for the above. |
| `src/main/settingsStore.ts` | **Create.** Read/write `userData/settings.json`. |
| `src/main/capture/SessionController.ts` | **Modify.** Take the rate from settings. |
| `src/main/capture/ScreenSource.ts` | **Modify.** Correct the stale 30fps comment. |
| `src/shared/api.ts` | **Modify.** `getSettings` / `setSettings`. |
| `src/preload/index.ts` | **Modify.** Expose them. |
| `src/main/ipc.ts` | **Modify.** Handle them. |
| `src/main/index.ts` | **Modify.** `openSettings()` creating the `#settings` window. |
| `src/main/recording.ts` | **Modify.** Tray entry that opens it. |
| `src/renderer/ui/SettingsWindow.tsx` | **Create.** The panel. |
| `src/renderer/App.tsx` | **Modify.** Route `#settings`. |
| `src/renderer/ui/StylePanel.tsx` | **Modify.** Export fps as a choice. |

---

### Task 1: The settings shape, and a normaliser that cannot throw

**Files:**
- Create: `src/shared/settings/types.ts`, `src/shared/settings/defaults.ts`,
  `src/shared/settings/migrate.ts`
- Test: `src/shared/settings/migrate.test.ts`

**Interfaces:**
- Produces: `type Settings`, `CAPTURE_FPS_CHOICES`, `defaultSettings()`,
  `normalizeSettings(raw: unknown): Settings`. Tasks 2 and 5 consume all four.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/settings/migrate.test.ts
import { describe, expect, it } from "vitest";
import { defaultSettings } from "./defaults";
import { normalizeSettings } from "./migrate";

describe("normalizeSettings", () => {
  it("defaults captureFps to 60", () => {
    expect(defaultSettings().captureFps).toBe(60);
  });

  it("returns defaults for anything that is not an object", () => {
    for (const raw of [null, undefined, 3, "x", []]) {
      expect(normalizeSettings(raw)).toEqual(defaultSettings());
    }
  });

  it("keeps a valid stored value", () => {
    expect(normalizeSettings({ captureFps: 30 }).captureFps).toBe(30);
  });

  /**
   * A rate outside the offered set is not clamped to the nearest choice: it is
   * replaced. A hand-edited 144 would otherwise ask gdigrab for a rate it
   * cannot serve and silently produce a worse recording than either choice.
   */
  it("replaces an unoffered rate with the default", () => {
    for (const bad of [0, -1, 24, 144, Number.NaN, "60", null]) {
      expect(normalizeSettings({ captureFps: bad }).captureFps).toBe(60);
    }
  });

  it("ignores unknown keys rather than carrying them", () => {
    const s = normalizeSettings({ captureFps: 30, somethingOld: true });
    expect(s).toEqual({ captureFps: 30 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/settings/migrate.test.ts"
```

Expected: FAIL — `Cannot find module './defaults'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/settings/types.ts

/**
 * Capture rates offered to the user.
 *
 * Two, not a free number. gdigrab is CPU-bound GDI readback and does not
 * honour an arbitrary request — asking for 30 yielded 27fps on the development
 * machine and asking for 60 yielded 44 — so a free field would invite values
 * that quietly make recordings worse.
 */
export const CAPTURE_FPS_CHOICES = [30, 60] as const;

export type CaptureFps = (typeof CAPTURE_FPS_CHOICES)[number];

/**
 * App-level settings, deliberately separate from Project.
 *
 * A Project describes one recording and lives inside its bundle. These apply
 * before any project exists and must outlive every bundle.
 */
export type Settings = {
  captureFps: CaptureFps;
};
```

```ts
// src/shared/settings/defaults.ts
import type { Settings } from "./types";

/**
 * 60 by default. It is what the panel runs at, it is what makes the camera
 * look smooth, and gdigrab delivers about 44fps when asked for it against
 * about 27 when asked for 30. 30 stays available because the extra frames cost
 * file size and CPU on a path that is already CPU-bound.
 */
export function defaultSettings(): Settings {
  return { captureFps: 60 };
}
```

```ts
// src/shared/settings/migrate.ts
import { defaultSettings } from "./defaults";
import { CAPTURE_FPS_CHOICES, type CaptureFps, type Settings } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function captureFps(raw: unknown, fallback: CaptureFps): CaptureFps {
  return CAPTURE_FPS_CHOICES.find((c) => c === raw) ?? fallback;
}

/**
 * Merge field by field over the defaults, never cast.
 *
 * settings.json is a plain file a user can edit, an older build can have
 * written, or a crash can have truncated. Degrading to a default beats
 * throwing on startup in a tray app whose whole job is to be already running.
 */
export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!isRecord(raw)) return base;

  return { captureFps: captureFps(raw.captureFps, base.captureFps) };
}
```

- [ ] **Step 4: Run the test again**

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings
git commit -m "feat: app-level settings, with a normaliser that cannot throw"
```

---

### Task 2: The settings file, owned by main

**Files:**
- Create: `src/main/settingsStore.ts`

**Interfaces:**
- Consumes: `normalizeSettings`, `defaultSettings`, `Settings` (Task 1).
- Produces: `loadSettings(): Settings`, `saveSettings(s: Settings): void`.
  Tasks 3 and 4 consume both.

- [ ] **Step 1: Write it**

```ts
// src/main/settingsStore.ts
import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSettings } from "../shared/settings/migrate";
import type { Settings } from "../shared/settings/types";
import { logDiag } from "./log";

function file(): string {
  return join(app.getPath("userData"), "settings.json");
}

/**
 * Read on demand rather than cached at startup.
 *
 * Recording reads this once per take, so a change made in the settings window
 * applies to the next recording without any invalidation to get wrong. The
 * file is tiny and this is not on a per-frame path.
 */
export function loadSettings(): Settings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file(), "utf8")));
  } catch {
    // Missing on first run, and unreadable or truncated after a bad write.
    // Both mean "use the defaults", and neither is worth a dialog.
    return normalizeSettings(null);
  }
}

export function saveSettings(s: Settings): void {
  try {
    writeFileSync(file(), `${JSON.stringify(normalizeSettings(s), null, 2)}\n`, "utf8");
  } catch (err) {
    // A settings write failing is worth knowing about: the UI will show the
    // new value while the next recording silently uses the old one.
    logDiag("settings:save", err);
  }
}
```

- [ ] **Step 2: Typecheck**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck"
```

Expected: silent.

- [ ] **Step 3: Commit**

```bash
git add src/main/settingsStore.ts
git commit -m "feat: persist app settings in userData"
```

---

### Task 3: Capture at the chosen rate

**Files:**
- Modify: `src/main/capture/SessionController.ts:16-17, 84`
- Modify: `src/main/capture/ScreenSource.ts` (the stale comment)

- [ ] **Step 1: Take the rate from settings**

In `src/main/capture/SessionController.ts`, replace the two constants:

```ts
const DDAGRAB_FPS = 60;
const GDIGRAB_FPS = 30;
```

with:

```ts
/**
 * ddagrab is GPU-side and genuinely delivers what it is asked for, so it is not
 * user-tunable — there is nothing to trade off. gdigrab is CPU-bound readback
 * and gets whatever it manages, which is why the setting exists.
 */
const DDAGRAB_FPS = 60;
```

and add the import:

```ts
import { loadSettings } from "../settingsStore";
```

Then replace line 84:

```ts
  const requestedFps = backend === "ddagrab" ? DDAGRAB_FPS : loadSettings().captureFps;
```

Nothing downstream changes: `probeRecording` already reads back the rate that
was actually achieved, and the manifest records that rather than the request.

- [ ] **Step 2: Correct the comment that caused this**

In `src/main/capture/ScreenSource.ts`, in the `buildCaptureArgs` doc comment,
replace:

```
 * gdigrab is the fallback and is genuinely worse: GDI readback is CPU-bound,
 * realistically caps around 30fps at 1080p, and cannot capture protected or
```

with:

```
 * gdigrab is the fallback and is genuinely worse: GDI readback is CPU-bound
 * and cannot capture protected or
```

and add below that paragraph:

```
 * It does NOT cap at 30fps, which this comment claimed for two phases and
 * which set GDIGRAB_FPS to 30. Measured at 1080p on 2026-09-06: asking for 30
 * yields 27.3fps, asking for 60 yields 44. Ask for more than you expect to get.
```

- [ ] **Step 3: Record a take and check the manifest**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run build"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; $env:ZOOMCAST_RECORD_TEST='5'; npx electron . | Out-Null; cat $env:APPDATA\zoomcast\record-test.json"
```

Then read the take's manifest and confirm `video.fps` is well above 30:

```powershell
powershell.exe -NoProfile -Command "Get-ChildItem \"$env:LOCALAPPDATA\zoomcast\recordings\" | Sort-Object LastWriteTime | Select-Object -Last 1"
```

Expected: a measured fps around 40+, against ~27 before.

- [ ] **Step 4: Commit**

```bash
git add src/main/capture/SessionController.ts src/main/capture/ScreenSource.ts
git commit -m "feat: capture at the configured rate, defaulting to 60"
```

---

### Task 4: Settings across the IPC boundary

**Files:**
- Modify: `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts`

**Interfaces:**
- Produces: `window.zoomcast.getSettings()` and
  `window.zoomcast.setSettings(s)`. Task 5 consumes both.

- [ ] **Step 1: Widen the API type**

In `src/shared/api.ts`, add the import and the two members:

```ts
import type { Settings } from "./settings/types";
```

```ts
  /** App-level settings. Separate from Project, which lives in a bundle. */
  getSettings: () => Promise<Settings>;
  setSettings: (settings: Settings) => Promise<void>;
```

- [ ] **Step 2: Expose them in the preload**

In `src/preload/index.ts`, add to the `api` object:

```ts
  getSettings: () => ipcRenderer.invoke("settings:get") as Promise<Settings>,
  setSettings: (settings: Settings) =>
    ipcRenderer.invoke("settings:set", settings) as Promise<void>,
```

and the type import:

```ts
import type { Settings } from "../shared/settings/types";
```

- [ ] **Step 3: Handle them in main**

In `src/main/ipc.ts`, add the import:

```ts
import { loadSettings, saveSettings } from "./settingsStore";
import type { Settings } from "../shared/settings/types";
```

and the handlers, next to the other non-export ones:

```ts
  ipcMain.handle("settings:get", () => loadSettings());
  ipcMain.handle("settings:set", (_event, settings: Settings) => {
    saveSettings(settings);
  });
```

- [ ] **Step 4: Typecheck and test**

Expected: typecheck silent, 235 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/shared/api.ts src/preload/index.ts src/main/ipc.ts
git commit -m "feat: read and write settings from the renderer"
```

---

### Task 5: The settings window

**Files:**
- Create: `src/renderer/ui/SettingsWindow.tsx`
- Modify: `src/renderer/App.tsx`, `src/main/index.ts`, `src/main/recording.ts`

- [ ] **Step 1: Write the panel**

```tsx
// src/renderer/ui/SettingsWindow.tsx
import { useEffect, useState } from "react";
import { CAPTURE_FPS_CHOICES, type Settings } from "../../shared/settings/types";
import { label, select } from "./controls";

/**
 * The app's first settings surface.
 *
 * Deliberately a window rather than a tray submenu: an encoder choice, an
 * output directory and the record hotkey all belong here next, and a submenu
 * does not hold them.
 */
export function SettingsWindow() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void window.zoomcast.getSettings().then(setSettings);
  }, []);

  if (settings === null) return <div style={{ padding: 24 }}>loading…</div>;

  const update = (next: Settings): void => {
    setSettings(next);
    void window.zoomcast.setSettings(next);
  };

  return (
    <div style={{ padding: 24, color: "#e6e6e6", background: "#0d0e11", height: "100vh" }}>
      <h2 style={{ fontWeight: 400, fontSize: 18, marginTop: 0 }}>Settings</h2>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
        <span style={label}>Capture frame rate</span>
        <select
          style={select}
          value={settings.captureFps}
          onChange={(e) =>
            update({ ...settings, captureFps: Number(e.target.value) as Settings["captureFps"] })
          }
        >
          {CAPTURE_FPS_CHOICES.map((fps) => (
            <option key={fps} value={fps}>
              {fps} fps
            </option>
          ))}
        </select>
      </div>

      <p style={{ color: "#8b90a0", fontSize: 12, maxWidth: 460, lineHeight: 1.5 }}>
        Screen capture is CPU-bound and rarely reaches the rate it is asked for —
        the recording stores what it actually achieved. 60 gives noticeably
        smoother motion; 30 costs less CPU and produces smaller files. Takes
        effect on the next recording.
      </p>
    </div>
  );
}
```

If `label` and `select` do not both exist in `src/renderer/ui/controls.ts`,
add them there rather than inlining styles — that file exists so both panels
share one set.

- [ ] **Step 2: Route it**

In `src/renderer/App.tsx`, beside the existing hash checks:

```tsx
  const isSettings = window.location.hash === "#settings";
```

and, before the editor/welcome return, add:

```tsx
  if (isSettings) return <SettingsWindow />;
```

with the import:

```tsx
import { SettingsWindow } from "./ui/SettingsWindow";
```

- [ ] **Step 3: Open it from main**

In `src/main/index.ts`, after `createWindow`:

```ts
let settingsWindow: BrowserWindow | null = null;

/** One settings window, focused if it already exists. */
function openSettings(): void {
  if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = createWindow(true, "#settings");
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}
```

Wire it into whatever `setRecordingControls`/`openEditor` mechanism
`src/main/recording.ts` already uses to reach back into `index.ts` — follow that
existing pattern rather than importing `index.ts` from `recording.ts`.

- [ ] **Step 4: Add the tray entry**

In `src/main/recording.ts`'s `updateTray`, after the "Show editor" item:

```ts
      {
        label: "Settings…",
        click: () => openSettings?.(),
      },
```

declared alongside the existing `openEditor` hook.

- [ ] **Step 5: Drive it by hand — there is no headless path**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run build"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx electron ."
```

Open Settings from the tray, switch to 30, close the window, and confirm:

```powershell
powershell.exe -NoProfile -Command "cat \"$env:APPDATA\zoomcast\settings.json\""
```

Then record a take and confirm the manifest's fps followed the setting.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ui/SettingsWindow.tsx src/renderer/App.tsx src/main/index.ts src/main/recording.ts
git commit -m "feat: a settings window, opened from the tray"
```

---

### Task 6: Export frame rate as a choice

Export fps is already persisted and already editable — but as a free number
field (`src/renderer/ui/StylePanel.tsx:275`), so 0 and 7 are reachable. The
user asked for 30 and 60; this makes those the offered values.

**Files:**
- Modify: `src/renderer/ui/StylePanel.tsx:273-279`

- [ ] **Step 1: Replace the number row with a select**

Replace the `fps` `NumberRow` with a select over `[30, 60]`, following whatever
`SelectRow`/`select` control the file already uses for aspect. Keep writing
`output.fps` so nothing downstream changes: `planExportFrames` and
`buildExportArgs` both already read it.

- [ ] **Step 2: Guard the value on load**

A project saved with `fps: 7` must not become unreachable in the UI. In
`src/shared/project/migrate.ts`, clamp `output.fps` to one of the offered
values on load, the same way the other fields are normalised, and add a test
beside the existing migration tests.

- [ ] **Step 3: Verify**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run build; npm run verify:parity"
```

Expected: tests pass, parity 20/20. Parity's configs use the default 60, so a
regression here shows up as a frame-count mismatch rather than silently.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/ui/StylePanel.tsx src/shared/project/migrate.ts src/shared/project/migrate.test.ts
git commit -m "feat: export at 30 or 60fps, chosen rather than typed"
```

---

### Task 7: ddagrab — investigate later, diagnosis carried here

**Not to be executed with the rest of this plan.** It is written down so the
work does not start from zero, and because the payoff is large: ddagrab is
GPU-side Desktop Duplication and would deliver a true 60fps instead of
gdigrab's 44, at lower CPU cost.

**What is known, measured 2026-09-06 (do not re-derive):**

The handover records "neither adapter enumerates a DXGI output" for both GPUs.
That is **not accurate**. The adapter/output matrix:

| adapter | output | result |
| --- | --- | --- |
| 0 (AMD Radeon, drives the panel) | 0 | **`Selected output not supported`** |
| 0 | 1 | `Failed to enumerate DXGI output 1` (only one display — correct) |
| 1 (NVIDIA RTX 3050) | 0 | `Failed to enumerate DXGI output 0` (no display attached — normal for a hybrid laptop) |
| 2 | any | `Failed to create Direct3D device (887a0004)` (no such adapter) |

So the panel's output **is** enumerated. ddagrab rejects that specific output.

Ruled out: pixel format. `output_fmt` of `8bit` (default), `auto` and
`x2bgr10`, with and without `scale_d3d11=format=nv12` and `p010`, all fail
identically. The display is 1920x1080 @ 144Hz, 32bpp, single monitor. ffmpeg is
9.0.1, which supports every one of those options.

**Next suspect, untested:** Windows' per-application GPU preference. On MSHybrid
laptops, Desktop Duplication fails with exactly this error when the calling
process is bound to the GPU that does not own the output. The preference lives
in `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`, keyed by executable
path, and is also set from Settings → Display → Graphics. Test by pinning
ffmpeg.exe to "Power saving" (the AMD iGPU) and re-running the matrix above.

**This touches the user's registry, so ask before writing it.** The same test
can be done first through the Windows Settings UI, which is reversible and
needs no elevation.

**If it works:** `probeBackend` already tries ddagrab first and falls back, so
nothing in the app needs changing — the manifest starts recording
`"adapter": "ddagrab"` and 60fps capture arrives for free. That is the reason
this task is worth keeping open.

---

## Self-Review

**Coverage.** The user asked for a higher capture rate and a 30/60 choice. Task
3 raises the rate, Tasks 1-2 and 4-5 make it a choice with a home, Task 6 does
the same for export, Task 7 records the larger prize without spending time on it.

**Placeholders.** None. Task 5's steps 3-4 deliberately say "follow the existing
`openEditor` pattern" rather than inventing a mechanism, because that wiring
exists and should not be duplicated from a guess; every other step carries its
code.

**Type consistency.** `Settings`, `CAPTURE_FPS_CHOICES` and `CaptureFps` are
defined in Task 1 and used under those names in Tasks 2, 4 and 5.
`loadSettings`/`saveSettings` are defined in Task 2 and used in Tasks 3 and 4.

**Ordering.** 1 → 2 → 3 delivers the frame rate itself and is independently
shippable; 4 → 5 adds the surface; 6 is independent of all of them; 7 is not to
be executed.

**Known gap.** There is no React component test coverage anywhere in this
codebase, so `SettingsWindow.tsx` is guarded only by the hand-drive in Task 5
step 5. That is consistent with the rest of the UI rather than a new hole, but
it is a hole.
