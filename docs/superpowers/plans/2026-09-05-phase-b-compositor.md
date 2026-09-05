# Phase B — Compositor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the recording a composed look the user can control — procedural
backgrounds, a blur stage, a framed screen with border and preset triple, and
aspect/resolution choice — plus the `style` UI that has never existed.

**Architecture:** Three of the five render passes already exist
(`drawBackground` → `drawShadow` → `drawScreen`). This phase widens them rather
than adding passes: the background program grows from a two-stop linear gradient
to a mesh gradient / solid / image / hidden dispatch with an optional blur, the
screen program gains a border ring, and the frame fields move under
`style.frame` so a preset can set them as a group. The persisted `style` shape
changes, so a pure normalisation layer lands first and everything else builds on
it. All new decision logic goes in `src/shared/`, which stays node-testable; only
`Renderer.ts` touches WebGL.

**Tech Stack:** TypeScript, WebGL2 (GLSL ES 3.00), React (renderer UI), Electron
(main-process file copy), Vitest.

**Spec:** `docs/specs/2026-09-04-composition-and-camera-design.md` — §4 scope,
§5 procedural backgrounds, §6 data model, §7 render model, §13 phases, §14
testing. Read it alongside this plan.

**Predecessor:** Phase A (cursor pipeline) — `docs/superpowers/plans/2026-09-04-phase-a-cursor.md`.
Phase B depends on nothing in A, but shares `StyleConfig` and the `Inspector`
section idiom A introduced.

---

## Global Constraints

Copied verbatim from `HANDOVER.md` and the spec. Every task's requirements
implicitly include this section. A violation is a task failure, not a nitpick.

- **`src/shared/` must not import electron, touch the DOM, or hit the
  filesystem.** That purity is why the suite runs in plain node. Presets,
  normalisation, aspect maths and preset resolution all live there.
- **Preview and export are two separate `drawFrame` call sites** —
  `src/renderer/ui/Editor.tsx` and `src/renderer/media/exportClip.ts`. Every
  visual feature must be wired into both. This caught phase A's Tasks 7 and 8.
- **Preview and export must keep calling the same `Renderer`.** If they diverge
  that is a design-level failure. `verify:parity` is the guard and must stay
  passing; a phase that breaks it broke the design, it does not need its
  threshold relaxed.
- **`verify:parity` only guards what it samples.** `SHOTS` in
  `tools/verify-parity.ts` is `[0, 1000, 1900, 2500, 4600]`. Time-windowed
  features need a sample inside their window.
- **Never hold more than one `VideoFrame`.** `frameAt` returns a clone — close
  it.
- **Compare media times in integer ticks, never float ms.**
- **The app only runs natively on Windows.** Never `npm run` / `npx electron`
  under WSL. Drive it through interop:
  `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"`.
- **Main-process stdout is invisible on Windows.** Use `logDiag()` from
  `src/main/log.ts`, never bare `console.error`.
- **Electron: a `file://` page cannot fetch a custom scheme.** The app is served
  from `zc://app`; disk media is `zc://app/@fs/<path>`. A custom background
  image must be addressed the same way.
- **License-clean assets only.** No shipped bitmap backgrounds — spec §5 chooses
  procedural generation partly so no image licence travels with a redistributed
  build. A custom image is the user's own and is copied into the project dir.
- **Design law: no bold.** Titles and labels are regular or medium, never
  semibold. Reuse `fieldLabel` / `sectionHeader` from `Inspector.tsx`.
- **Vite is pinned to ^7, `@vitejs/plugin-react` to ^5.** Do not upgrade.
- **Do not add a runtime dependency** without saying why in the commit. This
  phase needs none.

### Naming and units, fixed for the whole phase

Later tasks depend on these exact spellings.

| Name | Meaning |
| --- | --- |
| `BackgroundKind` | `"gradient" \| "color" \| "image" \| "hidden"` |
| `BlurStrength` | `"none" \| "moderate" \| "strong"` |
| `FramePreset` | `"default" \| "minimal" \| "hidden"` |
| `AspectChoice` | `"native" \| "16:9" \| "4:3" \| "1:1" \| "9:16"` |
| `*Px` suffix | integer pixels in **output** space |
| `*Pct` suffix | percent where 100 = natural size |
| `opacity`, `depth`, `strength` | 0..1 floats |

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/shared/project/migrate.ts` | `normalizeProject` — one pure function that upgrades any persisted project to the current shape. The only place that knows about old shapes. |
| `src/shared/project/migrate.test.ts` | Migration tests, including a real pre-phase-B `project.json` shape. |
| `src/shared/style/backgrounds.ts` | Named procedural gradient presets as pure data, plus `resolveBackground`. |
| `src/shared/style/backgrounds.test.ts` | Preset table invariants. |
| `src/shared/style/frame.ts` | `FRAME_PRESETS` and `resolveFrame` — maps a preset to concrete radius/shadow/border. |
| `src/shared/style/frame.test.ts` | Preset resolution tests. |
| `src/shared/style/aspect.ts` | `outputSizeFor` — aspect choice + source size → output size. |
| `src/shared/style/aspect.test.ts` | Aspect maths, including the native passthrough. |
| `src/renderer/gl/backgroundTexture.ts` | Loads a custom background image into a GL texture, cached by path. Mirrors `cursorTexture.ts`. |
| `src/renderer/ui/StylePanel.tsx` | The `style` UI section: background, frame, output. Keeps `Inspector.tsx` from growing unwieldy. |

**Modified:**

| File | Change |
| --- | --- |
| `src/shared/project/types.ts` | `Background` widened; `FrameStyle` added; `StyleConfig.frame` replaces loose `cornerRadiusPx`/`shadow`; `OutputConfig.aspect`. |
| `src/shared/project/defaults.ts` | New shape. |
| `src/main/bundleIo.ts:39-42` | Route the parsed project through `normalizeProject`. |
| `src/main/index.ts` | IPC handler for copying a chosen image into the project dir. |
| `src/preload/*` | Expose that handler on `window.zoomcast`. |
| `src/renderer/gl/shaders.ts` | `BG_FRAG` replaced by mesh/solid/image capable version with blur; `SCREEN_FRAG` gains a border ring. |
| `src/renderer/gl/Renderer.ts` | `drawBackground` dispatches on kind; `drawScreen` draws the border; frame fields read from `style.frame`. |
| `src/renderer/ui/Inspector.tsx` | Renders `<StylePanel>`; keeps the zoom + cursor sections. |
| `src/renderer/ui/Editor.tsx` | Passes `style` and an `onStyleChange` down; output size from `outputSizeFor`. |
| `src/renderer/media/exportClip.ts` | Output size from `outputSizeFor`. |
| `src/renderer/shoot.ts:82` | Shoot fixtures per background kind and frame preset. |
| `tools/verify-parity.ts` | A shot with a non-default background and frame. |
| `tools/shots-spec.json` | New specs. |

**Why `StylePanel.tsx` is a new file rather than more of `Inspector.tsx`:**
`Inspector.tsx` is 136 lines and already carries two sections. Phase B adds
roughly a dozen controls across three groups. Files that change together should
live together — the zoom knobs and the style knobs change for different reasons,
and phase C will touch the zoom half while leaving style alone.

---

## A note on the biggest risk in this phase — now half-handled

This plan was written assuming `bundleIo` still did a bare
`JSON.parse(...) as Project`, an unchecked assertion over disk data that was
safe only while the persisted shape never changed. Phase B changes that shape.

**That is no longer the state of the code.** Phase A's final review found the
same gap independently, and `src/shared/project/migrate.ts` now exists:
`normalizeProject(raw, bundleId)` merges field-by-field over `defaultProject`,
rejecting NaN and wrong-typed fields, and `bundleIo` routes every read through
it. So Task 1 below is no longer "write a migration" — it is **extend the
migration that exists** to cover the new fields, and update its tests.

The rule it established is what matters here, and it is now in `HANDOVER.md`:
**anyone adding a field to `Project` must add it to `normalizeProject` too, or
old projects silently lose it.** Every task in this phase that touches the
persisted shape is therefore also a `migrate.ts` change.

Task 1 still must land and be reviewed before any other task, because every
later task's types depend on it.

---

### Task 1: Style data model and project migration

**Files:**
- Modify: `src/shared/project/types.ts`
- Modify: `src/shared/project/defaults.ts`
- Modify: `src/shared/project/migrate.ts` — **exists already**; extend it
- Modify: `src/shared/project/migrate.test.ts` — **exists already**; extend it
- Modify: `src/shared/project/defaults.test.ts`

`bundleIo` already routes through `normalizeProject`, so it needs no change this
time. The existing tests pin the pre-phase-A shape (a project.json with no
`style.cursor`); keep every one of them passing — an old file must survive BOTH
migrations, not just the newest.

**Interfaces:**
- Consumes: nothing from this phase.
- Produces: the types every later task uses —
  `Background`, `BackgroundKind`, `BlurStrength`, `FrameStyle`, `FramePreset`,
  `AspectChoice`, `StyleConfig` (with `.frame` and `.background`),
  `OutputConfig` (with `.aspect`), and
  `normalizeProject(raw: unknown, bundleId: string): Project`.

- [ ] **Step 1: Write the failing test**

Create `src/shared/project/migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultProject } from "./defaults";
import { normalizeProject } from "./migrate";

/** The exact shape every project.json on disk has before phase B. */
const PRE_PHASE_B = {
  version: 1,
  bundleId: "2026-09-04T10-38-46",
  cuts: [],
  zoom: { config: { minHoldMs: 1500 }, keyframes: [{ tMs: 0, scale: 1, cx: 0.5, cy: 0.5 }] },
  style: {
    paddingFactor: 0.85,
    cornerRadiusPx: 12,
    shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
    background: { kind: "gradient", from: "#1b1d23", to: "#0d0e11", angle: 135 },
    cursor: { visible: true, sizePct: 100, smoothing: 0.8, shadow: true, ripples: true },
  },
  webcam: { visible: true, shape: "circle", sizePct: 18, position: "bottom-right", marginPx: 32 },
  audio: { micGainDb: 0, systemGainDb: -6, syncNudgeMs: 0 },
  output: { width: 1920, height: 1080, fps: 60, bitrateMbps: 12 },
};

describe("normalizeProject", () => {
  it("moves the loose frame fields under style.frame", () => {
    const p = normalizeProject(PRE_PHASE_B, "b");
    expect(p.style.frame.cornerRadiusPx).toBe(12);
    expect(p.style.frame.shadow).toEqual({ blurPx: 48, opacity: 0.35, offsetYPx: 16 });
  });

  it("keeps the old two-stop gradient renderable by carrying it as a custom preset", () => {
    const p = normalizeProject(PRE_PHASE_B, "b");
    expect(p.style.background.kind).toBe("gradient");
    expect(p.style.background.blur).toBe("none");
  });

  it("preserves everything phase B does not touch", () => {
    const p = normalizeProject(PRE_PHASE_B, "b");
    expect(p.style.cursor.smoothing).toBe(0.8);
    expect(p.zoom.keyframes).toHaveLength(1);
    expect(p.audio.systemGainDb).toBe(-6);
    expect(p.bundleId).toBe("2026-09-04T10-38-46");
  });

  it("defaults output.aspect to native so existing exports are unchanged", () => {
    const p = normalizeProject(PRE_PHASE_B, "b");
    expect(p.output.aspect).toBe("native");
    expect(p.output.width).toBe(1920);
  });

  it("is a no-op on an already-current project", () => {
    const current = defaultProject("b");
    expect(normalizeProject(current, "b")).toEqual(current);
  });

  it("falls back to defaults for a corrupt or empty file", () => {
    expect(normalizeProject(null, "b")).toEqual(defaultProject("b"));
    expect(normalizeProject({}, "b").style.frame.preset).toBe("default");
    expect(normalizeProject({ style: "nonsense" }, "b").style.paddingFactor).toBe(0.85);
  });

  it("keeps the caller's bundleId when the file disagrees", () => {
    const p = normalizeProject({ ...PRE_PHASE_B, bundleId: "stale" }, "real");
    expect(p.bundleId).toBe("real");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/migrate.test.ts"
```

Expected: FAIL — `Failed to resolve import "./migrate"`.

- [ ] **Step 3: Widen the types**

In `src/shared/project/types.ts`, replace the `Background` union and
`StyleConfig`, and extend `OutputConfig`. Leave `Cut`, `CursorStyle`,
`WebcamConfig` and `Project` otherwise untouched:

```ts
export type BackgroundKind = "gradient" | "color" | "image" | "hidden";
export type BlurStrength = "none" | "moderate" | "strong";

export type Background = {
  kind: BackgroundKind;
  /** Named entry in GRADIENT_PRESETS. Read only when kind is "gradient". */
  preset: string;
  /** Read only when kind is "color". */
  color: string;
  /** Basename of a file copied into the project dir. Read only when kind is "image". */
  imageFile: string | null;
  blur: BlurStrength;
};

export type FramePreset = "default" | "minimal" | "hidden";

export type FrameStyle = {
  preset: FramePreset;
  cornerRadiusPx: number;
  shadow: { blurPx: number; opacity: number; offsetYPx: number };
  border: { visible: boolean; widthPx: number; color: string };
};

export type StyleConfig = {
  paddingFactor: number;
  frame: FrameStyle;
  background: Background;
  cursor: CursorStyle;
};

export type AspectChoice = "native" | "16:9" | "4:3" | "1:1" | "9:16";

export type OutputConfig = {
  width: number;
  height: number;
  aspect: AspectChoice;
  fps: number;
  bitrateMbps: number;
};
```

Note `Background` is now a flat record rather than a discriminated union. That
is deliberate and matches spec §6: the user toggles kind back and forth in the
UI, and a union would discard the other kinds' settings on every switch. The
renderer reads only the field its `kind` selects.

- [ ] **Step 4: Update the defaults**

In `src/shared/project/defaults.ts`, replace the `style` and `output` blocks:

```ts
    style: {
      paddingFactor: 0.85,
      frame: {
        preset: "default",
        cornerRadiusPx: 12,
        shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
        border: { visible: false, widthPx: 1, color: "#ffffff22" },
      },
      background: {
        kind: "gradient",
        preset: "aurora",
        color: "#0d0e11",
        imageFile: null,
        blur: "none",
      },
      cursor: {
        visible: true,
        sizePct: 100,
        smoothing: 0.8,
        shadow: true,
        ripples: true,
      },
    },
```

and add `aspect: "native"` to `output`.

- [ ] **Step 5: Write the migration**

Create `src/shared/project/migrate.ts`:

```ts
import type { Project } from "./types";
import { defaultProject } from "./defaults";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

/**
 * Upgrade any persisted project to the current shape.
 *
 * bundleIo reads project.json with an unchecked `as Project`, which was safe
 * only while the shape never changed. Phase B changes it, and every recording
 * already on disk predates that — so this is the one place that knows what the
 * old shapes looked like. Field-by-field rather than a version bump because a
 * half-written or hand-edited file should degrade to defaults, not throw.
 */
export function normalizeProject(raw: unknown, bundleId: string): Project {
  const base = defaultProject(bundleId);
  if (!isRecord(raw)) return base;

  const style = isRecord(raw.style) ? raw.style : {};
  const output = isRecord(raw.output) ? raw.output : {};

  // Pre-phase-B carried cornerRadiusPx and shadow loose on style; phase B
  // groups them under frame so a preset can set them together.
  const rawFrame = isRecord(style.frame) ? style.frame : {};
  const legacyShadow = isRecord(style.shadow) ? style.shadow : {};
  const frameShadow = isRecord(rawFrame.shadow) ? rawFrame.shadow : legacyShadow;
  const rawBorder = isRecord(rawFrame.border) ? rawFrame.border : {};

  // Pre-phase-B background was { kind: "gradient", from, to, angle } or
  // { kind: "solid", color }. Neither field survives: gradients are named
  // presets now, and "solid" was renamed "color". An old solid keeps its
  // colour; an old gradient falls back to the default preset, because a
  // two-stop linear gradient has no faithful mesh equivalent.
  const rawBg = isRecord(style.background) ? style.background : {};
  const legacyKind = str(rawBg.kind, "");
  const kind =
    legacyKind === "solid"
      ? "color"
      : oneOf(rawBg.kind, ["gradient", "color", "image", "hidden"] as const, base.style.background.kind);

  return {
    version: 1,
    bundleId,
    cuts: Array.isArray(raw.cuts) ? (raw.cuts as Project["cuts"]) : base.cuts,
    zoom: isRecord(raw.zoom) ? (raw.zoom as Project["zoom"]) : base.zoom,
    style: {
      paddingFactor: num(style.paddingFactor, base.style.paddingFactor),
      frame: {
        preset: oneOf(rawFrame.preset, ["default", "minimal", "hidden"] as const, "default"),
        cornerRadiusPx: num(
          rawFrame.cornerRadiusPx ?? style.cornerRadiusPx,
          base.style.frame.cornerRadiusPx,
        ),
        shadow: {
          blurPx: num(frameShadow.blurPx, base.style.frame.shadow.blurPx),
          opacity: num(frameShadow.opacity, base.style.frame.shadow.opacity),
          offsetYPx: num(frameShadow.offsetYPx, base.style.frame.shadow.offsetYPx),
        },
        border: {
          visible: bool(rawBorder.visible, base.style.frame.border.visible),
          widthPx: num(rawBorder.widthPx, base.style.frame.border.widthPx),
          color: str(rawBorder.color, base.style.frame.border.color),
        },
      },
      background: {
        kind,
        preset: str(rawBg.preset, base.style.background.preset),
        color: str(rawBg.color, base.style.background.color),
        imageFile: typeof rawBg.imageFile === "string" ? rawBg.imageFile : null,
        blur: oneOf(rawBg.blur, ["none", "moderate", "strong"] as const, "none"),
      },
      cursor: {
        visible: bool(isRecord(style.cursor) ? style.cursor.visible : undefined, base.style.cursor.visible),
        sizePct: num(isRecord(style.cursor) ? style.cursor.sizePct : undefined, base.style.cursor.sizePct),
        smoothing: num(isRecord(style.cursor) ? style.cursor.smoothing : undefined, base.style.cursor.smoothing),
        shadow: bool(isRecord(style.cursor) ? style.cursor.shadow : undefined, base.style.cursor.shadow),
        ripples: bool(isRecord(style.cursor) ? style.cursor.ripples : undefined, base.style.cursor.ripples),
      },
    },
    webcam: isRecord(raw.webcam) ? (raw.webcam as Project["webcam"]) : base.webcam,
    audio: isRecord(raw.audio) ? (raw.audio as Project["audio"]) : base.audio,
    output: {
      width: num(output.width, base.output.width),
      height: num(output.height, base.output.height),
      aspect: oneOf(output.aspect, ["native", "16:9", "4:3", "1:1", "9:16"] as const, "native"),
      fps: num(output.fps, base.output.fps),
      bitrateMbps: num(output.bitrateMbps, base.output.bitrateMbps),
    },
  };
}
```

Note the migration test asserting `blur === "none"` rather than the default
`"none"` from `defaultProject` is deliberate: an old project must not silently
acquire a blur it never had.

- [ ] **Step 6: Run the tests to verify they pass**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/"
```

Expected: PASS. `defaults.test.ts` may need its assertions updated for the new
shape — update it, do not delete assertions.

- [ ] **Step 7: Wire it into the load path**

In `src/main/bundleIo.ts`, replace lines 39-42:

```ts
  const projectPath = join(root, PROJECT_FILE);
  const project: Project = normalizeProject(
    existsSync(projectPath) ? JSON.parse(readFileSync(projectPath, "utf8")) : null,
    manifest.id,
  );
```

and add `import { normalizeProject } from "../shared/project/migrate";`. Remove
the now-unused `defaultProject` import if nothing else in the file uses it —
`normalizeProject(null, id)` returns exactly `defaultProject(id)`.

- [ ] **Step 8: Fix every compile error the type change causes**

`Renderer.ts`, `shoot.ts` and anything else reading `style.cornerRadiusPx` or
`style.shadow` must now read `style.frame.cornerRadiusPx` and
`style.frame.shadow`. This is a mechanical rename; do not change behaviour.

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck"
```

Expected: silent.

- [ ] **Step 9: Verify nothing regressed**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run build; npm run verify:parity"
```

Expected: all tests pass (166 + the new ones), build produces three bundles,
parity 5/5 unchanged — this task is a pure refactor plus a new pure function, so
any parity movement means the frame-field rename changed behaviour.

- [ ] **Step 10: Verify a real old recording still opens**

This is the whole point of the task and no unit test covers it.

```powershell
$env:ZOOMCAST_UI_SHOT = "$env:LOCALAPPDATA\zoomcast\recordings\2026-09-04T09-45-53"
$env:ZOOMCAST_UI_SHOT_SEEK = '4000'
$env:ZOOMCAST_UI_SHOT_OUT = 'C:\dev\zoomcast\tmp\ui\migrate.png'
npx electron .
```

Open the PNG. Expected: the take renders exactly as it did before this task —
same gradient background, same corner radius, same shadow. A blank or throwing
editor means the migration dropped a field.

- [ ] **Step 11: Commit**

```bash
git add src/shared/project src/main/bundleIo.ts src/renderer/gl/Renderer.ts src/renderer/shoot.ts
git commit -m "feat: group frame style, widen background, and normalise projects on load"
```

---

### Task 2: Procedural gradient presets

**Files:**
- Create: `src/shared/style/backgrounds.ts`
- Create: `src/shared/style/backgrounds.test.ts`

**Interfaces:**
- Consumes: `Background`, `BlurStrength` from Task 1.
- Produces:
  - `type GradientPreset = { name: string; label: string; points: Array<{ x: number; y: number; color: string }>; falloff: number }`
  - `GRADIENT_PRESETS: readonly GradientPreset[]`
  - `gradientPreset(name: string): GradientPreset` — never throws; falls back to the first preset.
  - `BLUR_RADIUS_PX: Record<BlurStrength, number>`

Spec §5: twelve bitmap backgrounds in the reference become mesh gradients
generated in the fragment shader. Ship curated, not exhaustive — six presets, not
twelve.

- [ ] **Step 1: Write the failing test**

Create `src/shared/style/backgrounds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BLUR_RADIUS_PX, GRADIENT_PRESETS, gradientPreset } from "./backgrounds";

describe("GRADIENT_PRESETS", () => {
  it("ships a curated set, not an exhaustive one", () => {
    expect(GRADIENT_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(GRADIENT_PRESETS.length).toBeLessThanOrEqual(8);
  });

  it("has unique names", () => {
    const names = GRADIENT_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every preset exactly four control points, matching the shader's array size", () => {
    for (const p of GRADIENT_PRESETS) {
      expect(p.points, p.name).toHaveLength(4);
    }
  });

  it("keeps control points inside the frame and colours parseable", () => {
    for (const p of GRADIENT_PRESETS) {
      for (const pt of p.points) {
        expect(pt.x, p.name).toBeGreaterThanOrEqual(0);
        expect(pt.x, p.name).toBeLessThanOrEqual(1);
        expect(pt.y, p.name).toBeGreaterThanOrEqual(0);
        expect(pt.y, p.name).toBeLessThanOrEqual(1);
        expect(pt.color, p.name).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("keeps falloff positive so the shader never divides by zero", () => {
    for (const p of GRADIENT_PRESETS) expect(p.falloff, p.name).toBeGreaterThan(0);
  });

  it("contains the preset defaultProject names", () => {
    expect(GRADIENT_PRESETS.some((p) => p.name === "aurora")).toBe(true);
  });
});

describe("gradientPreset", () => {
  it("resolves a known name", () => {
    expect(gradientPreset("aurora").name).toBe("aurora");
  });

  it("falls back rather than throwing on an unknown name", () => {
    // A project.json can name a preset a later build removed.
    expect(gradientPreset("no-such-preset")).toBe(GRADIENT_PRESETS[0]);
  });
});

describe("BLUR_RADIUS_PX", () => {
  it("is monotonic and zero at none", () => {
    expect(BLUR_RADIUS_PX.none).toBe(0);
    expect(BLUR_RADIUS_PX.moderate).toBeGreaterThan(BLUR_RADIUS_PX.none);
    expect(BLUR_RADIUS_PX.strong).toBeGreaterThan(BLUR_RADIUS_PX.moderate);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/style/backgrounds.test.ts"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the presets**

Create `src/shared/style/backgrounds.ts`:

```ts
import type { BlurStrength } from "../project/types";

/**
 * A mesh gradient as four coloured control points, blended in the fragment
 * shader by inverse-distance weighting.
 *
 * Four is not arbitrary: it is the array size the shader declares, and a
 * fixed-size loop keeps the fragment program branch-free. Adding a fifth point
 * means changing MESH_POINTS in shaders.ts as well.
 *
 * Generated rather than shipped as bitmaps for three reasons (spec §5): a
 * shipped image carries a licence that travels with anything redistributed;
 * generated gradients stay sharp at any export resolution including 4K, where a
 * 1080p bitmap would not; and the installer stays small.
 */
export type GradientPreset = {
  name: string;
  label: string;
  points: Array<{ x: number; y: number; color: string }>;
  /** Higher concentrates each colour nearer its point; 0 would divide by zero. */
  falloff: number;
};

export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  {
    name: "aurora",
    label: "aurora",
    points: [
      { x: 0.1, y: 0.15, color: "#1e3a5f" },
      { x: 0.85, y: 0.1, color: "#2d1b4e" },
      { x: 0.2, y: 0.9, color: "#0f2027" },
      { x: 0.9, y: 0.8, color: "#1a4d5c" },
    ],
    falloff: 2.2,
  },
  {
    name: "ember",
    label: "ember",
    points: [
      { x: 0.15, y: 0.2, color: "#3d1a1a" },
      { x: 0.9, y: 0.15, color: "#5c2415" },
      { x: 0.1, y: 0.85, color: "#1a0f0f" },
      { x: 0.8, y: 0.9, color: "#7a3520" },
    ],
    falloff: 2.0,
  },
  {
    name: "slate",
    label: "slate",
    points: [
      { x: 0.2, y: 0.1, color: "#242830" },
      { x: 0.85, y: 0.2, color: "#1a1d24" },
      { x: 0.15, y: 0.9, color: "#12141a" },
      { x: 0.9, y: 0.85, color: "#2a2f38" },
    ],
    falloff: 1.6,
  },
  {
    name: "moss",
    label: "moss",
    points: [
      { x: 0.12, y: 0.18, color: "#1a2e1f" },
      { x: 0.88, y: 0.12, color: "#25402c" },
      { x: 0.18, y: 0.88, color: "#0f1a12" },
      { x: 0.85, y: 0.82, color: "#2f4a35" },
    ],
    falloff: 2.1,
  },
  {
    name: "dusk",
    label: "dusk",
    points: [
      { x: 0.1, y: 0.12, color: "#2b2140" },
      { x: 0.9, y: 0.18, color: "#40304f" },
      { x: 0.2, y: 0.88, color: "#161222" },
      { x: 0.88, y: 0.9, color: "#4a3358" },
    ],
    falloff: 2.3,
  },
  {
    name: "ink",
    label: "ink",
    points: [
      { x: 0.25, y: 0.2, color: "#0d0e11" },
      { x: 0.8, y: 0.25, color: "#15171c" },
      { x: 0.2, y: 0.8, color: "#08090b" },
      { x: 0.85, y: 0.78, color: "#101216" },
    ],
    falloff: 1.4,
  },
];

/** Never throws: a project.json can name a preset a later build removed. */
export function gradientPreset(name: string): GradientPreset {
  return GRADIENT_PRESETS.find((p) => p.name === name) ?? GRADIENT_PRESETS[0];
}

/** Blur radius in output pixels at 1080p; the shader scales it by output height. */
export const BLUR_RADIUS_PX: Record<BlurStrength, number> = {
  none: 0,
  moderate: 16,
  strong: 40,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/style/backgrounds.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/style/backgrounds.ts src/shared/style/backgrounds.test.ts
git commit -m "feat: procedural mesh gradient presets"
```

---

### Task 3: Mesh gradient, solid and hidden backgrounds in the shader

**Files:**
- Modify: `src/renderer/gl/shaders.ts` — replace `BG_FRAG`
- Modify: `src/renderer/gl/Renderer.ts` — `drawBackground`
- Modify: `src/renderer/shoot.ts` — a fixture per background kind
- Modify: `tools/shots-spec.json`

**Interfaces:**
- Consumes: `gradientPreset`, `GRADIENT_PRESETS` (Task 2); `Background` (Task 1).
- Produces: a `Renderer` that honours `background.kind` for `gradient`, `color`
  and `hidden`. `image` is Task 5 and falls back to `color` until then.

This task has no unit test — it is WebGL, which the pure suite cannot reach. Its
gate is the rendered image, per spec §14 (`ZOOMCAST_SHOOT` grows fixtures for
each background kind so composition regressions show up as image diffs).

- [ ] **Step 1: Replace `BG_FRAG`**

In `src/renderer/gl/shaders.ts`, replace the `BG_FRAG` export:

```ts
/** Must match GradientPreset.points.length in shared/style/backgrounds.ts. */
export const MESH_POINTS = 4;

/**
 * Background: mesh gradient, solid colour, or nothing.
 *
 * The mesh is inverse-distance weighting over four coloured control points —
 * cheap, unconditionally smooth, and free of the banding a two-stop linear
 * gradient shows on a dark palette. u_mode selects the branch; the loop is a
 * fixed size so the program stays branch-free inside it.
 */
export const BG_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform int   u_mode;        // 0 = mesh, 1 = solid
uniform vec3  u_color;
uniform vec2  u_points[${MESH_POINTS}];
uniform vec3  u_colors[${MESH_POINTS}];
uniform float u_falloff;
uniform float u_aspect;      // output w/h, so distance is measured in square space
out vec4 frag;

void main() {
  if (u_mode == 1) {
    frag = vec4(u_color, 1.0);
    return;
  }

  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;

  for (int i = 0; i < ${MESH_POINTS}; i++) {
    vec2 d = p - vec2(u_points[i].x * u_aspect, u_points[i].y);
    float w = 1.0 / (dot(d, d) * u_falloff + 0.0005);
    acc += u_colors[i] * w;
    wsum += w;
  }

  frag = vec4(acc / wsum, 1.0);
}`;
```

Distance is measured in square space (`u_aspect`) so a preset does not smear
horizontally on a 16:9 output and vertically on a 9:16 one — Task 7 makes both
reachable.

- [ ] **Step 2: Register the new uniforms**

In `Renderer.ts`'s constructor, the `bg` program's uniform list must gain
`u_mode`, `u_color`, `u_falloff`, `u_aspect`, and the array members. GLSL array
uniforms are looked up per element, so collect them by index:

```ts
    // Array uniforms are addressed per element, not as a block.
    const bgArrayUniforms: string[] = [];
    for (let i = 0; i < MESH_POINTS; i++) {
      bgArrayUniforms.push(`u_points[${i}]`, `u_colors[${i}]`);
    }
```

and include those names wherever the existing code enumerates uniform names for
`this.bg`. Follow the file's existing `link`/`uniforms` helper rather than
inventing a second pattern.

- [ ] **Step 3: Rewrite `drawBackground`**

Replace `Renderer.drawBackground` (currently `Renderer.ts:226-243`):

```ts
  private drawBackground(style: StyleConfig, out: Size): void {
    const gl = this.gl;
    const bg = style.background;

    // "hidden" means the frame's own alpha shows through to black, which is
    // what an export wants when the user is compositing downstream.
    if (bg.kind === "hidden") {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    gl.useProgram(this.bg.program);
    gl.uniform4f(this.bg.uniforms.u_rect ?? null, 0, 0, 1, 1);

    // Task 5 adds the image branch; until then an image project renders as its
    // solid colour rather than as nothing.
    if (bg.kind === "color" || bg.kind === "image") {
      const [r, g, b] = hexToRgb(bg.color);
      gl.uniform1i(this.bg.uniforms.u_mode ?? null, 1);
      gl.uniform3f(this.bg.uniforms.u_color ?? null, r, g, b);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }

    const preset = gradientPreset(bg.preset);
    gl.uniform1i(this.bg.uniforms.u_mode ?? null, 0);
    gl.uniform1f(this.bg.uniforms.u_falloff ?? null, preset.falloff);
    gl.uniform1f(this.bg.uniforms.u_aspect ?? null, out.w / out.h);

    preset.points.forEach((pt, i) => {
      const [r, g, b] = hexToRgb(pt.color);
      gl.uniform2f(this.bg.uniforms[`u_points[${i}]`] ?? null, pt.x, pt.y);
      gl.uniform3f(this.bg.uniforms[`u_colors[${i}]`] ?? null, r, g, b);
    });

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
```

Update the call in `drawFrame` to `this.drawBackground(style, out);`.

- [ ] **Step 4: Add a shoot fixture per background kind**

In `tools/shots-spec.json`, add specs that vary only the background: one per
gradient preset name plus one `color` and one `hidden`. Follow the existing
entries' shape exactly; `src/renderer/shoot.ts:82` already builds from
`defaultProject("shoot").style`, so override only `style.background`.

- [ ] **Step 5: Render them and look at every PNG**

```powershell
$env:ZOOMCAST_SHOOT = (Get-Content -Raw tools\shots-spec.json)
$env:ZOOMCAST_SHOOT_DIR = 'C:\dev\zoomcast\tmp\shots'
npx electron .
```

Open each PNG. Expected: six visibly distinct, smoothly blended gradients with
no banding and no hard seam at any control point; the solid renders flat; the
hidden renders black. A gradient that looks like four coloured blobs with visible
boundaries means `falloff` is too high for that preset — tune the preset, not the
shader.

- [ ] **Step 6: Verify parity and the suite**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck; npm run build; npm run verify:parity"
```

Expected: parity 5/5. The default project now renders the `aurora` mesh rather
than the old two-stop gradient, so the absolute dB numbers will move — what must
hold is that preview and export still agree, which is what parity measures.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/gl/shaders.ts src/renderer/gl/Renderer.ts tools/shots-spec.json src/renderer/shoot.ts
git commit -m "feat: mesh gradient, solid and hidden backgrounds"
```

---

### Task 4: Background blur

**Files:**
- Modify: `src/renderer/gl/shaders.ts` — blur in `BG_FRAG`
- Modify: `src/renderer/gl/Renderer.ts` — pass blur radius
- Modify: `tools/shots-spec.json`

**Interfaces:**
- Consumes: `BLUR_RADIUS_PX` (Task 2), `Background.blur` (Task 1).
- Produces: a background honouring `blur`. Task 5's image path reuses the same
  uniform.

**A judgement to make before writing code, and to record in the commit:** blurring
a procedural mesh gradient is close to a no-op — it is already smooth by
construction. The control that matters is on the image background (Task 5), where
blur is what makes an arbitrary photo usable behind a recording. Two options:

- Apply blur to every kind, accepting it does almost nothing on a mesh.
- Apply it only to `image`, and hide the control for other kinds.

**Recommendation: apply to every kind, and hide the control only when
`kind === "hidden"`.** A control that appears and disappears as the user switches
kind is more confusing than one that occasionally does little, and a strongly
blurred mesh does soften its control points visibly at `strong`. Implement it in
the same program rather than as a second pass — a separate framebuffer for a
background nobody is compositing against is cost with no return.

- [ ] **Step 1: Add the blur to `BG_FRAG`**

Add uniforms and sample the mesh at a small kernel. Insert into `BG_FRAG` before
`main`:

```glsl
uniform float u_blurPx;
uniform vec2  u_texelPx;   // 1/outputW, 1/outputH
```

and replace `main`'s mesh branch with a nine-tap box over the mesh function.
Factor the mesh into a function first so both the blurred and unblurred paths
call one implementation:

```glsl
vec3 mesh(vec2 uv) {
  vec2 p = vec2(uv.x * u_aspect, uv.y);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < ${MESH_POINTS}; i++) {
    vec2 d = p - vec2(u_points[i].x * u_aspect, u_points[i].y);
    float w = 1.0 / (dot(d, d) * u_falloff + 0.0005);
    acc += u_colors[i] * w;
    wsum += w;
  }
  return acc / wsum;
}
```

then in `main`:

```glsl
  if (u_blurPx <= 0.0) {
    frag = vec4(mesh(v_uv), 1.0);
    return;
  }

  vec2 step = u_texelPx * u_blurPx;
  vec3 sum = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      sum += mesh(v_uv + vec2(float(x), float(y)) * step);
    }
  }
  frag = vec4(sum / 9.0, 1.0);
```

Evaluating the mesh nine times is cheaper than a two-pass framebuffer blur at
this kernel size, and the mesh is nine cheap reciprocals, not a texture fetch.

- [ ] **Step 2: Pass the uniform from `drawBackground`**

```ts
    const blurPx = BLUR_RADIUS_PX[bg.blur] * (out.h / 1080);
    gl.uniform1f(this.bg.uniforms.u_blurPx ?? null, blurPx);
    gl.uniform2f(this.bg.uniforms.u_texelPx ?? null, 1 / out.w, 1 / out.h);
```

Scaling by `out.h / 1080` keeps the blur the same apparent size at 4K export as
in a 1080p preview — the same reasoning that keeps the cursor a constant apparent
size in phase A.

- [ ] **Step 3: Add shoot fixtures at each blur strength**

Add three specs varying only `style.background.blur` over one preset.

- [ ] **Step 4: Render and compare the three PNGs**

```powershell
$env:ZOOMCAST_SHOOT = (Get-Content -Raw tools\shots-spec.json)
$env:ZOOMCAST_SHOOT_DIR = 'C:\dev\zoomcast\tmp\shots'
npx electron .
```

Expected: `none` and `moderate` differ subtly, `strong` visibly softer. If all
three are identical the uniform is not reaching the shader — check the uniform
name is in the program's lookup list, which is the failure mode this codebase
hits most.

- [ ] **Step 5: Verify**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run build; npm run verify:parity"
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/gl tools/shots-spec.json
git commit -m "feat: background blur"
```

---

### Task 5: Custom image background

**Files:**
- Create: `src/renderer/gl/backgroundTexture.ts`
- Modify: `src/main/index.ts` — IPC handler
- Modify: `src/preload/index.mts` (or the file `preloadPath()` resolves) — expose it
- Modify: `src/shared/api.ts` — the typed surface
- Modify: `src/renderer/gl/shaders.ts`, `src/renderer/gl/Renderer.ts`

**Interfaces:**
- Consumes: `Background.imageFile` (Task 1), blur uniforms (Task 4).
- Produces:
  - `window.zoomcast.chooseBackgroundImage(dir: string): Promise<string | null>`
    — opens a picker, copies the chosen file into the project dir, returns the
    basename it wrote (or `null` if cancelled).
  - `class BackgroundTextureCache { get(gl, url): WebGLTexture | null; dispose(): void }`

Spec §5: a custom image is **copied into the project directory** rather than
referenced, so a project does not break when the source file moves.

- [ ] **Step 1: Add the main-process handler**

In `src/main/index.ts`, alongside the existing `ipcMain.handle` registrations:

```ts
  ipcMain.handle("background:choose", async (_e, dir: string): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: "choose a background image",
      properties: ["openFile"],
      filters: [{ name: "images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (res.canceled || res.filePaths.length === 0) return null;

    const src = res.filePaths[0];
    // Copied, not referenced: a project must not break when the source moves.
    // Named by content-independent timestamp so replacing the image cannot
    // collide with a texture cached under the old name.
    const name = `background-${Date.now()}${extname(src).toLowerCase()}`;
    try {
      copyFileSync(src, join(dir, name));
    } catch (err) {
      logDiag(`background:choose copy failed: ${String(err)}`);
      return null;
    }
    return name;
  });
```

`logDiag`, not `console.error` — main-process stdout is invisible on Windows.

- [ ] **Step 2: Expose it through preload and the typed API**

Add `chooseBackgroundImage: (dir: string) => ipcRenderer.invoke("background:choose", dir)`
to the preload bridge and the matching signature to `src/shared/api.ts`. Follow
the existing entries exactly.

- [ ] **Step 3: Write the texture cache**

Create `src/renderer/gl/backgroundTexture.ts`, mirroring `cursorTexture.ts`:

```ts
/**
 * Loads a background image into a GL texture, cached by URL.
 *
 * Decode is async but drawFrame is not, so `get` returns null until the image
 * is ready and the caller falls back to the solid colour for those few frames.
 * Blocking the render loop on a decode would stall preview and export alike.
 */
export class BackgroundTextureCache {
  private readonly textures = new Map<string, WebGLTexture>();
  private readonly pending = new Set<string>();

  get(gl: WebGL2RenderingContext, url: string): WebGLTexture | null {
    const existing = this.textures.get(url);
    if (existing !== undefined) return existing;
    if (this.pending.has(url)) return null;

    this.pending.add(url);
    const img = new Image();
    img.onload = () => {
      const tex = gl.createTexture();
      if (tex === null) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.set(url, tex);
      this.pending.delete(url);
    };
    img.onerror = () => this.pending.delete(url);
    img.src = url;
    return null;
  }

  dispose(gl: WebGL2RenderingContext): void {
    for (const tex of this.textures.values()) gl.deleteTexture(tex);
    this.textures.clear();
    this.pending.clear();
  }
}
```

Call `dispose` from `Renderer.dispose()` — phase A's Task 7 fix round existed
because textures were not released.

**Export caveat, and it matters:** `exportClip` renders every frame in a loop. If
the first frames arrive before the image decodes they export with the solid
fallback while the preview showed the image. Before the export loop starts,
await the texture once — add an `await cache.ready(url)` style preload in
`exportClip.ts` rather than letting the loop race the decode.

- [ ] **Step 4: Add the image branch to the shader and `drawBackground`**

Add `uniform sampler2D u_image;` and a `u_mode == 2` branch that samples it with
cover fit (scale to fill, centre-crop), reusing the same blur path. In
`drawBackground`, resolve the URL as `zc://app/@fs/<dir>/<imageFile>` — a
`file://` URL cannot be fetched from the custom scheme at all.

- [ ] **Step 5: Verify by hand**

No automated check covers a file picker. Run the app, choose an image, confirm:
it appears behind the frame; the file is copied into the recording directory;
closing and reopening the take still shows it; and moving or deleting the
original source file changes nothing.

- [ ] **Step 6: Verify the suite and parity**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck; npm run build; npm run verify:parity"
```

- [ ] **Step 7: Commit**

```bash
git add src/main src/preload src/shared/api.ts src/renderer/gl src/renderer/media/exportClip.ts
git commit -m "feat: custom image background, copied into the project"
```

---

### Task 6: Frame border and the preset triple

**Files:**
- Create: `src/shared/style/frame.ts`
- Create: `src/shared/style/frame.test.ts`
- Modify: `src/renderer/gl/shaders.ts` — border ring in `SCREEN_FRAG`
- Modify: `src/renderer/gl/Renderer.ts` — `drawScreen`

**Interfaces:**
- Consumes: `FrameStyle`, `FramePreset` (Task 1).
- Produces:
  - `FRAME_PRESETS: Record<FramePreset, Omit<FrameStyle, "preset">>`
  - `resolveFrame(frame: FrameStyle): Omit<FrameStyle, "preset">` — returns the
    preset's values for a named preset, the frame's own values for `"default"`
    once the user has edited it.

- [ ] **Step 1: Write the failing test**

Create `src/shared/style/frame.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FRAME_PRESETS, resolveFrame } from "./frame";
import type { FrameStyle } from "../project/types";

const base: FrameStyle = {
  preset: "default",
  cornerRadiusPx: 12,
  shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
  border: { visible: false, widthPx: 1, color: "#ffffff22" },
};

describe("FRAME_PRESETS", () => {
  it("makes hidden actually hidden: no radius, no shadow, no border", () => {
    const hidden = FRAME_PRESETS.hidden;
    expect(hidden.cornerRadiusPx).toBe(0);
    expect(hidden.shadow.opacity).toBe(0);
    expect(hidden.border.visible).toBe(false);
  });

  it("makes minimal lighter than default, not absent", () => {
    expect(FRAME_PRESETS.minimal.shadow.opacity).toBeGreaterThan(0);
    expect(FRAME_PRESETS.minimal.shadow.opacity).toBeLessThan(
      FRAME_PRESETS.default.shadow.opacity,
    );
  });
});

describe("resolveFrame", () => {
  it("returns the preset's values for minimal and hidden", () => {
    expect(resolveFrame({ ...base, preset: "hidden" }).cornerRadiusPx).toBe(0);
    expect(resolveFrame({ ...base, preset: "minimal" })).toEqual(FRAME_PRESETS.minimal);
  });

  it("returns the user's own values under the default preset", () => {
    // "default" is the editable preset: picking it hands control back to the
    // individual fields rather than overwriting them.
    const edited = { ...base, cornerRadiusPx: 40 };
    expect(resolveFrame(edited).cornerRadiusPx).toBe(40);
  });

  it("never returns a negative radius or an out-of-range opacity", () => {
    const wild = { ...base, cornerRadiusPx: -5, shadow: { ...base.shadow, opacity: 3 } };
    const r = resolveFrame(wild);
    expect(r.cornerRadiusPx).toBeGreaterThanOrEqual(0);
    expect(r.shadow.opacity).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/style/frame.test.ts"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `frame.ts`**

```ts
import type { FramePreset, FrameStyle } from "../project/types";

type FrameValues = Omit<FrameStyle, "preset">;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * "default" is the editable preset — it is absent from this table on purpose.
 * Picking minimal or hidden overrides the individual fields; picking default
 * hands control back to them, so a user who tunes a radius and then tours the
 * presets gets their radius back rather than a reset.
 */
export const FRAME_PRESETS: Record<FramePreset, FrameValues> = {
  default: {
    cornerRadiusPx: 12,
    shadow: { blurPx: 48, opacity: 0.35, offsetYPx: 16 },
    border: { visible: false, widthPx: 1, color: "#ffffff22" },
  },
  minimal: {
    cornerRadiusPx: 6,
    shadow: { blurPx: 20, opacity: 0.18, offsetYPx: 6 },
    border: { visible: true, widthPx: 1, color: "#ffffff1a" },
  },
  hidden: {
    cornerRadiusPx: 0,
    shadow: { blurPx: 0, opacity: 0, offsetYPx: 0 },
    border: { visible: false, widthPx: 0, color: "#00000000" },
  },
};

export function resolveFrame(frame: FrameStyle): FrameValues {
  const v: FrameValues =
    frame.preset === "default"
      ? { cornerRadiusPx: frame.cornerRadiusPx, shadow: frame.shadow, border: frame.border }
      : FRAME_PRESETS[frame.preset];

  return {
    cornerRadiusPx: Math.max(0, v.cornerRadiusPx),
    shadow: {
      blurPx: Math.max(0, v.shadow.blurPx),
      opacity: clamp(v.shadow.opacity, 0, 1),
      offsetYPx: v.shadow.offsetYPx,
    },
    border: { ...v.border, widthPx: Math.max(0, v.border.widthPx) },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/style/frame.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Draw the border**

`SCREEN_FRAG` already has `sdRoundRect` for its corner mask. The border is the
same SDF, drawn as a ring just inside the edge — reuse it rather than adding a
sixth program:

```glsl
uniform float u_borderPx;
uniform vec4  u_borderColor;
```

and after the existing corner mask, mix the border colour in where the distance
falls within `u_borderPx` of the edge, with the same antialiasing the corner
mask uses. Do not draw the border as a separate quad: it must be clipped by the
same rounded rect, or it will square off the corners.

- [ ] **Step 6: Route every frame read through `resolveFrame`**

In `Renderer.drawFrame`, resolve once and pass the result to `drawShadow` and
`drawScreen`:

```ts
    const frame = resolveFrame(style.frame);
```

Both currently read `style.frame.cornerRadiusPx` and `style.frame.shadow`
directly after Task 1's rename; they must read the resolved values instead, or
the presets do nothing.

- [ ] **Step 7: Shoot a fixture per frame preset and look at them**

Add three specs varying only `style.frame.preset`. Render and open. Expected:
`default` unchanged from today; `minimal` tighter with a faint hairline;
`hidden` a hard-edged rectangle with no shadow.

- [ ] **Step 8: Verify**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck; npm run build; npm run verify:parity"
```

- [ ] **Step 9: Commit**

```bash
git add src/shared/style/frame.ts src/shared/style/frame.test.ts src/renderer/gl tools/shots-spec.json
git commit -m "feat: frame border and the default/minimal/hidden preset triple"
```

---

### Task 7: Aspect ratio and export resolution

**Files:**
- Create: `src/shared/style/aspect.ts`
- Create: `src/shared/style/aspect.test.ts`
- Modify: `src/renderer/ui/Editor.tsx` — output size
- Modify: `src/renderer/media/exportClip.ts` — output size

**Interfaces:**
- Consumes: `AspectChoice`, `OutputConfig` (Task 1).
- Produces:
  - `ASPECT_RATIOS: Record<Exclude<AspectChoice, "native">, number>`
  - `outputSizeFor(output: OutputConfig, source: Size): Size` — even dimensions
    always, because H.264 requires even width and height.

- [ ] **Step 1: Write the failing test**

Create `src/shared/style/aspect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { outputSizeFor } from "./aspect";
import type { OutputConfig } from "../project/types";

const src = { w: 1920, h: 1080 };
const out = (over: Partial<OutputConfig>): OutputConfig => ({
  width: 1920, height: 1080, aspect: "native", fps: 60, bitrateMbps: 12, ...over,
});

describe("outputSizeFor", () => {
  it("passes the source size through for native", () => {
    expect(outputSizeFor(out({}), src)).toEqual({ w: 1920, h: 1080 });
  });

  it("keeps the long edge and derives the short one", () => {
    expect(outputSizeFor(out({ aspect: "1:1" }), src)).toEqual({ w: 1080, h: 1080 });
    expect(outputSizeFor(out({ aspect: "4:3" }), src)).toEqual({ w: 1440, h: 1080 });
  });

  it("handles a portrait target from a landscape source", () => {
    const r = outputSizeFor(out({ aspect: "9:16" }), src);
    expect(r.h).toBe(1080);
    expect(r.w).toBe(608); // 1080 * 9/16 = 607.5, rounded up to even
  });

  it("always returns even dimensions, because H.264 requires them", () => {
    for (const aspect of ["native", "16:9", "4:3", "1:1", "9:16"] as const) {
      const r = outputSizeFor(out({ aspect, width: 1279, height: 721 }), { w: 1279, h: 721 });
      expect(r.w % 2, aspect).toBe(0);
      expect(r.h % 2, aspect).toBe(0);
    }
  });

  it("honours an explicit resolution under native", () => {
    expect(outputSizeFor(out({ width: 3840, height: 2160 }), src)).toEqual({ w: 3840, h: 2160 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/style/aspect.test.ts"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `aspect.ts`**

```ts
import type { AspectChoice, OutputConfig } from "../project/types";
import type { Size } from "../zoom/types";

export const ASPECT_RATIOS: Record<Exclude<AspectChoice, "native">, number> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "9:16": 9 / 16,
};

/** H.264 requires even width and height; an odd dimension fails the encoder. */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * The output size a project renders and exports at.
 *
 * "native" honours the explicit width/height, which is how an export
 * resolution is chosen. A named aspect keeps the configured height and derives
 * the width, so switching aspect never silently changes how much detail is in
 * the frame — only its shape.
 */
export function outputSizeFor(output: OutputConfig, source: Size): Size {
  if (output.aspect === "native") {
    return { w: even(output.width), h: even(output.height) };
  }

  const ratio = ASPECT_RATIOS[output.aspect];
  const h = even(output.height);
  return { w: even(h * ratio), h };
}
```

`source` is unused today but is in the signature because "native" should follow
a non-1080p source once phase C tunes against higher-resolution takes. Note that
in the doc comment rather than dropping the parameter — a later caller passing
it is not a signature change.

- [ ] **Step 4: Run the tests to verify they pass**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/style/aspect.test.ts"
```

Expected: PASS.

- [ ] **Step 5: Route both render call sites through it**

`Editor.tsx` and `exportClip.ts` each build an output size. Both must call
`outputSizeFor(project.output, sourceSize)`. **Both, not one** — a divergence here
is exactly the class of bug `verify:parity` exists to catch, and it caught phase
A twice.

- [ ] **Step 6: Verify parity at a non-native aspect**

Parity currently only ever runs at 1920×1080. Temporarily set the fixture
project's `output.aspect` to `"1:1"` and re-run `verify:parity`; it must still
pass. Revert afterwards — this is a check, not a committed change.

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck; npm run build; npm run verify:parity"
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/style/aspect.ts src/shared/style/aspect.test.ts src/renderer/ui/Editor.tsx src/renderer/media/exportClip.ts
git commit -m "feat: aspect ratio and export resolution"
```

---

### Task 8: The style UI

**Files:**
- Create: `src/renderer/ui/StylePanel.tsx`
- Modify: `src/renderer/ui/Inspector.tsx`
- Modify: `src/renderer/ui/Editor.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-7.
- Produces: `<StylePanel style={StyleConfig} output={OutputConfig} dir={string}
  onStyleChange={(s: StyleConfig) => void} onOutputChange={(o: OutputConfig) => void} />`

Spec §3 "unreachable style": `StyleConfig` is honoured by the renderer and
persisted, but `Inspector.tsx` lists only `ZoomConfig` fields. This task is the
one that makes the phase visible.

- [ ] **Step 1: Export the shared label styles**

`Inspector.tsx` defines `row`, `fieldLabel`, `sectionHeader` and `numberInput`.
`StylePanel` must use the same ones or the panel will drift — which is exactly
the defect phase A's Task 9 fix round closed. Export them from `Inspector.tsx`,
or move all four to a new `src/renderer/ui/controls.ts` and import from both.
Prefer the latter: two components importing from a third is cleaner than a
sibling importing from its parent.

- [ ] **Step 2: Write `StylePanel.tsx`**

Three sections following the existing idiom — `sectionHeader` for each heading,
`row` + `fieldLabel` per control, `numberInput` for numbers:

- **background** — kind (select: gradient/color/image/hidden); preset (select
  over `GRADIENT_PRESETS`, shown when kind is gradient); colour (text input,
  shown when kind is color); "choose image…" button calling
  `window.zoomcast.chooseBackgroundImage(dir)`, shown when kind is image, with
  the current filename beside it; blur (select: none/moderate/strong, hidden
  when kind is hidden).
- **frame** — preset (select: default/minimal/hidden); corner radius, shadow
  blur, shadow opacity, border visible, border width, all shown only under the
  `default` preset, because under the others they are overridden and an editable
  control that does nothing is a bug report waiting to happen.
- **output** — aspect (select over `AspectChoice`); width and height number
  inputs shown only under `native`; fps.

Reject out-of-range values the way `Inspector.tsx` does, and match `min` to the
guard — the mismatch was a real finding in phase A. **No bold anywhere**: labels
are `fieldLabel`, headers are `sectionHeader`.

- [ ] **Step 3: Wire it into `Inspector` and `Editor`**

`Inspector` renders `<StylePanel>` below the cursor section. `Editor` supplies
`project.style`, `project.output`, the bundle dir, and change handlers that
`setProject` — and each handler needs a redraw, exactly as
`onCursorChange` does. **Use the effect pattern, not a synchronous seek:**
`Editor.tsx:242-244` already redraws on `project.style.cursor`; widen that
effect's dependency to `project.style` and add one for `project.output`, rather
than adding a third idiom to the file.

- [ ] **Step 4: Screenshot the panel and read it**

```powershell
$env:ZOOMCAST_UI_SHOT = 'C:\dev\zoomcast\tests\fixtures\basic'
$env:ZOOMCAST_UI_SHOT_SEEK = '2500'
$env:ZOOMCAST_UI_SHOT_OUT = 'C:\dev\zoomcast\tmp\ui\style-panel.png'
npx electron .
```

Open it. Expected: three new sections at the same weight and dimness as the zoom
and cursor sections, nothing clipped, no control wider than the 280px panel, no
bold anywhere. The panel is now long — confirm it scrolls (`overflowY: auto` is
already set at `Editor.tsx:384`) rather than truncating.

- [ ] **Step 5: Verify**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck; npm run build; npm run verify:parity"
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ui
git commit -m "feat: the style panel"
```

---

### Task 9: Extend the guards to cover composition

**Files:**
- Modify: `tools/verify-parity.ts`
- Modify: `tools/shots-spec.json`
- Modify: `tests/fixtures/` project as needed

**Interfaces:** consumes everything above; produces no new API.

Spec §14 requires `verify:parity` to guard every render change and
`ZOOMCAST_SHOOT` to grow fixtures per background kind and frame preset. Tasks
3-6 added shoot fixtures as they went; this task closes the parity gap, which
none of them could do alone.

- [ ] **Step 1: Make the parity fixture exercise the new passes**

`verify:parity` currently runs the default project: `aurora` mesh, `default`
frame, no border, no blur. That means the border pass, the blur path, the solid
and image branches and every non-default aspect are **completely unguarded**
against a preview/export divergence — the precise failure mode parity exists for,
and the reason a ripple sample had to be added in phase A.

Add a second parity configuration rather than changing the first: keep the
default-project run, and add one with `background.kind: "color"`,
`background.blur: "strong"`, `frame.preset: "minimal"` (which turns the border
on), so both the default and the extremes are covered.

- [ ] **Step 2: Run it and confirm the count went up**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run verify:parity"
```

Expected: 10/10 (two configurations × five shots), all at 40dB or better. A new
configuration failing here is a real preview/export divergence — fix the
divergence, do not relax the threshold.

- [ ] **Step 3: Run the full checklist**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck; npm run build; npm run verify:decode; npm run verify:parity; npm run tune -- all"
```

Expected: all pass; `tune` output unchanged from Task 1's baseline, because
phase B does not touch the planner. **A change in `tune` output means phase B
altered zoom behaviour, which it must not** — the padding factor feeds
`maxComfortableZoom`, so an accidental edit there would show up here.

- [ ] **Step 4: Commit**

```bash
git add tools tests
git commit -m "test: guard the new composition passes in verify:parity"
```

---

### Task 10: Handover

**Files:**
- Modify: `HANDOVER.md`
- Create: `docs/superpowers/plans/2026-09-05-phase-b-handoff.md` if anything is mid-flight

- [ ] **Step 1: Rewrite the relevant `HANDOVER.md` sections**

Update: the phase list and what is NOT built; the start-of-session checklist
(new test count, parity now 10/10); "Things that will bite you" with anything
this phase cost real time on. Add a line to the Verification tools table if the
shoot fixtures gained a new mode.

Record explicitly: the persisted project shape changed, and `normalizeProject`
is the only place that knows the old shapes. Anyone adding a field must add it
there too or old projects silently lose it.

- [ ] **Step 2: Run the full checklist one final time and paste real output**

Do not write a number you did not just see.

- [ ] **Step 3: Commit**

```bash
git add HANDOVER.md docs
git commit -m "docs: handover for phase B"
```

---

## Self-Review

**Spec coverage.** Every phase B item in spec §4 and §13 maps to a task:
procedural gradients → 2, 3; solid and hidden → 3; blur → 4; custom image → 5;
corner radius and shadow → 1 (regrouped), 6 (resolved through presets); border →
6; preset triple → 6; aspect and resolution → 7; the style UI → 8. §14's testing
requirements → 3, 4, 6 (shoot fixtures) and 9 (parity).

**One spec gap found and filled:** §6 specifies the new `style` shape but says
nothing about the eleven recordings already on disk in the old shape, which
`bundleIo.ts:41` reads with an unchecked `as Project`. Task 1 adds
`normalizeProject`. Without it this phase breaks every existing recording.

**One spec ambiguity resolved, flagged for the user:** §6 lists
`background.blur` as applying to the background generally, but blurring a
procedural mesh gradient is nearly a no-op — the control earns its place on the
image background. Task 4 recommends applying it to all kinds and hiding it only
for `hidden`, with the reasoning in the task.

**Deliberately deferred, and why:** `motionBlur` appears in the §6 data model
but is phase D. Task 1 does not add the field — a persisted field nothing reads
invites a later reader to assume it works. Phase D adds it to the type and to
`normalizeProject` together.

**Type consistency:** `resolveFrame` (Task 6) returns `Omit<FrameStyle,
"preset">`, consumed by `Renderer.drawFrame`; `outputSizeFor` (Task 7) returns
`Size` from `shared/zoom/types`, matching what `drawFrame` already takes;
`gradientPreset` (Task 2) returns `GradientPreset`, consumed by
`drawBackground` (Task 3); `normalizeProject` (Task 1) returns `Project`,
consumed by `bundleIo`. `MESH_POINTS` is exported from `shaders.ts` and asserted
against `GradientPreset.points.length` in Task 2's test, so the two cannot drift.

**Task ordering is a real dependency chain, not a preference:** 1 before
everything (types); 2 before 3 (presets before the shader that reads them); 3
before 4 (the mesh function the blur samples); 4 before 5 (the image reuses the
blur uniforms); 1 before 6 (the frame regrouping); 7 independent of 3-6 but after
1; 8 after all of them; 9 after 8; 10 last.

---

## Open questions for the user

Neither blocks starting — Task 1 and 2 are unaffected — but both should be
settled before the task that needs them.

1. **Blur on procedural gradients** (needed by Task 4): apply to every kind, or
   only to image backgrounds? Recommendation and reasoning in Task 4.
2. **Six presets, and are these the right six?** (needed by Task 3's visual
   gate): aurora, ember, slate, moss, dusk, ink — all dark, on the assumption
   that a screen recording sits on a dark ground. A light preset or two may be
   wanted; that is a taste call, not a technical one.
