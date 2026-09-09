# Phase E — Timeline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the timeline the place the take is edited — zoom segments drag and resize, a per-shot popover sets depth and camera, cuts become real regions, and every edit is undoable.

**Architecture:** All edit logic lands in pure `Project → Project` functions in `src/shared/project/edits.ts` and a pure `history.ts`, so the invariants (a segment's minimum length, no overlaps, the 100-entry cap) are unit-testable with no DOM. The renderer gets one mutation seam — `useProjectHistory` — replacing today's scattered `setProject` calls that each hand-patch `live.current`. The timeline splits into a ruler plus two lanes, each owning its own pointer handling.

**Tech Stack:** TypeScript, React 18, Electron, vitest. No new dependencies — `dnd-timeline` was considered and rejected (spec §10).

**Spec:** `docs/specs/2026-09-09-phase-e-timeline-editing-design.md`

## Global Constraints

- **Everything runs natively on Windows in PowerShell**, never under WSL: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"`. Reading, editing and `git` are fine directly on `/mnt/c/dev/zoomcast`.
- **No new npm dependencies.**
- Segment minimum length is `cfg.zoomInOverlapMs + cfg.transitionOutMs`, read from the live `ZoomConfig` — never a hardcoded constant (spec §2.3).
- Undo history cap is **100** entries (spec §2.5, v1 §6).
- Depth presets are the fractions `[0.25, 0.40, 0.55, 0.70, 0.85, 1.00]`; labels are computed at render time via `depthToScale(depth, ceiling)` (spec §2.4).
- Segments store **source** time; the timeline draws **output** time. Each edge maps independently through `outputToSource` (spec §7).
- `verify:parity` must stay **30/30** and `npm run tune -- all` output must be **unchanged** — nothing in this phase touches the renderer or the planner. Any change in either is a bug in Task 1.
- Editing a segment sets `pinned: true`; switching its camera does **not** (spec §2.1).

---

### Task 1: Split `applyPlan` into `replanFrom` and `deriveKeyframes`

The foundation. `Editor.applyPlan` currently fuses planning-from-telemetry with deriving-keyframes-from-segments, and every handler calls both. A segment drag needs only the second — re-planning on every pointermove would walk the whole telemetry array and re-derive every *other* segment, so dragging one shot could move its neighbours.

**Files:**
- Create: `src/shared/zoom/derive.ts`
- Create: `src/shared/zoom/derive.test.ts`
- Modify: `src/renderer/ui/Editor.tsx:142-175` (replace the `applyPlan` useCallback)

**Interfaces:**
- Consumes: `planZoom`, `replanSegments`, `replan`, `segmentsToKeyframes`, `outputSizeFor` — all existing.
- Produces:
  ```ts
  export type DeriveContext = {
    telemetry: TelemetryEvent[];
    cameraPath: CursorPath | null;
    source: Size;
    durationMs: number;
  };
  export type ZoomParts = { segments: ZoomSegment[]; keyframes: ZoomKeyframe[] };
  export function planContextFor(project: Project, ctx: DeriveContext): PlanContext;
  export function replanFrom(config: ZoomConfig, project: Project, ctx: DeriveContext): ZoomParts;
  export function deriveKeyframes(config: ZoomConfig, project: Project, ctx: DeriveContext): ZoomParts;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/shared/zoom/derive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveKeyframes, replanFrom, type DeriveContext } from "./derive";
import { defaultProject } from "../project/defaults";
import { DEFAULT_ZOOM_CONFIG } from "./config";
import type { Project } from "../project/types";
import type { ZoomSegment } from "./types";

const ctx: DeriveContext = {
  telemetry: [],
  cameraPath: null,
  source: { w: 1920, h: 1080 },
  durationMs: 10_000,
};

function projectWith(segments: ZoomSegment[]): Project {
  const base = defaultProject("test-bundle");
  return { ...base, zoom: { ...base.zoom, segments, keyframes: [] } };
}

const segment: ZoomSegment = {
  id: "s1",
  startMs: 2000,
  endMs: 6000,
  position: "fixed",
  waypoints: [{ id: "w1", tMs: 2500, depth: 0.5, cx: 0.5, cy: 0.5 }],
  origin: "auto",
  pinned: true,
};

describe("deriveKeyframes", () => {
  it("returns the segments it was given, untouched", () => {
    const out = deriveKeyframes(DEFAULT_ZOOM_CONFIG, projectWith([segment]), ctx);
    expect(out.segments).toEqual([segment]);
  });

  it("rebuilds keyframes from those segments", () => {
    const out = deriveKeyframes(DEFAULT_ZOOM_CONFIG, projectWith([segment]), ctx);
    expect(out.keyframes.length).toBeGreaterThan(0);
    expect(out.keyframes.every((k) => k.tSourceMs >= 0)).toBe(true);
  });

  it("does not consult telemetry", () => {
    // No telemetry at all, yet a segment still produces keyframes: proof that
    // deriving is independent of planning.
    const out = deriveKeyframes(DEFAULT_ZOOM_CONFIG, projectWith([segment]), {
      ...ctx,
      telemetry: [],
    });
    expect(out.keyframes.length).toBeGreaterThan(0);
  });
});

describe("replanFrom", () => {
  it("drops an unpinned auto segment when telemetry is empty", () => {
    const auto: ZoomSegment = { ...segment, pinned: false, origin: "auto" };
    const out = replanFrom(DEFAULT_ZOOM_CONFIG, projectWith([auto]), ctx);
    expect(out.segments).toEqual([]);
  });

  it("keeps a pinned segment when telemetry is empty", () => {
    const out = replanFrom(DEFAULT_ZOOM_CONFIG, projectWith([segment]), ctx);
    expect(out.segments.map((s) => s.id)).toEqual(["s1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/zoom/derive.test.ts"`
Expected: FAIL — `Failed to resolve import "./derive"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/zoom/derive.ts`:

```ts
import type { CursorPath } from "../cursor/path";
import type { Project } from "../project/types";
import { outputSizeFor } from "../style/aspect";
import type { TelemetryEvent } from "../bundle/types";
import { segmentsToKeyframes } from "./keyframes";
import { planZoom } from "./planner";
import { replan, replanSegments } from "./replan";
import type { PlanContext, Size, ZoomConfig, ZoomKeyframe, ZoomSegment } from "./types";

/**
 * Everything the two derivations need that does not live on the project.
 *
 * `cameraPath` is nullable because only `position: "follow"` segments read it;
 * the tune tool and the tests never build one.
 */
export type DeriveContext = {
  telemetry: TelemetryEvent[];
  cameraPath: CursorPath | null;
  source: Size;
  durationMs: number;
};

export type ZoomParts = { segments: ZoomSegment[]; keyframes: ZoomKeyframe[] };

export function planContextFor(project: Project, ctx: DeriveContext): PlanContext {
  return {
    source: ctx.source,
    // The zoom ceiling derives from the output size, so a re-plan after an
    // aspect change must see the new shape or it plans for the old one.
    output: outputSizeFor(project.output, ctx.source),
    paddingFactor: project.style.paddingFactor,
    durationMs: ctx.durationMs,
  };
}

/**
 * Telemetry -> segments -> keyframes. The full pass.
 *
 * Call this on load, and whenever a global dial moves: the pacing config or
 * the output aspect. It regenerates every segment the user has not claimed,
 * so it must NOT run in response to a direct segment edit.
 */
export function replanFrom(
  config: ZoomConfig,
  project: Project,
  ctx: DeriveContext,
): ZoomParts {
  const planCtx = planContextFor(project, ctx);
  const segments = replanSegments(
    project.zoom.segments,
    planZoom(ctx.telemetry, config, planCtx),
  );

  return {
    segments,
    keyframes: replan(
      project.zoom.keyframes,
      segmentsToKeyframes(segments, config, planCtx, ctx.cameraPath),
    ),
  };
}

/**
 * Segments -> keyframes. The half a direct edit needs.
 *
 * Keyframes are derived, so moving, resizing or re-depthing a segment must
 * rebuild them — but running the planner as well would walk the whole
 * telemetry array on every commit and re-derive every OTHER segment, so
 * dragging one shot could move its neighbours.
 */
export function deriveKeyframes(
  config: ZoomConfig,
  project: Project,
  ctx: DeriveContext,
): ZoomParts {
  const planCtx = planContextFor(project, ctx);

  return {
    segments: project.zoom.segments,
    keyframes: replan(
      project.zoom.keyframes,
      segmentsToKeyframes(project.zoom.segments, config, planCtx, ctx.cameraPath),
    ),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/zoom/derive.test.ts"`
Expected: PASS, 5 tests.

If `defaultProject` does not take a bundle id, or `DEFAULT_ZOOM_CONFIG` is exported under another name, read `src/shared/project/defaults.ts` and `src/shared/zoom/config.ts` and correct the test's imports — do not change `derive.ts` to match a wrong guess.

- [ ] **Step 5: Rewire `Editor.tsx` to use it**

Replace the `applyPlan` useCallback (currently `src/renderer/ui/Editor.tsx:142-175`) with a memoised context plus the two calls:

```ts
const deriveCtx = useMemo<DeriveContext>(
  () => ({
    telemetry: bundle.telemetry,
    cameraPath,
    source: { w: manifest.video.width, h: manifest.video.height },
    durationMs: manifest.durationMs,
  }),
  [bundle.telemetry, cameraPath, manifest.video.width, manifest.video.height, manifest.durationMs],
);
```

Add the import `import { deriveKeyframes, replanFrom, type DeriveContext } from "../../shared/zoom/derive";` and drop the now-unused `planZoom`, `replan`, `replanSegments`, `segmentsToKeyframes`, `outputSizeFor` and `PlanContext` imports **only if nothing else in the file still uses them** — `outputSizeFor` in particular is used elsewhere for the preview context. Check with a grep before removing each one.

Then change the three existing call sites to `replanFrom(config, withConfig, deriveCtx)` (in `onConfigChange`), `replanFrom(withOutput.zoom.config, withOutput, deriveCtx)` (in `onOutputChange`) and `replanFrom(withSegment.zoom.config, withSegment, deriveCtx)` (in `onSegmentCameraChange`). All three keep `replanFrom` — no behaviour changes in this task. `deriveKeyframes` gets its first caller in Task 7.

- [ ] **Step 6: Verify nothing moved**

Run all of:

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run verify:parity"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run tune -- all"
```

Expected: tests pass, typecheck silent, parity **30/30**, and `tune -- all` output **byte-identical to before this task**. Capture the tune output before starting and diff it. A difference means the extraction changed behaviour and must be fixed, not accepted.

- [ ] **Step 7: Commit**

```bash
git add src/shared/zoom/derive.ts src/shared/zoom/derive.test.ts src/renderer/ui/Editor.tsx
git commit -m "refactor: separate re-planning from deriving keyframes"
```

---

### Task 2: `Cut` gains an id

`normalizeCuts` sorts and **merges**, so a cut's array index is not stable across the one function every cut edit routes through. A drag addressing `cuts[2]` can find itself moving `cuts[1]` mid-gesture. Ids fix that before any drag code exists.

**Files:**
- Modify: `src/shared/project/types.ts` (the `Cut` type)
- Modify: `src/shared/project/cuts.ts` (`normalizeCuts`)
- Modify: `src/shared/project/cuts.test.ts`
- Modify: `src/shared/project/migrate.ts:98`
- Modify: `src/renderer/ui/Editor.tsx` (`addCut` supplies an id)

**Interfaces:**
- Produces:
  ```ts
  export type Cut = { id: string; startMs: number; endMs: number };
  export function normalizeCuts(cuts: Cut[], durationMs: number, preferId?: string): Cut[];
  ```
  `preferId` makes the named cut the survivor of any merge it takes part in. Without it a dragged cut can be absorbed by the one it overlaps, leaving the gesture addressing a cut that no longer exists.

- [ ] **Step 1: Write the failing tests**

Add to `src/shared/project/cuts.test.ts`:

```ts
it("keeps the earlier cut's id when merging", () => {
  const out = normalizeCuts(
    [
      { id: "a", startMs: 100, endMs: 400 },
      { id: "b", startMs: 300, endMs: 600 },
    ],
    1000,
  );
  expect(out).toEqual([{ id: "a", startMs: 100, endMs: 600 }]);
});

it("keeps the preferred cut's id when merging", () => {
  const out = normalizeCuts(
    [
      { id: "a", startMs: 100, endMs: 400 },
      { id: "b", startMs: 300, endMs: 600 },
    ],
    1000,
    "b",
  );
  expect(out).toEqual([{ id: "b", startMs: 100, endMs: 600 }]);
});

it("ignores a preferId that is not present", () => {
  const out = normalizeCuts(
    [
      { id: "a", startMs: 100, endMs: 400 },
      { id: "b", startMs: 300, endMs: 600 },
    ],
    1000,
    "zzz",
  );
  expect(out).toEqual([{ id: "a", startMs: 100, endMs: 600 }]);
});
```

Every existing test in this file constructs cuts without an id and will now fail to typecheck. Add an `id` to each — `{ id: "c1", startMs: 500, endMs: 600 }` and so on — and update the `toEqual` expectations to match. Where a test asserts only `out.map((c) => c.startMs)`, no expectation change is needed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/cuts.test.ts"`
Expected: FAIL — the two new merge tests fail on the missing `id` property.

- [ ] **Step 3: Add the id to the type**

In `src/shared/project/types.ts`:

```ts
export type Cut = { id: string; startMs: number; endMs: number };
```

- [ ] **Step 4: Carry the id through `normalizeCuts`**

Replace the body of `normalizeCuts` in `src/shared/project/cuts.ts`:

```ts
/**
 * Sort, repair, clamp and merge cuts.
 *
 * Every timeline function normalises first, so the mapping functions can
 * assume sorted, non-overlapping, in-range cuts and stay simple enough to
 * reason about — which matters, because that mapping is where off-by-ones live.
 *
 * `preferId` names a cut that must survive any merge it takes part in. A drag
 * passes the cut it is moving: without it, dragging cut B onto cut A destroys
 * B mid-gesture and the drag is left addressing a cut that is gone.
 */
export function normalizeCuts(
  cuts: Cut[],
  durationMs: number,
  preferId?: string,
): Cut[] {
  const cleaned = cuts
    .map((c) => ({
      id: c.id,
      startMs: Math.max(0, Math.min(c.startMs, c.endMs)),
      endMs: Math.min(durationMs, Math.max(c.startMs, c.endMs)),
    }))
    .filter((c) => c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const out: Cut[] = [];

  for (const c of cleaned) {
    const last = out[out.length - 1];
    if (last !== undefined && c.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, c.endMs);
      if (c.id === preferId) last.id = c.id;
      continue;
    }
    out.push({ ...c });
  }

  return out;
}
```

- [ ] **Step 5: Repair persisted projects**

In `src/shared/project/migrate.ts`, replace line 98's unchecked pass-through:

```ts
    cuts: Array.isArray(raw.cuts)
      ? (raw.cuts as unknown[]).flatMap((c, i) => {
          if (!isRecord(c)) return [];
          const startMs = num(c.startMs, 0);
          const endMs = num(c.endMs, 0);
          if (endMs <= startMs) return [];
          // Cuts written before ids existed get a deterministic one, so the
          // same project.json migrates to the same ids every load.
          return [{ id: str(c.id, `cut-${i}`), startMs, endMs }];
        })
      : base.cuts,
```

- [ ] **Step 6: Supply an id at the one existing call site**

In `src/renderer/ui/Editor.tsx`, `addCut` builds a `Cut` literal. Add an id:

```ts
    const cut: Cut = { id: crypto.randomUUID(), startMs: srcStart, endMs: srcEnd };
```

`crypto.randomUUID` is available in the Electron renderer and in Node 19+, so it works in both the app and the test runner. This call site is replaced entirely in Task 10; the id is added now so the tree typechecks.

- [ ] **Step 7: Run the tests**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"` then `npm run typecheck`.
Expected: all pass, typecheck silent. Other test files construct `Cut` literals — `timeline.test.ts` and `migrate.test.ts` at least. Add ids to each until typecheck is silent.

- [ ] **Step 8: Commit**

```bash
git add src/shared/project/ src/renderer/ui/Editor.tsx
git commit -m "feat: cuts get ids, so a drag can address one stably"
```

---

### Task 3: `history.ts`

**Files:**
- Create: `src/shared/project/history.ts`
- Create: `src/shared/project/history.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Selection = { kind: "segment" | "cut"; id: string } | null;
  export type Entry = { project: Project; selection: Selection };
  export type History = { past: Entry[]; present: Entry; future: Entry[]; gestureOpen: boolean };
  export const HISTORY_CAP = 100;
  export function createHistory(present: Entry): History;
  export function push(h: History, next: Entry): History;
  export function beginOrExtend(h: History, next: Entry): History;
  export function commit(h: History): History;
  export function undo(h: History): History;
  export function redo(h: History): History;
  export function canUndo(h: History): boolean;
  export function canRedo(h: History): boolean;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/shared/project/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  beginOrExtend,
  canRedo,
  canUndo,
  commit,
  createHistory,
  HISTORY_CAP,
  push,
  redo,
  undo,
  type Entry,
} from "./history";
import { defaultProject } from "./defaults";

const base = defaultProject("test-bundle");

/** Entries differing only in a field cheap to vary. */
function entry(micGainDb: number, selection: Entry["selection"] = null): Entry {
  return { project: { ...base, audio: { ...base.audio, micGainDb } }, selection };
}

describe("push", () => {
  it("moves the present into the past", () => {
    const h = push(createHistory(entry(0)), entry(1));
    expect(h.present.project.audio.micGainDb).toBe(1);
    expect(h.past).toHaveLength(1);
    expect(h.past[0].project.audio.micGainDb).toBe(0);
  });

  it("records nothing when the entry is deep-equal to the present", () => {
    const h = push(createHistory(entry(0)), entry(0));
    expect(h.past).toHaveLength(0);
  });

  it("treats a selection-only change as a real change", () => {
    const h = push(createHistory(entry(0)), entry(0, { kind: "segment", id: "s1" }));
    expect(h.past).toHaveLength(1);
  });

  it("clears the future", () => {
    const h = undo(push(createHistory(entry(0)), entry(1)));
    expect(canRedo(h)).toBe(true);
    expect(canRedo(push(h, entry(2)))).toBe(false);
  });

  it("caps the past at HISTORY_CAP, dropping the oldest", () => {
    let h = createHistory(entry(0));
    for (let i = 1; i <= HISTORY_CAP + 10; i += 1) h = push(h, entry(i));
    expect(h.past).toHaveLength(HISTORY_CAP);
    // The oldest survivor, not the original entry(0).
    expect(h.past[0].project.audio.micGainDb).toBe(11);
  });
});

describe("undo / redo", () => {
  it("round trips", () => {
    const h = push(createHistory(entry(0)), entry(1));
    const back = undo(h);
    expect(back.present.project.audio.micGainDb).toBe(0);
    expect(redo(back).present.project.audio.micGainDb).toBe(1);
  });

  it("restores the selection alongside the project", () => {
    const h = push(createHistory(entry(0, { kind: "segment", id: "s1" })), entry(1, null));
    expect(undo(h).present.selection).toEqual({ kind: "segment", id: "s1" });
  });

  it("is a no-op at the ends", () => {
    const h = createHistory(entry(0));
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(canRedo(h)).toBe(false);
    expect(redo(h)).toBe(h);
  });
});

describe("gestures", () => {
  it("leaves exactly one entry for many extends and one commit", () => {
    let h = createHistory(entry(0));
    h = beginOrExtend(h, entry(1));
    h = beginOrExtend(h, entry(2));
    h = beginOrExtend(h, entry(3));
    h = commit(h);
    expect(h.past).toHaveLength(1);
    expect(h.past[0].project.audio.micGainDb).toBe(0);
    expect(h.present.project.audio.micGainDb).toBe(3);
    expect(h.gestureOpen).toBe(false);
  });

  it("undoes the whole gesture in one step", () => {
    let h = createHistory(entry(0));
    h = commit(beginOrExtend(beginOrExtend(h, entry(1)), entry(2)));
    expect(undo(h).present.project.audio.micGainDb).toBe(0);
  });

  it("leaves no entry for a gesture that returns to its start", () => {
    let h = createHistory(entry(0));
    h = beginOrExtend(h, entry(1));
    h = beginOrExtend(h, entry(0));
    h = commit(h);
    expect(h.past).toHaveLength(0);
    expect(h.present.project.audio.micGainDb).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/history.test.ts"`
Expected: FAIL — `Failed to resolve import "./history"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/project/history.ts`:

```ts
import type { Project } from "./types";

/** What is selected in the timeline. Segments and cuts share one field. */
export type Selection = { kind: "segment" | "cut"; id: string } | null;

export type Entry = { project: Project; selection: Selection };

export type History = {
  past: Entry[];
  present: Entry;
  future: Entry[];
  /** Open while a drag is in flight. See `beginOrExtend`. */
  gestureOpen: boolean;
};

/** v1 §6: the document is small enough that nothing cleverer is warranted. */
export const HISTORY_CAP = 100;

export function createHistory(present: Entry): History {
  return { past: [], present, future: [], gestureOpen: false };
}

function same(a: Entry, b: Entry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function capped(past: Entry[]): Entry[] {
  return past.length > HISTORY_CAP ? past.slice(past.length - HISTORY_CAP) : past;
}

/**
 * Commit one edit.
 *
 * A no-op records nothing: a drag that ends where it started, or a depth
 * preset that re-selects the current depth, must not consume an undo slot.
 */
export function push(h: History, next: Entry): History {
  if (same(h.present, next)) return h;

  return {
    past: capped([...h.past, h.present]),
    present: next,
    future: [],
    gestureOpen: h.gestureOpen,
  };
}

/**
 * One step of a drag.
 *
 * The FIRST call of a gesture pushes, so the pre-drag state reaches `past`;
 * later calls only replace `present`. Without that first push the pre-drag
 * project is overwritten by the first pointermove and nothing holds it any
 * more.
 */
export function beginOrExtend(h: History, next: Entry): History {
  if (h.gestureOpen) {
    return { ...h, present: next, future: [] };
  }

  return { ...push(h, next), gestureOpen: true };
}

/**
 * End a drag.
 *
 * Unwinds the entry `beginOrExtend` pushed if the gesture turned out to be a
 * no-op — dragging a segment and putting it back must not cost an undo step.
 */
export function commit(h: History): History {
  if (!h.gestureOpen) return h;

  const previous = h.past[h.past.length - 1];
  if (previous !== undefined && same(previous, h.present)) {
    return { ...h, past: h.past.slice(0, -1), gestureOpen: false };
  }

  return { ...h, gestureOpen: false };
}

export function canUndo(h: History): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History): boolean {
  return h.future.length > 0;
}

export function undo(h: History): History {
  const previous = h.past[h.past.length - 1];
  if (previous === undefined) return h;

  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    gestureOpen: false,
  };
}

export function redo(h: History): History {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;

  return {
    past: capped([...h.past, h.present]),
    present: next,
    future: rest,
    gestureOpen: false,
  };
}
```

`JSON.stringify` is the equality test because `Project` is plain JSON — it is written to `project.json` verbatim — so there are no `Date`s, `Map`s, `undefined` values or cycles for it to mishandle, and key order is stable because every entry is built by spreading the same object.

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/history.test.ts"`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/project/history.ts src/shared/project/history.test.ts
git commit -m "feat: undo/redo history with drag-gesture coalescing"
```

---

### Task 4: `edits.ts` — segment operations

**Files:**
- Create: `src/shared/project/edits.ts`
- Create: `src/shared/project/edits.test.ts`

**Interfaces:**
- Consumes: `Cut` with an id (Task 2).
- Produces:
  ```ts
  export function minSegmentMs(cfg: ZoomConfig): number;
  export function moveSegment(p: Project, id: string, deltaMs: number, durationMs: number): Project;
  export function resizeSegment(p: Project, id: string, edge: "start" | "end", tMs: number, durationMs: number): Project;
  export function setSegmentDepth(p: Project, id: string, depth: number): Project;
  export function setSegmentCamera(p: Project, id: string, position: "fixed" | "follow"): Project;
  export function deleteSegment(p: Project, id: string): Project;
  export function resetSegment(p: Project, id: string): Project;
  ```
  Every one returns `p` unchanged when `id` matches nothing.

- [ ] **Step 1: Write the failing test**

Create `src/shared/project/edits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  deleteSegment,
  minSegmentMs,
  moveSegment,
  resetSegment,
  resizeSegment,
  setSegmentCamera,
  setSegmentDepth,
} from "./edits";
import { defaultProject } from "./defaults";
import type { Project } from "./types";
import type { ZoomSegment } from "../zoom/types";

const DURATION = 30_000;

function seg(id: string, startMs: number, endMs: number): ZoomSegment {
  return {
    id,
    startMs,
    endMs,
    position: "fixed",
    waypoints: [
      { id: `${id}-w1`, tMs: startMs + 500, depth: 0.5, cx: 0.5, cy: 0.5 },
      { id: `${id}-w2`, tMs: startMs + 1500, depth: 0.5, cx: 0.6, cy: 0.4 },
    ],
    origin: "auto",
    pinned: false,
  };
}

function withSegments(segments: ZoomSegment[]): Project {
  const base = defaultProject("test-bundle");
  return { ...base, zoom: { ...base.zoom, segments, keyframes: [] } };
}

const find = (p: Project, id: string): ZoomSegment =>
  p.zoom.segments.find((s) => s.id === id) as ZoomSegment;

describe("minSegmentMs", () => {
  it("is the settle plus the pull-out, from the live config", () => {
    const cfg = defaultProject("b").zoom.config;
    expect(minSegmentMs(cfg)).toBe(cfg.zoomInOverlapMs + cfg.transitionOutMs);
  });
});

describe("moveSegment", () => {
  it("shifts both edges and pins", () => {
    const p = moveSegment(withSegments([seg("a", 5000, 9000)]), "a", 1000, DURATION);
    expect(find(p, "a").startMs).toBe(6000);
    expect(find(p, "a").endMs).toBe(10_000);
    expect(find(p, "a").pinned).toBe(true);
  });

  it("shifts the waypoints with the segment", () => {
    const p = moveSegment(withSegments([seg("a", 5000, 9000)]), "a", 1000, DURATION);
    expect(find(p, "a").waypoints.map((w) => w.tMs)).toEqual([6500, 7500]);
  });

  it("clamps at zero without shrinking", () => {
    const p = moveSegment(withSegments([seg("a", 1000, 5000)]), "a", -4000, DURATION);
    expect(find(p, "a").startMs).toBe(0);
    expect(find(p, "a").endMs).toBe(4000);
  });

  it("clamps at the take end without shrinking", () => {
    const p = moveSegment(withSegments([seg("a", 25_000, 29_000)]), "a", 5000, DURATION);
    expect(find(p, "a").endMs).toBe(DURATION);
    expect(find(p, "a").startMs).toBe(26_000);
  });

  it("stops at the following neighbour rather than overlapping it", () => {
    const p = moveSegment(
      withSegments([seg("a", 2000, 6000), seg("b", 8000, 12_000)]),
      "a",
      5000,
      DURATION,
    );
    expect(find(p, "a").endMs).toBe(8000);
    expect(find(p, "a").startMs).toBe(4000);
  });

  it("stops at the preceding neighbour rather than overlapping it", () => {
    const p = moveSegment(
      withSegments([seg("a", 2000, 6000), seg("b", 8000, 12_000)]),
      "b",
      -5000,
      DURATION,
    );
    expect(find(p, "b").startMs).toBe(6000);
    expect(find(p, "b").endMs).toBe(10_000);
  });

  it("returns the project unchanged for an unknown id", () => {
    const p = withSegments([seg("a", 2000, 6000)]);
    expect(moveSegment(p, "nope", 1000, DURATION)).toBe(p);
  });
});

describe("resizeSegment", () => {
  it("moves the start edge and pins", () => {
    const p = resizeSegment(withSegments([seg("a", 5000, 12_000)]), "a", "start", 7000, DURATION);
    expect(find(p, "a").startMs).toBe(7000);
    expect(find(p, "a").endMs).toBe(12_000);
    expect(find(p, "a").pinned).toBe(true);
  });

  it("stops the start edge at the minimum length", () => {
    const p0 = withSegments([seg("a", 5000, 12_000)]);
    const min = minSegmentMs(p0.zoom.config);
    const p = resizeSegment(p0, "a", "start", 11_900, DURATION);
    expect(find(p, "a").startMs).toBe(12_000 - min);
  });

  it("stops the end edge at the minimum length", () => {
    const p0 = withSegments([seg("a", 5000, 12_000)]);
    const min = minSegmentMs(p0.zoom.config);
    const p = resizeSegment(p0, "a", "end", 5100, DURATION);
    expect(find(p, "a").endMs).toBe(5000 + min);
  });

  it("stops the end edge at the following neighbour", () => {
    const p = resizeSegment(
      withSegments([seg("a", 2000, 6000), seg("b", 9000, 14_000)]),
      "a",
      "end",
      12_000,
      DURATION,
    );
    expect(find(p, "a").endMs).toBe(9000);
  });

  it("stops the start edge at the preceding neighbour", () => {
    const p = resizeSegment(
      withSegments([seg("a", 2000, 6000), seg("b", 9000, 14_000)]),
      "b",
      "start",
      3000,
      DURATION,
    );
    expect(find(p, "b").startMs).toBe(6000);
  });

  it("clamps the start edge at zero", () => {
    const p = resizeSegment(withSegments([seg("a", 2000, 9000)]), "a", "start", -500, DURATION);
    expect(find(p, "a").startMs).toBe(0);
  });

  it("clamps the end edge at the take length", () => {
    const p = resizeSegment(withSegments([seg("a", 2000, 9000)]), "a", "end", 40_000, DURATION);
    expect(find(p, "a").endMs).toBe(DURATION);
  });
});

describe("setSegmentDepth", () => {
  it("writes the depth to every waypoint and pins", () => {
    const p = setSegmentDepth(withSegments([seg("a", 2000, 6000)]), "a", 0.85);
    expect(find(p, "a").waypoints.map((w) => w.depth)).toEqual([0.85, 0.85]);
    expect(find(p, "a").pinned).toBe(true);
  });

  it("clamps to 0..1", () => {
    const p = setSegmentDepth(withSegments([seg("a", 2000, 6000)]), "a", 4);
    expect(find(p, "a").waypoints.every((w) => w.depth === 1)).toBe(true);
  });
});

describe("setSegmentCamera", () => {
  it("switches the camera WITHOUT pinning", () => {
    const p = setSegmentCamera(withSegments([seg("a", 2000, 6000)]), "a", "follow");
    expect(find(p, "a").position).toBe("follow");
    expect(find(p, "a").pinned).toBe(false);
  });
});

describe("deleteSegment", () => {
  it("removes it", () => {
    const p = deleteSegment(withSegments([seg("a", 2000, 6000), seg("b", 8000, 12_000)]), "a");
    expect(p.zoom.segments.map((s) => s.id)).toEqual(["b"]);
  });
});

describe("resetSegment", () => {
  it("unpins so the planner reclaims it", () => {
    const pinned = withSegments([{ ...seg("a", 2000, 6000), pinned: true }]);
    expect(find(resetSegment(pinned, "a"), "a").pinned).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/edits.test.ts"`
Expected: FAIL — `Failed to resolve import "./edits"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/project/edits.ts`:

```ts
import type { ZoomConfig, ZoomSegment } from "../zoom/types";
import type { Project } from "./types";

/**
 * The shortest shot with any hold in it.
 *
 * The camera settles `zoomInOverlapMs` after a segment starts and pulls out
 * over `transitionOutMs`. Below their sum the shot arrives and immediately
 * leaves, which is the flinch `applySegmentGuards` exists to prevent.
 *
 * Derived from the live config, never a constant: a user who lowers
 * `transitionOutMs` has earned a shorter floor.
 */
export function minSegmentMs(cfg: ZoomConfig): number {
  return cfg.zoomInOverlapMs + cfg.transitionOutMs;
}

function replaceSegment(
  p: Project,
  id: string,
  fn: (s: ZoomSegment, neighbours: { prevEnd: number; nextStart: number }) => ZoomSegment,
  durationMs: number,
): Project {
  const ordered = [...p.zoom.segments].sort((a, b) => a.startMs - b.startMs);
  const i = ordered.findIndex((s) => s.id === id);
  if (i === -1) return p;

  const target = ordered[i] as ZoomSegment;
  const neighbours = {
    prevEnd: ordered[i - 1]?.endMs ?? 0,
    nextStart: ordered[i + 1]?.startMs ?? durationMs,
  };

  return {
    ...p,
    zoom: {
      ...p.zoom,
      segments: ordered.map((s) => (s.id === id ? fn(target, neighbours) : s)),
    },
  };
}

/**
 * Slide a whole shot, keeping its length.
 *
 * Clamps against the take and against both neighbours; a segment cannot be
 * dragged past another, because two overlapping segments emit keyframes
 * competing for the same instants and the camera would be told two things at
 * once. See `replanSegments`.
 */
export function moveSegment(
  p: Project,
  id: string,
  deltaMs: number,
  durationMs: number,
): Project {
  return replaceSegment(
    p,
    id,
    (s, { prevEnd, nextStart }) => {
      const length = s.endMs - s.startMs;
      const lo = prevEnd;
      const hi = nextStart - length;
      const startMs = Math.max(lo, Math.min(hi, s.startMs + deltaMs));
      const shift = startMs - s.startMs;

      return {
        ...s,
        startMs,
        endMs: startMs + length,
        waypoints: s.waypoints.map((w) => ({ ...w, tMs: w.tMs + shift })),
        pinned: true,
      };
    },
    durationMs,
  );
}

/** Move one edge. The other stays put; the shot changes length. */
export function resizeSegment(
  p: Project,
  id: string,
  edge: "start" | "end",
  tMs: number,
  durationMs: number,
): Project {
  const min = minSegmentMs(p.zoom.config);

  return replaceSegment(
    p,
    id,
    (s, { prevEnd, nextStart }) => {
      if (edge === "start") {
        const startMs = Math.max(prevEnd, Math.min(s.endMs - min, tMs));
        return { ...s, startMs, pinned: true };
      }

      const endMs = Math.min(nextStart, Math.max(s.startMs + min, tMs));
      return { ...s, endMs, pinned: true };
    },
    durationMs,
  );
}

/**
 * One depth for the whole shot.
 *
 * A travelling segment holds one depth and pans; varying depth across
 * waypoints is not exposed, so this writes to all of them.
 */
export function setSegmentDepth(p: Project, id: string, depth: number): Project {
  const clamped = Math.max(0, Math.min(1, depth));

  return replaceSegment(
    p,
    id,
    (s) => ({
      ...s,
      waypoints: s.waypoints.map((w) => ({ ...w, depth: clamped })),
      pinned: true,
    }),
    Number.POSITIVE_INFINITY,
  );
}

/**
 * Switch one shot's camera.
 *
 * Deliberately does NOT pin. Pinning would keep the whole segment wholesale,
 * so the shot would stop re-planning its times when a pacing dial moves —
 * which is not what "switch this shot to follow" asks for. `replanSegments`
 * carries the choice across by id instead.
 */
export function setSegmentCamera(
  p: Project,
  id: string,
  position: "fixed" | "follow",
): Project {
  return replaceSegment(p, id, (s) => ({ ...s, position }), Number.POSITIVE_INFINITY);
}

export function deleteSegment(p: Project, id: string): Project {
  const segments = p.zoom.segments.filter((s) => s.id !== id);
  if (segments.length === p.zoom.segments.length) return p;
  return { ...p, zoom: { ...p.zoom, segments } };
}

/** Hand the shot back to the planner. The caller must re-plan afterwards. */
export function resetSegment(p: Project, id: string): Project {
  return replaceSegment(
    p,
    id,
    (s) => ({ ...s, pinned: false }),
    Number.POSITIVE_INFINITY,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/edits.test.ts"`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/project/edits.ts src/shared/project/edits.test.ts
git commit -m "feat: pure segment edit operations with their invariants"
```

---

### Task 5: `edits.ts` — cut operations

**Files:**
- Modify: `src/shared/project/edits.ts`
- Modify: `src/shared/project/edits.test.ts`

**Interfaces:**
- Consumes: `normalizeCuts(cuts, durationMs, preferId?)` from Task 2.
- Produces:
  ```ts
  export function addCut(p: Project, id: string, startMs: number, endMs: number, durationMs: number): Project;
  export function moveCut(p: Project, id: string, deltaMs: number, durationMs: number): Project;
  export function resizeCut(p: Project, id: string, edge: "start" | "end", tMs: number, durationMs: number): Project;
  export function deleteCut(p: Project, id: string): Project;
  ```
  `addCut` takes the id rather than generating one, so the module stays pure and the tests stay deterministic. The renderer passes `crypto.randomUUID()`.

- [ ] **Step 1: Write the failing test**

Append to `src/shared/project/edits.test.ts`. The two import lines below merge
into the file's existing import block at the top rather than sitting mid-file —
`addCut, deleteCut, MIN_CUT_MS, moveCut, resizeCut` join the existing
`from "./edits"` import, and `Cut` joins the `from "./types"` one:

```ts
import { addCut, deleteCut, MIN_CUT_MS, moveCut, resizeCut } from "./edits";
import type { Cut } from "./types";

function withCuts(cuts: Cut[]): Project {
  return { ...defaultProject("test-bundle"), cuts };
}

describe("addCut", () => {
  it("appends a cut with the id it was given", () => {
    const p = addCut(withCuts([]), "c1", 2000, 3000, DURATION);
    expect(p.cuts).toEqual([{ id: "c1", startMs: 2000, endMs: 3000 }]);
  });

  it("merges into an overlapping cut", () => {
    const p = addCut(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "c1", 3000, 5000, DURATION);
    expect(p.cuts).toEqual([{ id: "a", startMs: 2000, endMs: 5000 }]);
  });

  it("ignores a zero-length cut", () => {
    const p = withCuts([]);
    expect(addCut(p, "c1", 2000, 2000, DURATION).cuts).toEqual([]);
  });
});

describe("moveCut", () => {
  it("shifts both edges", () => {
    const p = moveCut(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", 1000, DURATION);
    expect(p.cuts).toEqual([{ id: "a", startMs: 3000, endMs: 5000 }]);
  });

  it("clamps at zero without shrinking", () => {
    const p = moveCut(withCuts([{ id: "a", startMs: 1000, endMs: 3000 }]), "a", -5000, DURATION);
    expect(p.cuts).toEqual([{ id: "a", startMs: 0, endMs: 2000 }]);
  });

  it("keeps the moved cut's id when it merges into another", () => {
    const p = moveCut(
      withCuts([
        { id: "a", startMs: 2000, endMs: 4000 },
        { id: "b", startMs: 8000, endMs: 10_000 },
      ]),
      "b",
      -5000,
      DURATION,
    );
    expect(p.cuts).toEqual([{ id: "b", startMs: 2000, endMs: 5000 }]);
  });
});

describe("resizeCut", () => {
  it("moves the end edge", () => {
    const p = resizeCut(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "end", 6000, DURATION);
    expect(p.cuts).toEqual([{ id: "a", startMs: 2000, endMs: 6000 }]);
  });

  it("stops the end edge at the minimum cut length", () => {
    const p = resizeCut(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "end", 2010, DURATION);
    expect(p.cuts[0].endMs).toBe(2000 + MIN_CUT_MS);
  });

  it("stops the start edge at the minimum cut length", () => {
    const p = resizeCut(withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]), "a", "start", 3990, DURATION);
    expect(p.cuts[0].startMs).toBe(4000 - MIN_CUT_MS);
  });
});

describe("deleteCut", () => {
  it("removes it", () => {
    const p = deleteCut(
      withCuts([
        { id: "a", startMs: 2000, endMs: 4000 },
        { id: "b", startMs: 8000, endMs: 10_000 },
      ]),
      "a",
    );
    expect(p.cuts.map((c) => c.id)).toEqual(["b"]);
  });

  it("returns the project unchanged for an unknown id", () => {
    const p = withCuts([{ id: "a", startMs: 2000, endMs: 4000 }]);
    expect(deleteCut(p, "nope")).toBe(p);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/edits.test.ts"`
Expected: FAIL — `addCut is not a function` and the same for the other three.

- [ ] **Step 3: Write the implementation**

Append to `src/shared/project/edits.ts`:

```ts
import { normalizeCuts } from "./cuts";
import type { Cut } from "./types";

/**
 * The shortest cut worth having.
 *
 * Unlike a segment's floor this is arbitrary — a cut has no transitions to pay
 * for. It exists only so a stray click cannot author a 1ms cut that is
 * invisible and unclickable on the timeline.
 */
export const MIN_CUT_MS = 100;

function withCuts(p: Project, cuts: Cut[], durationMs: number, preferId?: string): Project {
  return { ...p, cuts: normalizeCuts(cuts, durationMs, preferId) };
}

/** The id comes from the caller so this stays pure and the tests stay stable. */
export function addCut(
  p: Project,
  id: string,
  startMs: number,
  endMs: number,
  durationMs: number,
): Project {
  return withCuts(p, [...p.cuts, { id, startMs, endMs }], durationMs);
}

/**
 * Slide a cut, keeping its length.
 *
 * `preferId` makes this cut the survivor of any merge: without it, dragging
 * one cut onto another destroys the dragged cut mid-gesture and the drag is
 * left addressing something that no longer exists.
 */
export function moveCut(
  p: Project,
  id: string,
  deltaMs: number,
  durationMs: number,
): Project {
  const target = p.cuts.find((c) => c.id === id);
  if (target === undefined) return p;

  const length = target.endMs - target.startMs;
  const startMs = Math.max(0, Math.min(durationMs - length, target.startMs + deltaMs));

  return withCuts(
    p,
    p.cuts.map((c) => (c.id === id ? { ...c, startMs, endMs: startMs + length } : c)),
    durationMs,
    id,
  );
}

export function resizeCut(
  p: Project,
  id: string,
  edge: "start" | "end",
  tMs: number,
  durationMs: number,
): Project {
  const target = p.cuts.find((c) => c.id === id);
  if (target === undefined) return p;

  const next =
    edge === "start"
      ? { ...target, startMs: Math.max(0, Math.min(target.endMs - MIN_CUT_MS, tMs)) }
      : {
          ...target,
          endMs: Math.min(durationMs, Math.max(target.startMs + MIN_CUT_MS, tMs)),
        };

  return withCuts(
    p,
    p.cuts.map((c) => (c.id === id ? next : c)),
    durationMs,
    id,
  );
}

export function deleteCut(p: Project, id: string): Project {
  const cuts = p.cuts.filter((c) => c.id !== id);
  if (cuts.length === p.cuts.length) return p;
  return { ...p, cuts };
}
```

Merge the new `import type { Cut }` into the existing `import type { Project } from "./types";` line rather than duplicating the module specifier.

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/edits.test.ts"`
Expected: PASS, 32 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/project/edits.ts src/shared/project/edits.test.ts
git commit -m "feat: pure cut edit operations"
```

---

### Task 6: Drag geometry helpers

Pure maths for the lanes. No DOM, so it is testable; the hook in Task 9 supplies the pointer events.

**Files:**
- Create: `src/renderer/ui/timeline/geometry.ts`
- Create: `src/renderer/ui/timeline/geometry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const EDGE_HIT_PX = 6;
  export const MIN_RESIZABLE_PX = 24;
  export type DragKind = "move" | "resize-start" | "resize-end";
  export function pxToMs(dx: number, trackWidthPx: number, outputDurationMs: number): number;
  export function msToPct(tMs: number, outputDurationMs: number): number;
  export function dragKindAt(offsetPx: number, regionWidthPx: number): DragKind;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/renderer/ui/timeline/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dragKindAt, EDGE_HIT_PX, MIN_RESIZABLE_PX, msToPct, pxToMs } from "./geometry";

describe("pxToMs", () => {
  it("scales a pixel delta into a time delta", () => {
    expect(pxToMs(100, 1000, 60_000)).toBe(6000);
  });

  it("is signed", () => {
    expect(pxToMs(-100, 1000, 60_000)).toBe(-6000);
  });

  it("is zero for a zero-width track rather than NaN or Infinity", () => {
    expect(pxToMs(100, 0, 60_000)).toBe(0);
  });
});

describe("msToPct", () => {
  it("maps a time onto a percentage of the track", () => {
    expect(msToPct(30_000, 60_000)).toBe(50);
  });

  it("is zero for a zero-length take rather than NaN", () => {
    expect(msToPct(0, 0)).toBe(0);
  });
});

describe("dragKindAt", () => {
  it("resizes from the left edge", () => {
    expect(dragKindAt(2, 200)).toBe("resize-start");
  });

  it("resizes from the right edge", () => {
    expect(dragKindAt(197, 200)).toBe("resize-end");
  });

  it("moves from the middle", () => {
    expect(dragKindAt(100, 200)).toBe("move");
  });

  it("treats exactly EDGE_HIT_PX in as the body", () => {
    expect(dragKindAt(EDGE_HIT_PX, 200)).toBe("move");
  });

  it("is move-only below the resizable width", () => {
    // A 1.5s shot on a 90s take is ~12px wide. If both ends were edges there
    // would be nothing left to grab.
    expect(dragKindAt(1, MIN_RESIZABLE_PX - 1)).toBe("move");
    expect(dragKindAt(MIN_RESIZABLE_PX - 2, MIN_RESIZABLE_PX - 1)).toBe("move");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/renderer/ui/timeline/geometry.test.ts"`
Expected: FAIL — `Failed to resolve import "./geometry"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/ui/timeline/geometry.ts`:

```ts
/** How close to an edge counts as grabbing it. */
export const EDGE_HIT_PX = 6;

/**
 * Below this rendered width a region is move-only.
 *
 * A 1.5s shot on a 90s take is about 12px wide. With a 6px hit zone at each
 * end there would be nothing left to grab, so the whole region moves instead.
 */
export const MIN_RESIZABLE_PX = 24;

export type DragKind = "move" | "resize-start" | "resize-end";

export function pxToMs(dx: number, trackWidthPx: number, outputDurationMs: number): number {
  if (trackWidthPx <= 0) return 0;
  return (dx / trackWidthPx) * outputDurationMs;
}

export function msToPct(tMs: number, outputDurationMs: number): number {
  if (outputDurationMs <= 0) return 0;
  return (tMs / outputDurationMs) * 100;
}

/** `offsetPx` is measured from the region's own left edge. */
export function dragKindAt(offsetPx: number, regionWidthPx: number): DragKind {
  if (regionWidthPx < MIN_RESIZABLE_PX) return "move";
  if (offsetPx < EDGE_HIT_PX) return "resize-start";
  if (offsetPx > regionWidthPx - EDGE_HIT_PX) return "resize-end";
  return "move";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/renderer/ui/timeline/geometry.test.ts"`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ui/timeline/
git commit -m "feat: pure drag geometry for the timeline lanes"
```

---

### Task 7: The mutation seam — `useProjectHistory`, wired into `Editor`

One place that owns `setProject`, `live.current` and the history. Today every mutation hand-patches `live.current` alongside `setProject`, and `Editor.tsx`'s own comment records what happened when `addCut` forgot to: it "never redrew at all, so adding a cut left a stale frame on screen until the next scrub." This phase adds eight more mutations to that pattern.

**Files:**
- Create: `src/renderer/ui/useProjectHistory.ts`
- Modify: `src/renderer/ui/Editor.tsx` — replace `useState<Project>` and all five mutation handlers

**Interfaces:**
- Consumes: `history.ts` (Task 3), `derive.ts` (Task 1).
- Produces:
  ```ts
  export type ProjectHistory = {
    project: Project;
    selection: Selection;
    canUndo: boolean;
    canRedo: boolean;
    apply: (fn: (p: Project) => Project, opts?: { replan?: boolean }) => void;
    applyTransient: (fn: (p: Project) => Project) => void;
    commitGesture: () => void;
    select: (selection: Selection) => void;
    undo: () => void;
    redo: () => void;
  };
  ```
  `apply`'s `replan: true` runs the full `replanFrom`; the default runs `deriveKeyframes`. Both keep keyframes consistent with segments — the difference is only whether the planner regenerates unclaimed segments.

- [ ] **Step 1: Write the hook**

Create `src/renderer/ui/useProjectHistory.ts`:

```ts
import { useCallback, useMemo, useRef, useState } from "react";
import {
  beginOrExtend,
  canRedo as canRedoOf,
  canUndo as canUndoOf,
  commit,
  createHistory,
  push,
  redo as redoOf,
  undo as undoOf,
  type History,
  type Selection,
} from "../../shared/project/history";
import type { Project } from "../../shared/project/types";
import { deriveKeyframes, replanFrom, type DeriveContext } from "../../shared/zoom/derive";

/**
 * The one way an edit reaches the project, the history and the preview.
 *
 * Every mutation used to be a bare `setProject` that also hand-patched
 * `live.current`, and the file recorded what happened when one forgot:
 * `addCut` "patched `live.current` and never redrew at all, so adding a cut
 * left a stale frame on screen until the next scrub". Phase E adds eight more
 * mutations, so the patching happens here once instead.
 */
export function useProjectHistory(
  initial: Project,
  ctx: DeriveContext,
  onProject: (p: Project) => void,
) {
  const [history, setHistory] = useState<History>(() =>
    createHistory({ project: initial, selection: null }),
  );

  // Read inside callbacks so they need not be rebuilt when the context moves.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const onProjectRef = useRef(onProject);
  onProjectRef.current = onProject;

  /** Keyframes are derived, so no edit may leave them behind. */
  const rederive = useCallback((p: Project, replan: boolean): Project => {
    const parts = replan
      ? replanFrom(p.zoom.config, p, ctxRef.current)
      : deriveKeyframes(p.zoom.config, p, ctxRef.current);
    return { ...p, zoom: { ...p.zoom, ...parts } };
  }, []);

  const step = useCallback(
    (
      fn: (p: Project) => Project,
      commitStyle: "push" | "extend",
      replan: boolean,
    ): void => {
      setHistory((h) => {
        const next = rederive(fn(h.present.project), replan);
        const entry = { project: next, selection: h.present.selection };
        const advanced = commitStyle === "push" ? push(h, entry) : beginOrExtend(h, entry);
        onProjectRef.current(advanced.present.project);
        return advanced;
      });
    },
    [rederive],
  );

  const apply = useCallback(
    (fn: (p: Project) => Project, opts?: { replan?: boolean }): void =>
      step(fn, "push", opts?.replan === true),
    [step],
  );

  const applyTransient = useCallback(
    (fn: (p: Project) => Project): void => step(fn, "extend", false),
    [step],
  );

  const commitGesture = useCallback((): void => setHistory((h) => commit(h)), []);

  const select = useCallback((selection: Selection): void => {
    setHistory((h) => push(h, { ...h.present, selection }));
  }, []);

  const undo = useCallback((): void => {
    setHistory((h) => {
      const next = undoOf(h);
      if (next !== h) onProjectRef.current(next.present.project);
      return next;
    });
  }, []);

  const redo = useCallback((): void => {
    setHistory((h) => {
      const next = redoOf(h);
      if (next !== h) onProjectRef.current(next.present.project);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      project: history.present.project,
      selection: history.present.selection,
      canUndo: canUndoOf(history),
      canRedo: canRedoOf(history),
      apply,
      applyTransient,
      commitGesture,
      select,
      undo,
      redo,
    }),
    [history, apply, applyTransient, commitGesture, select, undo, redo],
  );
}
```

- [ ] **Step 2: Wire it into `Editor.tsx`**

Replace `const [project, setProject] = useState<Project>(bundle.project);` and `const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);` with:

```ts
const edit = useProjectHistory(bundle.project, deriveCtx, (p) => {
  live.current = { ...live.current, project: p };
});
const project = edit.project;
```

Then rewrite the five handlers. Each loses its `setProject`, its manual `applyPlan` call and its `live.current` patch:

```ts
const onConfigChange = (config: ZoomConfig): void => {
  edit.apply((p) => ({ ...p, zoom: { ...p.zoom, config } }), { replan: true });
};

const onOutputChange = (output: Project["output"]): void => {
  edit.apply((p) => ({ ...p, output }), { replan: true });
};

const onSegmentCameraChange = (id: string, position: ZoomSegment["position"]): void => {
  // Not a pin: replanSegments carries the choice across by id, so the shot
  // keeps re-planning its times. Still needs a replan, because a follow shot
  // emits a sample every 100ms where a fixed one emits two keyframes.
  edit.apply((p) => setSegmentCamera(p, id, position), { replan: true });
};
```

`addCut` is rewritten in Task 10; for now change it to `edit.apply((p) => addCut(p, crypto.randomUUID(), srcStart, srcEnd, manifest.durationMs))`.

The two style handlers in the JSX become `edit.apply((p) => ({ ...p, style: { ...p.style, cursor } }))` and `edit.apply((p) => ({ ...p, style }))`.

Replace every remaining `selectedSegmentId` reference with `edit.selection?.kind === "segment" ? edit.selection.id : null`, and every `setSelectedSegmentId(x)` with `edit.select(x === null ? null : { kind: "segment", id: x })`.

- [ ] **Step 3: Keep the redraw effect**

The `useEffect` watching `[project]` that calls `playerRef.current?.seek(...)` **stays exactly as it is**. Its comment explains why it watches the whole project and why a synchronous seek in each handler does not work — `cursorPath` and `ctx` are `useMemo`s on `project`, so only the re-render rebuilds them. Do not "optimise" it into the hook.

- [ ] **Step 4: Verify**

Run: `npm test`, `npm run typecheck`, `npm run build`.
Expected: all pass. Then run the app and check by hand that changing a pacing dial still re-plans and redraws, and that Ctrl+Z does nothing yet (the shortcut arrives in Task 12).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ui/useProjectHistory.ts src/renderer/ui/Editor.tsx
git commit -m "feat: one mutation seam for the editor, with history behind it"
```

---

### Task 8: Split the timeline into lanes

Structure only — no dragging yet, so the diff is reviewable on its own. After this task the timeline looks different and behaves as it did.

**Files:**
- Modify: `src/renderer/ui/Timeline.tsx`
- Create: `src/renderer/ui/timeline/Ruler.tsx`
- Create: `src/renderer/ui/timeline/ZoomLane.tsx`
- Create: `src/renderer/ui/timeline/CutLane.tsx`

**Interfaces:**
- Consumes: `msToPct` (Task 6), `sourceSpanToOutput`, `sourceToOutput`.
- Produces: `Timeline` keeps its current props and adds `onSelect: (s: Selection) => void` and `selection: Selection`, replacing `selectedSegmentId` and `onSelectSegment`.

- [ ] **Step 1: Extract the ruler**

`Ruler.tsx` takes `{ outputDurationMs, onSeek }` and renders the tick marks and the time labels currently drawn inside the track, plus the scrub `onPointerDown`/`Move`/`Up` handlers currently on the outer div. Height 24px.

The scrub handlers move here **verbatim** — including `setPointerCapture`, which the existing comment notes "is what makes dragging past either end feel normal."

- [ ] **Step 2: Extract the zoom lane**

`ZoomLane.tsx` takes `{ durationMs, outputDurationMs, cuts, segments, keyframes, selection, onSelect, pixelParityZoom }` and renders the segment regions and keyframe markers exactly as `Timeline.tsx` does now — same colours, same `title` tooltips, same `k.easing === "linear"` filter for the follow sampler's picket fence. Height 56px.

Delete the `e.stopPropagation()` from the segment's `onPointerDown`. It existed only because the track owned scrubbing; the ruler owns it now, and the comment explaining the hack goes with it.

- [ ] **Step 3: Add the cut lane**

`CutLane.tsx` takes `{ durationMs, outputDurationMs, cuts, selection, onSelect }` and renders each cut as a region via `sourceSpanToOutput`, hatched, selectable. Height 20px. No creation or dragging yet — Task 10.

- [ ] **Step 4: Recompose `Timeline.tsx`**

`Timeline.tsx` keeps the footer readout unchanged and stacks `Ruler`, `ZoomLane`, `CutLane` in a `position: relative` container, with the playhead as one absolutely positioned element spanning the full stack so it crosses all three lanes. `playheadRef` still points at that single element, so the Editor's direct-DOM playhead updates during playback keep working untouched.

- [ ] **Step 5: Verify**

Run: `npm run typecheck`, `npm test`, `npm run build`, then launch the app.
Expected: the timeline shows three lanes; scrubbing works from the ruler; clicking a segment selects it and does **not** move the playhead; cuts appear as regions.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ui/Timeline.tsx src/renderer/ui/timeline/
git commit -m "feat: split the timeline into ruler, zoom and cut lanes"
```

---

### Task 9: Drag and resize zoom segments

**Files:**
- Create: `src/renderer/ui/timeline/useRegionDrag.ts`
- Modify: `src/renderer/ui/timeline/ZoomLane.tsx`
- Modify: `src/renderer/ui/Timeline.tsx` (pass the callbacks through)
- Modify: `src/renderer/ui/Editor.tsx` (supply them)

**Interfaces:**
- Consumes: `dragKindAt`, `pxToMs` (Task 6); `moveSegment`, `resizeSegment` (Task 4); `edit.applyTransient`, `edit.commitGesture` (Task 7).
- Produces:
  ```ts
  export function useRegionDrag(opts: {
    outputDurationMs: number;
    onMove: (id: string, deltaOutputMs: number) => void;
    onResize: (id: string, edge: "start" | "end", tOutputMs: number) => void;
    onCommit: () => void;
  }): { onPointerDown: (e: React.PointerEvent, id: string) => void };
  ```

- [ ] **Step 1: Write the hook**

Create `src/renderer/ui/timeline/useRegionDrag.ts`:

```ts
import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { dragKindAt, pxToMs, type DragKind } from "./geometry";

type Active = {
  id: string;
  kind: DragKind;
  startClientX: number;
  trackWidthPx: number;
  trackLeftPx: number;
};

/**
 * Move-and-resize for one lane's regions.
 *
 * Shared by both lanes so pointer capture is written once. Without capture a
 * drag dies the moment the cursor leaves the track, which is exactly when a
 * user is trying to push a region against an end.
 *
 * Every move reports a delta in OUTPUT ms; the caller maps to source time.
 */
export function useRegionDrag(opts: {
  outputDurationMs: number;
  onMove: (id: string, deltaOutputMs: number) => void;
  onResize: (id: string, edge: "start" | "end", tOutputMs: number) => void;
  onCommit: () => void;
}) {
  const active = useRef<Active | null>(null);

  const onPointerDown = (e: ReactPointerEvent, id: string): void => {
    // The ruler owns scrubbing; without this a drag would seek as well.
    e.stopPropagation();

    const region = e.currentTarget as HTMLElement;
    const regionBox = region.getBoundingClientRect();
    const track = region.parentElement;
    if (track === null) return;
    const trackBox = track.getBoundingClientRect();

    region.setPointerCapture(e.pointerId);
    active.current = {
      id,
      kind: dragKindAt(e.clientX - regionBox.left, regionBox.width),
      startClientX: e.clientX,
      trackWidthPx: trackBox.width,
      trackLeftPx: trackBox.left,
    };

    const onPointerMove = (ev: globalThis.PointerEvent): void => {
      const a = active.current;
      if (a === null) return;

      if (a.kind === "move") {
        opts.onMove(a.id, pxToMs(ev.clientX - a.startClientX, a.trackWidthPx, opts.outputDurationMs));
        return;
      }

      const tOutputMs = pxToMs(ev.clientX - a.trackLeftPx, a.trackWidthPx, opts.outputDurationMs);
      opts.onResize(a.id, a.kind === "resize-start" ? "start" : "end", tOutputMs);
    };

    const onPointerUp = (): void => {
      active.current = null;
      opts.onCommit();
      region.removeEventListener("pointermove", onPointerMove);
      region.removeEventListener("pointerup", onPointerUp);
      region.removeEventListener("pointercancel", onPointerUp);
    };

    region.addEventListener("pointermove", onPointerMove);
    region.addEventListener("pointerup", onPointerUp);
    region.addEventListener("pointercancel", onPointerUp);
  };

  return { onPointerDown };
}
```

The move delta is measured from `startClientX` — the pointer's position at pointerdown — so every intermediate `applyTransient` re-applies the **total** delta to the pre-drag project rather than accumulating per-frame deltas. Accumulating would drift and, worse, would compound against clamping: a segment held against a neighbour would bank the rejected movement and leap when dragged back.

- [ ] **Step 2: Give `ZoomLane` a cursor and wire the hook**

In `ZoomLane.tsx`, call `useRegionDrag` with the props passed down, and put `onPointerDown={(e) => drag.onPointerDown(e, s.id)}` on each segment region alongside the existing select handler. Set `cursor: "grab"` on the region, and `cursor: "ew-resize"` when the region is at least `MIN_RESIZABLE_PX` wide via two 6px-wide absolutely positioned edge strips.

- [ ] **Step 3: Supply the callbacks in `Editor.tsx`**

```ts
const onSegmentMove = (id: string, deltaOutputMs: number): void => {
  // Output ms in, source ms out: the delta is in what the viewer sees.
  edit.applyTransient((p) => {
    const s = p.zoom.segments.find((x) => x.id === id);
    if (s === undefined) return p;
    const fromOutput = sourceToOutput(s.startMs, manifest.durationMs, p.cuts) ?? 0;
    const targetSource = outputToSource(
      fromOutput + deltaOutputMs,
      manifest.durationMs,
      p.cuts,
    );
    return moveSegment(p, id, targetSource - s.startMs, manifest.durationMs);
  });
};

const onSegmentResize = (id: string, edge: "start" | "end", tOutputMs: number): void => {
  edit.applyTransient((p) =>
    resizeSegment(
      p,
      id,
      edge,
      outputToSource(tOutputMs, manifest.durationMs, p.cuts),
      manifest.durationMs,
    ),
  );
};
```

Each edge maps through `outputToSource` **independently** (spec §7). A segment dragged across a cut therefore changes its source duration while its output duration stays fixed — correct, because output time is what a viewer sees.

Pass `onCommit={edit.commitGesture}` through.

- [ ] **Step 4: Verify by hand**

Run the app on a take with several zooms.
Expected: a segment drags and its keyframe markers move with it; it stops dead against a neighbour rather than overlapping; an edge stops at ~1.5s of length; releasing and pressing Ctrl+Z is still inert (Task 12) but `edit.canUndo` is true.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ui/timeline/ src/renderer/ui/Timeline.tsx src/renderer/ui/Editor.tsx
git commit -m "feat: drag and resize zoom segments"
```

---

### Task 10: Real cut regions

**Files:**
- Modify: `src/renderer/ui/timeline/CutLane.tsx`
- Modify: `src/renderer/ui/Editor.tsx` (remove the "cut 0.5s here" button)

- [ ] **Step 1: Drag-to-create on empty lane space**

Add a `onPointerDown` on `CutLane`'s own background (not on a region) that records the start x, tracks the pointer, draws a provisional region, and on pointerup calls `onCreateCut(startOutputMs, endOutputMs)`. A drag shorter than `MIN_CUT_MS` in output time creates nothing — that is a click, and a click on empty space clears the selection.

- [ ] **Step 2: Reuse `useRegionDrag` for existing cuts**

Same hook, same wiring as `ZoomLane`, with `onMove`/`onResize` calling through to `moveCut` and `resizeCut`.

- [ ] **Step 3: Supply the callbacks in `Editor.tsx`**

```ts
const onCreateCut = (startOutputMs: number, endOutputMs: number): void => {
  edit.apply((p) =>
    addCut(
      p,
      crypto.randomUUID(),
      outputToSource(startOutputMs, manifest.durationMs, p.cuts),
      outputToSource(endOutputMs, manifest.durationMs, p.cuts),
      manifest.durationMs,
    ),
  );
};
```

- [ ] **Step 4: Delete the placeholder button**

Remove the "cut 0.5s here" button from the JSX and the `addCut` handler it called. The lane replaces both.

- [ ] **Step 5: Verify by hand**

Expected: dragging on the cut lane creates a cut and the preview duration shortens; dragging a cut moves it; dragging one cut into another merges them into one that keeps moving with the pointer; the placeholder button is gone.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ui/timeline/CutLane.tsx src/renderer/ui/Editor.tsx
git commit -m "feat: real cut regions, replacing the placeholder button"
```

---

### Task 11: The segment popover

**Files:**
- Create: `src/renderer/ui/SegmentPopover.tsx`
- Modify: `src/renderer/ui/Inspector.tsx` — delete the "selected shot" section (from `src/renderer/ui/Inspector.tsx:97`)
- Modify: `src/renderer/ui/Editor.tsx`

**Interfaces:**
- Consumes: `depthToScale` from `src/shared/zoom/keyframes.ts`; `setSegmentDepth`, `setSegmentCamera`, `deleteSegment`, `resetSegment` (Task 4).
- Produces:
  ```ts
  export const DEPTH_PRESETS = [0.25, 0.4, 0.55, 0.7, 0.85, 1] as const;
  ```

- [ ] **Step 1: Build the popover**

Create `src/renderer/ui/SegmentPopover.tsx`, anchored to the selected segment's region:

```
┌─ shot ────────────── 1.55× ─┐
│ ┌──────────┬──────────────┐ │
│ │  fixed   │    follow    │ │
│ └──────────┴──────────────┘ │
│ holds this framing          │
│ ┌────┬────┬────┬────┬────┬────┐
│ │1.25│1.40│1.55│1.70│1.85│2.00│
│ └────┴────┴────┴────┴────┴────┘
│ 4.2s · 2 waypoints          │
│ reset to auto      delete   │
└─────────────────────────────┘
```

- The badge shows `depthToScale(waypoints[0].depth, cfg.maxZoom).toFixed(2)` + `×`.
- Preset labels are computed the same way from `DEPTH_PRESETS`, so they follow `maxZoom` instead of lying about it. A preset is active only when the segment's depth is within `0.001` of it — an auto-planned segment (0.917 for a click, 0.583 for typing, 0.25 for scroll) usually matches none, which is honest.
- The mode explanation reads "holds this framing" for `fixed` and "tracks the cursor" for `follow`.
- Reuse `sectionHeader`, `row` and `buttonInput` from `./controls` so it matches the inspector.

Dismiss on Escape, on an outside pointerdown, and when the selection clears.

- [ ] **Step 2: Delete the inspector's section**

Remove the `selected shot` section from `Inspector.tsx` and the props that fed it. The inspector keeps the ~20 global `ZoomConfig` dials and becomes purely the Global half of spec §11's split — moved, not duplicated.

- [ ] **Step 3: Wire it up**

```ts
const onDepthChange = (id: string, depth: number): void =>
  edit.apply((p) => setSegmentDepth(p, id, depth));

const onSegmentDelete = (id: string): void => {
  edit.apply((p) => deleteSegment(p, id));
  edit.select(null);
};

// Unpin, then re-plan: the shot rejoins the planner. This is what makes
// pinning recoverable, and pinning is a one-way door without it.
const onSegmentReset = (id: string): void =>
  edit.apply((p) => resetSegment(p, id), { replan: true });
```

- [ ] **Step 4: Verify by hand**

Expected: selecting a shot opens the popover next to it; pressing a depth preset changes the zoom in the preview immediately; the badge tracks it; `reset to auto` returns a dragged shot to planner control and a later pacing-dial change moves it again.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ui/SegmentPopover.tsx src/renderer/ui/Inspector.tsx src/renderer/ui/Editor.tsx
git commit -m "feat: per-shot popover for depth and camera"
```

---

### Task 12: Keyboard shortcuts

**Files:**
- Modify: `src/renderer/ui/Editor.tsx` (the existing `keydown` effect, near `src/renderer/ui/Editor.tsx:456`)

- [ ] **Step 1: Extend the existing listener**

```ts
if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
  event.preventDefault();
  if (event.shiftKey) edit.redo();
  else edit.undo();
  return;
}

if (event.key === "Delete" || event.key === "Backspace") {
  const s = edit.selection;
  if (s === null) return;
  event.preventDefault();
  edit.apply((p) => (s.kind === "segment" ? deleteSegment(p, s.id) : deleteCut(p, s.id)));
  edit.select(null);
  return;
}

if (event.key === "Escape") {
  edit.select(null);
  return;
}
```

The existing effect has `[]` as its dependency list, which was correct while it closed over nothing. It now closes over `edit`, so either add `edit` to the list or hold `edit` in a ref updated on every render. **Prefer the ref** — `edit` changes identity on every history change, so a dependency would re-attach the listener on every keystroke-driven edit.

- [ ] **Step 2: Verify by hand**

Expected: Ctrl+Z undoes a whole drag in one press, not one pointermove at a time; Ctrl+Shift+Z redoes; Delete removes the selected segment or cut; Escape clears the selection and closes the popover. Undoing a delete brings the item back **selected**.

- [ ] **Step 3: Full gate run**

```
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run build"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run verify:decode"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run verify:parity"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run verify:capture"
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run tune -- all"
```

Expected: tests pass, typecheck silent, decode 6/6 k=0, parity **30/30**, capture ddagrab at 50fps or better, and `tune -- all` **unchanged from the Task 1 baseline**.

- [ ] **Step 4: Commit and update the handover**

Add a "What landed" section to `HANDOVER.md` covering phase E, and mark phase E **done** in its phase table and in `docs/specs/2026-09-04-composition-and-camera-design.md` §13.

```bash
git add src/renderer/ui/Editor.tsx HANDOVER.md docs/specs/2026-09-04-composition-and-camera-design.md
git commit -m "feat: undo/redo, delete and escape shortcuts"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: §2.1 pinning → Task 4; §2.2 no-overlap → Task 4; §2.3 the floor → Task 4; §2.4 depth presets → Tasks 4 and 11; §2.5 history → Task 3; §2.6 cut ids and selection → Tasks 2 and 3; §3 the `applyPlan` split → Task 1; §4 `edits.ts` → Tasks 4 and 5; §5 the seam → Tasks 3 and 7; §6 lanes → Task 8; §7 coordinates → Task 9; §8 popover → Task 11; §9 keyboard → Task 12; §11 testing → the test steps throughout, plus the gate run in Task 12.

**Known gap, accepted:** spec §11 asks for a test that a segment dragged across a cut is asserted "in both directions". Task 9 implements that mapping and verifies it by hand, but adds no automated test, because the mapping lives in an `Editor.tsx` callback rather than in a pure module. If Task 9's reviewer wants it covered, the fix is to extract the two callbacks into a pure `segmentDragToSource(project, id, deltaOutputMs, durationMs)` in `edits.ts` and test that — worth doing, and cheap.

**Ordering.** Tasks 1–6 are pure and independently testable. Task 7 is the riskiest — it rewrites every mutation path in `Editor.tsx` — and deliberately lands before any new UI, so a regression there is caught against unchanged behaviour rather than tangled with new lanes. Tasks 8–12 build UI on a settled foundation.
