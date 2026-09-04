# Phase A — Cursor Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recordings show a cursor again — drawn by us from telemetry, with real Windows shapes, adjustable size, damped smoothing, a drop shadow and click ripples.

**Architecture:** Capture reads the live cursor shape at 30Hz through `koffi` → `user32!GetCursorInfo` and writes shape-change events into the existing telemetry stream. The editor derives a smoothed cursor path (a critically damped spring, precomputed and pure), and a new renderer pass draws a vector cursor at that position with constant apparent size under zoom. `drawMouse` stays `false` throughout — the cursor is never baked into the capture.

**Tech Stack:** TypeScript (strict), Electron 44, WebGL2, `koffi` (new), `uiohook-napi`, vitest.

**Spec:** `docs/specs/2026-09-04-composition-and-camera-design.md` (§4, §8; v1 spec §10 pass 5, decision #6)

## Global Constraints

- `src/shared/` must not import electron, touch the DOM, or hit the filesystem. That purity is why the suite runs in plain node.
- Preview and export call the same `Renderer`. `npm run verify:parity` must pass at the end of every task that touches rendering.
- Everything runs natively on Windows in PowerShell. From WSL, drive it as `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; <cmd>"`.
- Vite is pinned to `^7` and `@vitejs/plugin-react` to `^5`. Do not upgrade either.
- Native addons cannot be bundled: any new native dependency needs `externalizeDepsPlugin()` (already configured) and `asarUnpack` in `electron-builder.yml` (already `**/*.node`).
- Main-process stdout is invisible on Windows. Use `logDiag()` from `src/main/log.ts`, never bare `console.error`.
- Do not hardcode the record shortcut in UI copy; read it from `recordHotkey()`.
- Commit after every task. Run `npm test` and `npm run typecheck` before each commit.

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/main/capture/CursorShapeReader.ts` | The FFI edge. Polls `GetCursorInfo`, returns a raw cursor handle and visibility. Knows nothing about telemetry. |
| `src/shared/cursor/shapeTracker.ts` | Pure. Maps handle → `CursorShape` and suppresses repeats, so only changes reach the stream. |
| `src/shared/cursor/shapes.ts` | Pure. Vector path data and hotspots for the eight `CursorShape` values. |
| `src/shared/cursor/path.ts` | Pure. Critically damped spring over telemetry → sampled cursor path; `cursorAt(path, t)`. |
| `src/shared/cursor/ripples.ts` | Pure. Click events → expanding ripple state at time `t`. |
| `src/renderer/gl/cursorTexture.ts` | Rasterises a vector shape to a canvas once per (shape, size) and caches it as a texture. |

**Modified:**

| File | Change |
| --- | --- |
| `src/main/capture/TelemetryRecorder.ts` | Own a `CursorShapeReader`, push `{k:"cursor"}` events through the tracker. |
| `src/main/capture/SessionController.ts:107,176` | `hasCursorShapes: true` in the manifest. `drawMouse` stays `false`. |
| `src/shared/project/types.ts` | `StyleConfig.cursor`. |
| `src/shared/project/defaults.ts` | Cursor defaults. |
| `src/renderer/gl/shaders.ts` | `CURSOR_FRAG`. |
| `src/renderer/gl/Renderer.ts` | `FrameState.cursor`, `drawCursor()` pass after `drawScreen`. |
| `src/renderer/ui/Editor.tsx` | Build the cursor path once, pass cursor state per frame. |
| `src/renderer/ui/Inspector.tsx` | Cursor controls section. |
| `electron-builder.yml` | Nothing — `asarUnpack: "**/*.node"` already covers koffi. Verify only. |

---

## Task 1: Prove koffi can read the cursor shape

The FFI is the only genuinely risky part of this phase: if `koffi` cannot load `user32.dll` under Electron, or the struct layout is wrong, everything downstream is built on sand. This task is a throwaway probe that ends in a decision, not a feature.

**Files:**
- Create: `tmp/probe-cursor.ts` (throwaway — `tmp/` is gitignored)

**Interfaces:**
- Consumes: nothing
- Produces: a verified `koffi` call signature for `GetCursorInfo` and the handle values for each standard cursor, used verbatim by Task 2.

- [ ] **Step 1: Install koffi**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm install koffi"
```

- [ ] **Step 2: Write the probe**

`CURSORINFO` on x64 is 24 bytes: `cbSize` (u32), `flags` (u32), `hCursor` (pointer, 8-aligned), `ptScreenPos` (two i32). `flags` is `CURSOR_SHOWING = 1`, `CURSOR_SUPPRESSED = 2`.

Create `tmp/probe-cursor.ts`:

```ts
import koffi from "koffi";

const user32 = koffi.load("user32.dll");

const POINT = koffi.struct("POINT", { x: "int32", y: "int32" });
const CURSORINFO = koffi.struct("CURSORINFO", {
  cbSize: "uint32",
  flags: "uint32",
  hCursor: "void *",
  ptScreenPos: POINT,
});

const GetCursorInfo = user32.func("__stdcall", "GetCursorInfo", "bool", [
  koffi.out(koffi.pointer(CURSORINFO)),
]);
const LoadCursorW = user32.func("__stdcall", "LoadCursorW", "void *", [
  "void *",
  "uintptr_t",
]);

// The standard cursors we care about, by IDC_* resource id.
const IDC = {
  arrow: 32512,
  ibeam: 32513,
  wait: 32514,
  nwse: 32642,
  nesw: 32643,
  ew: 32644,
  ns: 32645,
  hand: 32649,
} as const;

for (const [name, id] of Object.entries(IDC)) {
  console.log(name, koffi.address(LoadCursorW(null, id)));
}

const info = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: null, ptScreenPos: { x: 0, y: 0 } };
setInterval(() => {
  if (!GetCursorInfo(info)) return console.log("GetCursorInfo failed");
  console.log(info.flags, koffi.address(info.hCursor), info.ptScreenPos);
}, 500);
```

- [ ] **Step 3: Run it and move the pointer over text, a link and a window edge**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx tsx tmp/probe-cursor.ts"
```

Expected: the eight `LoadCursorW` addresses print as distinct non-zero numbers, and the polled `hCursor` address matches `arrow` over the desktop, `ibeam` over text, and `hand` over a link.

- [ ] **Step 4: Run the same probe inside Electron**

Node and Electron load different C runtimes; a call that works under `tsx` can still fail under Electron. Add a temporary `if (process.env.ZOOMCAST_CURSOR_PROBE) { ... }` block at the top of `app.whenReady()` in `src/main/index.ts` that runs ten polls through `logDiag`, then:

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run build; \$env:ZOOMCAST_CURSOR_PROBE='1'; npx electron .; cat \"\$env:APPDATA\zoomcast\main-error.log\""
```

Expected: the same handle values appear in the log.

- [ ] **Step 5: Record the result, delete the probe**

If it works, note the confirmed signatures in the task 2 notes and `rm tmp/probe-cursor.ts` plus the temporary block in `index.ts`. If it does **not** work, stop and report — the fallback is the "synthetic, arrow only" option from the design discussion, which needs no FFI and changes only Task 2.

- [ ] **Step 6: Commit the dependency only**

```bash
git add package.json package-lock.json
git commit -m "build: add koffi for cursor shape capture"
```

---

## Task 2: Shape tracker (pure)

Handles are opaque runtime numbers, so the mapping is built at startup by calling `LoadCursorW` once per shape. The pure part — matching a handle against that table and suppressing repeats — is what gets tested.

**Files:**
- Create: `src/shared/cursor/shapeTracker.ts`
- Test: `src/shared/cursor/shapeTracker.test.ts`

**Interfaces:**
- Consumes: `CursorShape` from `src/shared/bundle/types.ts`
- Produces: `createShapeTracker(table: ShapeTable): ShapeTracker`, where `ShapeTable = Map<number, CursorShape>` and `ShapeTracker = { observe(t: number, handle: number, visible: boolean): TelemetryEvent | null }`

- [ ] **Step 1: Write the failing test**

Create `src/shared/cursor/shapeTracker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createShapeTracker } from "./shapeTracker";

const table = new Map([
  [100, "arrow" as const],
  [200, "ibeam" as const],
  [300, "hand" as const],
]);

describe("createShapeTracker", () => {
  it("emits an event for the first shape it sees", () => {
    const tracker = createShapeTracker(table);
    expect(tracker.observe(0, 100, true)).toEqual({ t: 0, k: "cursor", shape: "arrow" });
  });

  it("suppresses a repeat of the same shape", () => {
    const tracker = createShapeTracker(table);
    tracker.observe(0, 100, true);
    expect(tracker.observe(33, 100, true)).toBeNull();
  });

  it("emits again when the shape changes", () => {
    const tracker = createShapeTracker(table);
    tracker.observe(0, 100, true);
    expect(tracker.observe(33, 200, true)).toEqual({ t: 33, k: "cursor", shape: "ibeam" });
  });

  it("falls back to arrow for a handle it does not know", () => {
    const tracker = createShapeTracker(table);
    expect(tracker.observe(0, 999, true)).toEqual({ t: 0, k: "cursor", shape: "arrow" });
  });

  it("treats a hidden cursor as a shape change back to arrow", () => {
    // A suppressed cursor (full-screen video, some games) must not leave the
    // last shape latched forever.
    const tracker = createShapeTracker(table);
    tracker.observe(0, 200, true);
    expect(tracker.observe(33, 200, false)).toEqual({ t: 33, k: "cursor", shape: "arrow" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/cursor/shapeTracker.test.ts"
```

Expected: FAIL — `Failed to resolve import "./shapeTracker"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/shared/cursor/shapeTracker.ts`:

```ts
import type { CursorShape, TelemetryEvent } from "../bundle/types";

export type ShapeTable = Map<number, CursorShape>;

export type ShapeTracker = {
  observe(t: number, handle: number, visible: boolean): TelemetryEvent | null;
};

/**
 * Turn a stream of raw cursor handles into shape-change events.
 *
 * Polling runs at 30Hz but the shape changes a handful of times a minute, so
 * only transitions are written. An unknown handle means a bespoke application
 * cursor; "arrow" is the honest approximation.
 */
export function createShapeTracker(table: ShapeTable): ShapeTracker {
  let last: CursorShape | null = null;

  return {
    observe(t, handle, visible) {
      const shape: CursorShape = visible ? (table.get(handle) ?? "arrow") : "arrow";
      if (shape === last) return null;
      last = shape;
      return { t, k: "cursor", shape };
    },
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/cursor/shapeTracker.test.ts"
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/cursor/shapeTracker.ts src/shared/cursor/shapeTracker.test.ts
git commit -m "feat: cursor shape tracker"
```

---

## Task 3: Wire shape capture into recording

**Files:**
- Create: `src/main/capture/CursorShapeReader.ts`
- Modify: `src/main/capture/TelemetryRecorder.ts`, `src/main/capture/SessionController.ts`

**Interfaces:**
- Consumes: `createShapeTracker`, `ShapeTable` from Task 2; the koffi signatures confirmed in Task 1
- Produces: `CursorShapeReader.start(onEvent: (e: TelemetryEvent) => void, now: () => number): CursorShapeReader` with `.stop(): void`

- [ ] **Step 1: Write the reader**

Create `src/main/capture/CursorShapeReader.ts`:

```ts
import koffi from "koffi";
import type { CursorShape, TelemetryEvent } from "../../shared/bundle/types";
import { createShapeTracker, type ShapeTable } from "../../shared/cursor/shapeTracker";
import { logDiag } from "../log";

const POLL_INTERVAL_MS = 1000 / 30;
const CURSOR_SHOWING = 1;

/** IDC_* resource ids for the shapes CursorShape can represent. */
const IDC: Record<number, CursorShape> = {
  32512: "arrow",
  32513: "ibeam",
  32514: "wait",
  32642: "nwse",
  32643: "nesw",
  32644: "ew",
  32645: "ns",
  32649: "hand",
};

/**
 * Reads the live cursor shape at 30Hz.
 *
 * uiohook reports position but never shape, and ffmpeg's draw_mouse would bake
 * the cursor into the pixels — which is exactly what v1 decision #6 rules out,
 * because a baked cursor cannot be smoothed, resized or zoomed. So the shape is
 * read separately and drawn at render time.
 */
export class CursorShapeReader {
  private timer: NodeJS.Timeout | null = null;

  private constructor(
    private readonly poll: () => void,
  ) {}

  static start(
    onEvent: (e: TelemetryEvent) => void,
    now: () => number,
  ): CursorShapeReader | null {
    try {
      const user32 = koffi.load("user32.dll");

      const POINT = koffi.struct("POINT", { x: "int32", y: "int32" });
      const CURSORINFO = koffi.struct("CURSORINFO", {
        cbSize: "uint32",
        flags: "uint32",
        hCursor: "void *",
        ptScreenPos: POINT,
      });

      const GetCursorInfo = user32.func("__stdcall", "GetCursorInfo", "bool", [
        koffi.out(koffi.pointer(CURSORINFO)),
      ]);
      const LoadCursorW = user32.func("__stdcall", "LoadCursorW", "void *", [
        "void *",
        "uintptr_t",
      ]);

      const table: ShapeTable = new Map();
      for (const [id, shape] of Object.entries(IDC)) {
        const handle = koffi.address(LoadCursorW(null, Number(id)));
        if (handle !== 0) table.set(handle, shape);
      }

      const tracker = createShapeTracker(table);
      const info = {
        cbSize: koffi.sizeof(CURSORINFO),
        flags: 0,
        hCursor: null,
        ptScreenPos: { x: 0, y: 0 },
      };

      const reader = new CursorShapeReader(() => {
        if (!GetCursorInfo(info)) return;
        const event = tracker.observe(
          now(),
          koffi.address(info.hCursor),
          (info.flags & CURSOR_SHOWING) !== 0,
        );
        if (event !== null) onEvent(event);
      });

      reader.timer = setInterval(reader.poll, POLL_INTERVAL_MS);
      reader.poll();
      return reader;
    } catch (err) {
      // A missing shape stream is a degraded recording, not a failed one:
      // the renderer falls back to drawing an arrow throughout.
      logDiag("cursorShape", err);
      return null;
    }
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
```

- [ ] **Step 2: Own it from the telemetry recorder**

In `src/main/capture/TelemetryRecorder.ts`, add the import, a field, start it in `attach()` and stop it in `stop()`:

```ts
import { CursorShapeReader } from "./CursorShapeReader";
```

Add the field beside `flushTimer`:

```ts
  private shapes: CursorShapeReader | null = null;
```

At the end of `attach()`, after `uIOhook.start()`:

```ts
    this.shapes = CursorShapeReader.start(
      (event) => this.push(event),
      () => this.now(),
    );
```

In `stop()`, immediately after `if (this.flushTimer !== null) clearInterval(this.flushTimer);`:

```ts
    this.shapes?.stop();
    this.shapes = null;
```

- [ ] **Step 3: Declare it in the manifest**

In `src/main/capture/SessionController.ts`, both manifest writes set `hasCursorShapes: false`. Change both to `true`. Leave `drawMouse: false` exactly as it is — that is the whole point.

- [ ] **Step 4: Record and confirm shape events land**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run build; \$env:ZOOMCAST_RECORD_TEST='8'; npx electron . | Out-Null; cat \"\$env:APPDATA\zoomcast\record-test.json\""
```

Then, moving the pointer over text and links during those 8 seconds, check the new bundle:

```bash
powershell.exe -NoProfile -Command "Select-String -Path (Get-ChildItem \"\$env:LOCALAPPDATA\zoomcast\recordings\" | Sort-Object Name | Select-Object -Last 1).FullName\input.jsonl -Pattern 'cursor' | Select-Object -First 10"
```

Expected: `{"t":...,"k":"cursor","shape":"arrow"}` and at least one `ibeam` or `hand`.

- [ ] **Step 5: Commit**

```bash
git add src/main/capture/CursorShapeReader.ts src/main/capture/TelemetryRecorder.ts src/main/capture/SessionController.ts
git commit -m "feat: capture cursor shape at 30Hz"
```

---

## Task 4: Vector cursor shapes (pure)

**Files:**
- Create: `src/shared/cursor/shapes.ts`
- Test: `src/shared/cursor/shapes.test.ts`

**Interfaces:**
- Consumes: `CursorShape`
- Produces: `CURSOR_SHAPES: Record<CursorShape, CursorArt>` where
  `CursorArt = { path: string; hotspot: { x: number; y: number }; viewBox: number }` — `path` is SVG path data in a `viewBox × viewBox` square, `hotspot` is the point that sits on the reported coordinate.

- [ ] **Step 1: Write the failing test**

Create `src/shared/cursor/shapes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CURSOR_SHAPES } from "./shapes";

const ALL = [
  "arrow", "ibeam", "hand", "ns", "ew", "nwse", "nesw", "wait",
] as const;

describe("CURSOR_SHAPES", () => {
  it("covers every CursorShape", () => {
    for (const shape of ALL) expect(CURSOR_SHAPES[shape]).toBeDefined();
  });

  it("keeps every hotspot inside its viewBox", () => {
    for (const shape of ALL) {
      const art = CURSOR_SHAPES[shape];
      expect(art.hotspot.x).toBeGreaterThanOrEqual(0);
      expect(art.hotspot.y).toBeGreaterThanOrEqual(0);
      expect(art.hotspot.x).toBeLessThanOrEqual(art.viewBox);
      expect(art.hotspot.y).toBeLessThanOrEqual(art.viewBox);
    }
  });

  it("puts the arrow hotspot at its tip", () => {
    // The arrow's tip is the origin; anything else makes clicks look offset.
    expect(CURSOR_SHAPES.arrow.hotspot).toEqual({ x: 0, y: 0 });
  });

  it("centres the hotspot of every resize cursor", () => {
    for (const shape of ["ns", "ew", "nwse", "nesw"] as const) {
      const art = CURSOR_SHAPES[shape];
      expect(art.hotspot.x).toBeCloseTo(art.viewBox / 2, 5);
      expect(art.hotspot.y).toBeCloseTo(art.viewBox / 2, 5);
    }
  });

  it("gives every shape non-empty path data", () => {
    for (const shape of ALL) expect(CURSOR_SHAPES[shape].path.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/cursor/shapes.test.ts"
```

Expected: FAIL — cannot resolve `./shapes`.

- [ ] **Step 3: Write the shapes**

Create `src/shared/cursor/shapes.ts`. All shapes are drawn in a 32×32 box.

```ts
import type { CursorShape } from "../bundle/types";

export type CursorArt = {
  /** SVG path data, in a viewBox x viewBox square. */
  path: string;
  /** The point that sits on the reported pointer coordinate. */
  hotspot: { x: number; y: number };
  viewBox: number;
};

const V = 32;

/**
 * Cursors are drawn, not extracted from Windows HCURSORs.
 *
 * Extraction gets pixel-accurate shapes and a fixed-size bitmap — the one
 * thing that cannot survive being zoomed, which is the entire reason v1
 * decision #6 chose to draw the cursor rather than capture it.
 */
export const CURSOR_SHAPES: Record<CursorShape, CursorArt> = {
  arrow: {
    path: "M0 0 L0 22 L6 16.5 L10 25.5 L14 23.5 L10 15 L18 15 Z",
    hotspot: { x: 0, y: 0 },
    viewBox: V,
  },
  ibeam: {
    path: "M12 4 L20 4 M16 4 L16 28 M12 28 L20 28",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  hand: {
    path:
      "M12 18 L12 8 A2 2 0 0 1 16 8 L16 15 L16 11 A2 2 0 0 1 20 11 L20 15 " +
      "L20 13 A2 2 0 0 1 24 13 L24 22 A6 6 0 0 1 18 28 L16 28 " +
      "A6 6 0 0 1 10 22 L10 18 A2 2 0 0 1 12 18 Z",
    hotspot: { x: 13, y: 4 },
    viewBox: V,
  },
  ns: {
    path: "M16 3 L11 10 L21 10 Z M16 29 L11 22 L21 22 Z M16 10 L16 22",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  ew: {
    path: "M3 16 L10 11 L10 21 Z M29 16 L22 11 L22 21 Z M10 16 L22 16",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  nwse: {
    path: "M4 4 L14 4 L4 14 Z M28 28 L18 28 L28 18 Z M8 8 L24 24",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  nesw: {
    path: "M28 4 L18 4 L28 14 Z M4 28 L14 28 L4 18 Z M24 8 L8 24",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
  wait: {
    path:
      "M16 4 A12 12 0 0 1 28 16 L23 16 A7 7 0 0 0 16 9 Z " +
      "M16 28 A12 12 0 0 1 4 16 L9 16 A7 7 0 0 0 16 23 Z",
    hotspot: { x: 16, y: 16 },
    viewBox: V,
  },
};
```

- [ ] **Step 4: Run the tests**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/cursor/shapes.test.ts"
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/cursor/shapes.ts src/shared/cursor/shapes.test.ts
git commit -m "feat: vector cursor shapes"
```

---

## Task 5: Smoothed cursor path (pure)

**Files:**
- Create: `src/shared/cursor/path.ts`
- Test: `src/shared/cursor/path.test.ts`

**Interfaces:**
- Consumes: `TelemetryEvent`
- Produces:
  - `buildCursorPath(events: TelemetryEvent[], opts: PathOptions): CursorPath`
  - `cursorAt(path: CursorPath, tMs: number): CursorSample | null`
  - `type PathOptions = { smoothing: number; sampleHz: number }`
  - `type CursorSample = { x: number; y: number; shape: CursorShape; pressed: boolean }`
  - `type CursorPath = { t0: number; stepMs: number; xs: Float32Array; ys: Float32Array; shapes: CursorShape[]; pressed: Uint8Array }`

- [ ] **Step 1: Write the failing test**

Create `src/shared/cursor/path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { buildCursorPath, cursorAt } from "./path";

const opts = { smoothing: 0.8, sampleHz: 120 };

describe("buildCursorPath", () => {
  it("returns null for a time before any telemetry", () => {
    const path = buildCursorPath([{ t: 1000, k: "move", x: 10, y: 10 }], opts);
    expect(cursorAt(path, 0)).toBeNull();
  });

  it("settles on a stationary target", () => {
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 100, y: 100 },
      { t: 2000, k: "move", x: 100, y: 100 },
    ];
    const s = cursorAt(buildCursorPath(events, opts), 2000);
    expect(s?.x).toBeCloseTo(100, 1);
    expect(s?.y).toBeCloseTo(100, 1);
  });

  it("lags a step change rather than jumping to it", () => {
    // Damping is the whole point: at the instant the target moves, the drawn
    // position must still be near where it was.
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 1000, k: "move", x: 500, y: 0 },
    ];
    const path = buildCursorPath(events, opts);
    const at = cursorAt(path, 1020);
    expect(at?.x).toBeGreaterThan(0);
    expect(at?.x).toBeLessThan(400);
  });

  it("never overshoots the target", () => {
    // Critically damped, not underdamped — an overshooting cursor looks broken.
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 200, k: "move", x: 300, y: 0 },
      { t: 3000, k: "move", x: 300, y: 0 },
    ];
    const path = buildCursorPath(events, opts);
    for (let t = 0; t <= 3000; t += 10) {
      const s = cursorAt(path, t);
      if (s !== null) expect(s.x).toBeLessThanOrEqual(300.001);
    }
  });

  it("is deterministic for the same input", () => {
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 500, k: "move", x: 200, y: 300 },
    ];
    const a = buildCursorPath(events, opts);
    const b = buildCursorPath(events, opts);
    expect(Array.from(a.xs)).toEqual(Array.from(b.xs));
  });

  it("follows the target exactly when smoothing is zero", () => {
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 500, k: "move", x: 200, y: 0 },
    ];
    const s = cursorAt(buildCursorPath(events, { smoothing: 0, sampleHz: 120 }), 500);
    expect(s?.x).toBeCloseTo(200, 0);
  });

  it("carries the shape in force at that time", () => {
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 100, k: "cursor", shape: "hand" },
      { t: 500, k: "move", x: 10, y: 0 },
    ];
    const path = buildCursorPath(events, opts);
    expect(cursorAt(path, 50)?.shape).toBe("arrow");
    expect(cursorAt(path, 400)?.shape).toBe("hand");
  });

  it("reports pressed between a down and its up", () => {
    const events: TelemetryEvent[] = [
      { t: 0, k: "move", x: 0, y: 0 },
      { t: 100, k: "down", x: 0, y: 0, b: 1 },
      { t: 300, k: "up", x: 0, y: 0, b: 1 },
      { t: 500, k: "move", x: 0, y: 0 },
    ];
    const path = buildCursorPath(events, opts);
    expect(cursorAt(path, 200)?.pressed).toBe(true);
    expect(cursorAt(path, 400)?.pressed).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/cursor/path.test.ts"
```

Expected: FAIL — cannot resolve `./path`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/cursor/path.ts`:

```ts
import type { CursorShape, TelemetryEvent } from "../bundle/types";

export type PathOptions = {
  /** 0 = raw telemetry, 1 = heavily damped. */
  smoothing: number;
  sampleHz: number;
};

export type CursorSample = {
  x: number;
  y: number;
  shape: CursorShape;
  pressed: boolean;
};

export type CursorPath = {
  t0: number;
  stepMs: number;
  xs: Float32Array;
  ys: Float32Array;
  shapes: CursorShape[];
  pressed: Uint8Array;
};

/** Half-life of the spring, in ms, at the two ends of the smoothing range. */
const MIN_HALF_LIFE_MS = 0;
const MAX_HALF_LIFE_MS = 90;

/**
 * Precompute the drawn cursor path.
 *
 * A critically damped spring, evaluated on a fixed grid rather than per frame.
 * Per-frame integration would depend on frame timing, so a 60fps preview and a
 * 30fps export would produce different paths and verify:parity would be right
 * to fail. On a fixed grid the path is a pure function of telemetry and config,
 * identical in both.
 */
export function buildCursorPath(
  events: TelemetryEvent[],
  opts: PathOptions,
): CursorPath {
  const stepMs = 1000 / opts.sampleHz;
  const moves = events.filter((e) => e.k === "move" || e.k === "down" || e.k === "up");
  const first = moves[0];

  if (first === undefined || !("x" in first)) {
    return {
      t0: 0,
      stepMs,
      xs: new Float32Array(0),
      ys: new Float32Array(0),
      shapes: [],
      pressed: new Uint8Array(0),
    };
  }

  const last = events[events.length - 1];
  const t0 = first.t;
  const tEnd = last === undefined ? t0 : last.t;
  const count = Math.max(1, Math.ceil((tEnd - t0) / stepMs) + 1);

  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const shapes: CursorShape[] = new Array<CursorShape>(count);
  const pressed = new Uint8Array(count);

  // Half-life form, so the response is frame-rate independent by construction.
  const halfLife =
    MIN_HALF_LIFE_MS + (MAX_HALF_LIFE_MS - MIN_HALF_LIFE_MS) * clamp01(opts.smoothing);
  const decay = halfLife <= 0 ? 0 : Math.pow(0.5, stepMs / halfLife);

  let x = first.x;
  let y = first.y;
  let targetX = first.x;
  let targetY = first.y;
  let shape: CursorShape = "arrow";
  let down = false;
  let cursor = 0;

  for (let i = 0; i < count; i++) {
    const t = t0 + i * stepMs;

    while (cursor < events.length && (events[cursor] as TelemetryEvent).t <= t) {
      const e = events[cursor] as TelemetryEvent;
      if (e.k === "move" || e.k === "down" || e.k === "up") {
        targetX = e.x;
        targetY = e.y;
      }
      if (e.k === "down") down = true;
      if (e.k === "up") down = false;
      if (e.k === "cursor") shape = e.shape;
      cursor++;
    }

    x = targetX + (x - targetX) * decay;
    y = targetY + (y - targetY) * decay;

    xs[i] = x;
    ys[i] = y;
    shapes[i] = shape;
    pressed[i] = down ? 1 : 0;
  }

  return { t0, stepMs, xs, ys, shapes, pressed };
}

export function cursorAt(path: CursorPath, tMs: number): CursorSample | null {
  if (path.xs.length === 0 || tMs < path.t0) return null;

  const i = Math.min(path.xs.length - 1, Math.round((tMs - path.t0) / path.stepMs));

  return {
    x: path.xs[i] as number,
    y: path.ys[i] as number,
    shape: path.shapes[i] ?? "arrow",
    pressed: path.pressed[i] === 1,
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
```

- [ ] **Step 4: Run the tests**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/cursor/path.test.ts"
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck"
```

Expected: all green, typecheck silent.

- [ ] **Step 6: Commit**

```bash
git add src/shared/cursor/path.ts src/shared/cursor/path.test.ts
git commit -m "feat: precomputed smoothed cursor path"
```

---

## Task 6: Cursor config on the project

**Files:**
- Modify: `src/shared/project/types.ts`, `src/shared/project/defaults.ts`
- Test: `src/shared/project/defaults.test.ts` (create if absent)

**Interfaces:**
- Produces: `StyleConfig.cursor: CursorStyle` where
  `CursorStyle = { visible: boolean; sizePct: number; smoothing: number; shadow: boolean; ripples: boolean }`

- [ ] **Step 1: Write the failing test**

Create `src/shared/project/defaults.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultProject } from "./defaults";

describe("defaultProject", () => {
  it("shows the cursor by default", () => {
    expect(defaultProject("b").style.cursor.visible).toBe(true);
  });

  it("defaults to a smoothed, shadowed cursor at native size", () => {
    const cursor = defaultProject("b").style.cursor;
    expect(cursor.sizePct).toBe(100);
    expect(cursor.smoothing).toBeGreaterThan(0);
    expect(cursor.smoothing).toBeLessThanOrEqual(1);
    expect(cursor.shadow).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/defaults.test.ts"
```

Expected: FAIL — `style.cursor` is undefined.

- [ ] **Step 3: Add the type**

In `src/shared/project/types.ts`, add above `StyleConfig`:

```ts
export type CursorStyle = {
  visible: boolean;
  /** 100 = the shape's natural size at 1x zoom. */
  sizePct: number;
  /** 0 = raw telemetry, 1 = heavily damped. */
  smoothing: number;
  shadow: boolean;
  ripples: boolean;
};
```

and a field inside `StyleConfig`:

```ts
  cursor: CursorStyle;
```

- [ ] **Step 4: Add the defaults**

In `src/shared/project/defaults.ts`, inside `style`:

```ts
      cursor: {
        visible: true,
        sizePct: 100,
        smoothing: 0.8,
        shadow: true,
        ripples: true,
      },
```

- [ ] **Step 5: Run tests and typecheck**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck"
```

Expected: PASS. Typecheck will flag any `StyleConfig` literal missing `cursor` — fix each by adding the defaults above.

- [ ] **Step 6: Commit**

```bash
git add src/shared/project
git commit -m "feat: cursor style config"
```

---

## Task 7: Cursor render pass

**Files:**
- Create: `src/renderer/gl/cursorTexture.ts`
- Modify: `src/renderer/gl/shaders.ts`, `src/renderer/gl/Renderer.ts`

**Interfaces:**
- Consumes: `CURSOR_SHAPES` (Task 4), `CursorSample` (Task 5), `CursorStyle` (Task 6)
- Produces:
  - `class CursorTextureCache { get(gl: WebGL2RenderingContext, shape: CursorShape, sizePx: number): WebGLTexture }`
  - `FrameState.cursor?: { sample: CursorSample; style: CursorStyle }`

- [ ] **Step 1: Write the texture cache**

Rasterising to a canvas keeps the vector data as the source of truth while giving WebGL something to sample. Re-rasterising on size change is what keeps it sharp.

Create `src/renderer/gl/cursorTexture.ts`:

```ts
import type { CursorShape } from "../../shared/bundle/types";
import { CURSOR_SHAPES } from "../../shared/cursor/shapes";

/** Extra margin around the glyph so the stroke and shadow are not clipped. */
const PAD = 4;

/**
 * Rasterises a vector cursor once per (shape, size) and keeps the texture.
 *
 * Re-rasterising rather than scaling one bitmap is the point: the cursor has
 * to stay sharp when the camera is zoomed and when the export is 4K.
 */
export class CursorTextureCache {
  private readonly cache = new Map<string, WebGLTexture>();

  get(gl: WebGL2RenderingContext, shape: CursorShape, sizePx: number): WebGLTexture {
    const px = Math.max(8, Math.round(sizePx));
    const key = `${shape}@${px}`;
    const held = this.cache.get(key);
    if (held !== undefined) return held;

    const art = CURSOR_SHAPES[shape];
    const scale = px / art.viewBox;
    const dim = px + PAD * 2;

    const canvas = document.createElement("canvas");
    canvas.width = dim;
    canvas.height = dim;

    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("could not get 2d context for cursor");

    ctx.translate(PAD, PAD);
    ctx.scale(scale, scale);

    const path = new Path2D(art.path);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 3;
    ctx.stroke(path);
    ctx.fillStyle = "#ffffff";
    ctx.fill(path);

    const tex = gl.createTexture();
    if (tex === null) throw new Error("could not create cursor texture");

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.cache.set(key, tex);
    return tex;
  }
}
```

- [ ] **Step 2: Add the shader**

Append to `src/renderer/gl/shaders.ts`:

```ts
export const CURSOR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_shadow;

void main() {
  vec4 c = texture(u_tex, v_uv);

  if (u_shadow > 0.5) {
    // Offset alpha tap, so the cursor reads against light backgrounds too.
    float s = texture(u_tex, v_uv - vec2(0.02, 0.02)).a * 0.35;
    outColor = mix(vec4(0.0, 0.0, 0.0, s), c, c.a);
  } else {
    outColor = c;
  }
}
`;
```

- [ ] **Step 3: Extend FrameState and draw the pass**

In `src/renderer/gl/Renderer.ts`, add to the imports:

```ts
import type { CursorStyle } from "../../shared/project/types";
import type { CursorSample } from "../../shared/cursor/path";
import { CursorTextureCache } from "./cursorTexture";
import { BG_FRAG, CURSOR_FRAG, QUAD_VERT, SCREEN_FRAG, SHADOW_FRAG } from "./shaders";
```

Add to `FrameState`:

```ts
  cursor?: { sample: CursorSample; style: CursorStyle };
```

Add fields beside the other programs (`this.bg`, `this.shadow`, `this.screen`):

```ts
  private readonly cursorProgram: Program;
  private readonly cursorTextures = new CursorTextureCache();
```

Initialise it beside the others in the constructor:

```ts
    this.cursorProgram = link(gl, CURSOR_FRAG, ["u_tex", "u_shadow"]);
```

At the end of `drawFrame`, after `this.drawScreen(...)` and before `gl.bindVertexArray(null)`:

```ts
    if (state.cursor !== undefined && state.cursor.style.visible) {
      this.drawCursor(state.cursor.sample, state.cursor.style, quad, out, src);
    }
```

Add the method:

```ts
  /**
   * Draw the cursor in output space.
   *
   * The position is mapped through the same quad the screen was drawn into, so
   * the cursor tracks the zoom — but the SIZE is not scaled by the zoom, so its
   * apparent size stays constant. A cursor that grows as the camera pushes in
   * reads as a bug.
   */
  private drawCursor(
    sample: CursorSample,
    style: CursorStyle,
    quad: { x: number; y: number; w: number; h: number },
    out: Size,
    src: Size,
  ): void {
    const gl = this.gl;
    const art = CURSOR_SHAPES[sample.shape];

    const sizePx = (out.h / 1080) * 24 * (style.sizePct / 100);
    const dim = sizePx + 8; // matches PAD * 2 in cursorTexture.ts

    const x = quad.x + (sample.x / src.w) * quad.w;
    const y = quad.y + (sample.y / src.h) * quad.h;

    const hotX = (art.hotspot.x / art.viewBox) * sizePx + 4;
    const hotY = (art.hotspot.y / art.viewBox) * sizePx + 4;

    gl.useProgram(this.cursorProgram.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cursorTextures.get(gl, sample.shape, sizePx));
    gl.uniform1i(this.cursorProgram.uniforms.u_tex ?? null, 0);
    gl.uniform1f(this.cursorProgram.uniforms.u_shadow ?? null, style.shadow ? 1 : 0);

    this.setRect(this.cursorProgram, x - hotX, y - hotY, dim, dim, out);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
```

Add the `CURSOR_SHAPES` import at the top:

```ts
import { CURSOR_SHAPES } from "../../shared/cursor/shapes";
```

- [ ] **Step 4: Feed it from the editor**

In `src/renderer/ui/Editor.tsx`, build the path once per bundle (it is pure and cheap, but rebuilding per frame would be wasteful):

```ts
  const cursorPath = useMemo(
    () =>
      buildCursorPath(bundle.telemetry, {
        smoothing: project.style.cursor.smoothing,
        sampleHz: 120,
      }),
    [bundle.telemetry, project.style.cursor.smoothing],
  );
```

Keep it available to the render loop, which must not close over stale state — extend the existing `live` ref:

```ts
  const live = useRef({ project, ctx, cursorPath });
  live.current = { project, ctx, cursorPath };
```

and in `renderAt`, pass it to the renderer:

```ts
        const sample = cursorAt(live.current.cursorPath, tSource);

        renderer.drawFrame({
          screen: frame,
          zoom: zoomAt(p.zoom.keyframes, tSource),
          style: p.style,
          outputSize: c.output,
          sourceSize: c.source,
          cursor: sample === null ? undefined : { sample, style: p.style.cursor },
        });
```

with the imports:

```ts
import { buildCursorPath, cursorAt } from "../../shared/cursor/path";
```

- [ ] **Step 5: Look at it**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run build; \$env:ZOOMCAST_UI_SHOT='C:\dev\zoomcast\tests\fixtures\basic'; \$env:ZOOMCAST_UI_SHOT_SEEK='2500'; \$env:ZOOMCAST_UI_SHOT_OUT='C:\dev\zoomcast\tmp\ui\cursor.png'; npx electron ."
```

Open `tmp/ui/cursor.png`. Expected: a white arrow with a dark outline at the fixture's pointer position, sharp, roughly 24px tall at 1080p.

- [ ] **Step 6: Confirm preview and export still agree**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run verify:parity"
```

Expected: `preview and export agree at every sampled time`. If it fails here, the cursor is being drawn in one path and not the other — that is a real defect, not a threshold to relax.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/gl src/renderer/ui/Editor.tsx
git commit -m "feat: draw the cursor"
```

---

## Task 8: Click ripples

**Files:**
- Create: `src/shared/cursor/ripples.ts`, `src/shared/cursor/ripples.test.ts`
- Modify: `src/renderer/gl/Renderer.ts`, `src/renderer/gl/shaders.ts`

**Interfaces:**
- Consumes: `TelemetryEvent`
- Produces: `ripplesAt(events: TelemetryEvent[], tMs: number, durationMs: number): Ripple[]` where `Ripple = { x: number; y: number; progress: number }` and `progress` runs 0→1

- [ ] **Step 1: Write the failing test**

Create `src/shared/cursor/ripples.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../bundle/types";
import { ripplesAt } from "./ripples";

const clicks: TelemetryEvent[] = [
  { t: 1000, k: "down", x: 100, y: 200, b: 1 },
  { t: 5000, k: "down", x: 400, y: 300, b: 1 },
];

describe("ripplesAt", () => {
  it("shows nothing before the first click", () => {
    expect(ripplesAt(clicks, 500, 400)).toEqual([]);
  });

  it("starts a ripple at the click", () => {
    const [r] = ripplesAt(clicks, 1000, 400);
    expect(r).toMatchObject({ x: 100, y: 200 });
    expect(r?.progress).toBeCloseTo(0, 5);
  });

  it("advances the ripple over its duration", () => {
    expect(ripplesAt(clicks, 1200, 400)[0]?.progress).toBeCloseTo(0.5, 5);
  });

  it("drops the ripple once it completes", () => {
    expect(ripplesAt(clicks, 1500, 400)).toEqual([]);
  });

  it("ignores clicks in the future", () => {
    expect(ripplesAt(clicks, 1200, 400)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/cursor/ripples.test.ts"
```

Expected: FAIL — cannot resolve `./ripples`.

- [ ] **Step 3: Implement**

Create `src/shared/cursor/ripples.ts`:

```ts
import type { TelemetryEvent } from "../bundle/types";

export type Ripple = { x: number; y: number; progress: number };

/**
 * Expanding rings at recent clicks.
 *
 * Recomputed per frame from the event list rather than simulated, for the same
 * reason the cursor path is precomputed: it must not depend on frame timing,
 * or preview and export would disagree.
 */
export function ripplesAt(
  events: TelemetryEvent[],
  tMs: number,
  durationMs: number,
): Ripple[] {
  const out: Ripple[] = [];

  for (const e of events) {
    if (e.k !== "down") continue;
    if (e.t > tMs) break;

    const age = tMs - e.t;
    if (age >= durationMs) continue;

    out.push({ x: e.x, y: e.y, progress: age / durationMs });
  }

  return out;
}
```

- [ ] **Step 4: Run the tests**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/cursor/ripples.test.ts"
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Draw them**

Append to `src/renderer/gl/shaders.ts`:

```ts
export const RIPPLE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_progress;

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float d = length(p);

  // A ring that expands and fades: radius tracks progress, alpha falls away.
  float ring = smoothstep(0.06, 0.0, abs(d - u_progress));
  float fade = 1.0 - u_progress;

  outColor = vec4(1.0, 1.0, 1.0, ring * fade * 0.5);
}
`;
```

In `Renderer.ts`, add the import:

```ts
import type { Ripple } from "../../shared/cursor/ripples";
import { BG_FRAG, CURSOR_FRAG, QUAD_VERT, RIPPLE_FRAG, SCREEN_FRAG, SHADOW_FRAG } from "./shaders";
```

declare the field beside `cursorProgram`:

```ts
  private readonly rippleProgram: Program;
```

and link it in the constructor beside the cursor program:

```ts
    this.rippleProgram = link(gl, RIPPLE_FRAG, ["u_progress"]);
```

and draw before the cursor, inside the same `state.cursor !== undefined` block:

```ts
      if (state.cursor.style.ripples) {
        for (const r of state.ripples ?? []) {
          const size = (out.h / 1080) * 96;
          const x = quad.x + (r.x / src.w) * quad.w;
          const y = quad.y + (r.y / src.h) * quad.h;

          gl.useProgram(this.rippleProgram.program);
          gl.uniform1f(this.rippleProgram.uniforms.u_progress ?? null, r.progress);
          this.setRect(this.rippleProgram, x - size / 2, y - size / 2, size, size, out);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }
```

Add `ripples?: Ripple[]` to `FrameState`, and pass `ripplesAt(bundle.telemetry, tSource, 450)` from `Editor.tsx`'s `renderAt`.

- [ ] **Step 6: Verify parity and commit**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck; npm run verify:parity"
```

```bash
git add src/shared/cursor src/renderer/gl src/renderer/ui/Editor.tsx
git commit -m "feat: click ripples"
```

---

## Task 9: Cursor controls in the inspector

**Files:**
- Modify: `src/renderer/ui/Inspector.tsx`

**Interfaces:**
- Consumes: `CursorStyle` (Task 6)
- Produces: nothing downstream

- [ ] **Step 1: Extend the inspector's props**

`Inspector.tsx` currently takes `{ config: ZoomConfig; onChange }` and renders a flat list of numeric fields from `FIELDS`. Add a parallel style section rather than forcing cursor settings through `FIELDS`, which is typed to `keyof ZoomConfig`:

```tsx
type Props = {
  config: ZoomConfig;
  onChange: (next: ZoomConfig) => void;
  cursor: CursorStyle;
  onCursorChange: (next: CursorStyle) => void;
};
```

- [ ] **Step 2: Render the section**

Add below the existing field list:

```tsx
      <div style={{ marginTop: 16 }}>
        <div style={{ opacity: 0.6, marginBottom: 6 }}>cursor</div>

        <label style={row}>
          <span>visible</span>
          <input
            type="checkbox"
            checked={cursor.visible}
            onChange={(e) => onCursorChange({ ...cursor, visible: e.target.checked })}
          />
        </label>

        <label style={row}>
          <span>size (%)</span>
          <input
            type="number"
            step={10}
            value={cursor.sizePct}
            onChange={(e) =>
              onCursorChange({ ...cursor, sizePct: Number(e.target.value) })
            }
          />
        </label>

        <label style={row}>
          <span>smoothing</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cursor.smoothing}
            onChange={(e) =>
              onCursorChange({ ...cursor, smoothing: Number(e.target.value) })
            }
          />
        </label>

        <label style={row}>
          <span>shadow</span>
          <input
            type="checkbox"
            checked={cursor.shadow}
            onChange={(e) => onCursorChange({ ...cursor, shadow: e.target.checked })}
          />
        </label>

        <label style={row}>
          <span>ripples</span>
          <input
            type="checkbox"
            checked={cursor.ripples}
            onChange={(e) => onCursorChange({ ...cursor, ripples: e.target.checked })}
          />
        </label>
      </div>
```

- [ ] **Step 3: Wire it from the editor**

In `Editor.tsx`, pass the new props to `<Inspector>`, writing changes into the project the same way zoom config changes are already written:

```tsx
        cursor={project.style.cursor}
        onCursorChange={(cursor) =>
          setProject((p) => ({ ...p, style: { ...p.style, cursor } }))
        }
```

- [ ] **Step 4: Check it by hand**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run build; npx electron ."
```

Open a recording, change size and smoothing, confirm the preview updates live and the values survive closing and reopening the take.

- [ ] **Step 5: Full verification and commit**

```bash
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck; npm run verify:decode; npm run verify:parity"
```

```bash
git add src/renderer/ui
git commit -m "feat: cursor controls in the inspector"
```

---

## Task 10: Update the handover

**Files:**
- Modify: `HANDOVER.md`

- [ ] **Step 1: Record what changed**

Update the test count, add koffi to the things that will bite you (a native dependency that must stay out of the asar), note that `hasCursorShapes` is now true so older bundles have no shape stream and fall back to arrow, and move "9 — polish: cursor shapes" out of *What is NOT built*, leaving click-ripple polish and any remaining phase 9 items.

- [ ] **Step 2: Commit**

```bash
git add HANDOVER.md
git commit -m "docs: handover for the cursor pipeline"
```

---

## Phases B–F

These are **not** expanded into steps here, deliberately.

The writing-plans skill requires each plan to produce working, testable software on its own, and each task to be concrete enough that an engineer with no context can execute it. Phase A meets that: at the end of task 10 the app records and draws a cursor, and every task has real code and a real test.

Phases C–F cannot meet it yet, because their tasks depend on decisions that only exist once A and B are built — what the texture cache looks like in practice, whether the follow damping needs velocity as well as position, how the timeline mapping behaves once segments are draggable. Writing those steps now would be inventing detail, which is the failure mode the skill's no-placeholder rule exists to prevent.

Each gets its own plan document, written when its dependencies land:

| Phase | Deliverable | Plan written after |
| --- | --- | --- |
| B | Background presets, blur, image, frame border, aspect/resolution controls, and the `style` UI that has never existed | can be written now — independent of A |
| C | Persisted zoom segments, follow-cursor camera, retuned transitions, preview performance fixes | A + B land |
| D | Directional motion blur driven by camera velocity | C lands |
| E | Draggable zoom segments on the timeline, segment/global popover, real cut regions, undo/redo | C lands |
| F | Clip speed — reverses v1 decision #9; property tests for a variable-slope timeline mapping come first, and abandoning it is an acceptable outcome | E lands |

Phase B is independent of A and can be planned immediately on request.
