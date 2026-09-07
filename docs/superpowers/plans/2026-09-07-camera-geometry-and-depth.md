# Camera geometry and zoom depth — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make zoom mean "the camera moves over the recording inside a fixed
frame" instead of "the screen rectangle grows until the output crops it", raise
the ceiling past full-bleed, and grade depth by what the user was doing.

**Architecture:** The drawn frame becomes a constant and the *sampled source
region* becomes the camera. One pure function (`sourceRectFor`) owns the
region and its clamp; one pure function (`sourceToFrame`) maps every source
point — screen, cursor, ripple — into that frame; one pure function
(`zoomDepth`) decides how deep a zoom goes. All three live in `src/shared/` and
are testable with no GL context.

**Tech Stack:** TypeScript, React, WebGL2, vitest.

**Spec:** `docs/specs/2026-09-07-camera-geometry-and-depth-design.md`. Read it
first — this plan argues from it, and its §3 invariants are the contract every
task below is written to satisfy.

## Global Constraints

- `src/shared/` must not import electron, touch the DOM, or hit the filesystem.
- Windows-only, via PowerShell:
  `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"`.
- **Anyone adding a field to `Project` must add it to `normalizeProject`** in
  `src/shared/project/migrate.ts`, or existing projects silently lose it.
  `zoom.config` is spread over the defaults, so a new **flat** `ZoomConfig`
  field inherits its default for free — a **nested** one would not, which is
  why this plan keeps `ZoomConfig` flat (Task 7).
- **Preview and export must keep calling the same `Renderer`.** `verify:parity`
  is the guard, and it runs the BUILT bundle, so `npm run build` first (the
  script does this itself).
- **One coordinate convention** (spec invariant 10): top-left origin, y down,
  everywhere. The single Y flip into clip space lives in `QUAD_VERT`'s
  `gl_Position`. The one other place GL forces a flip is `gl.scissor`, whose
  origin is bottom-left; Task 4 confines that to a single helper.
- Never read an achieved frame rate off `avg_frame_rate` for a live stream; use
  `ffprobe -count_frames`.
- Baseline before this plan: **279 tests / 34 files**, typecheck silent,
  `verify:decode` 6/6, `verify:parity` 25/25, `tune -- all` as committed.

## A deviation from the spec's file table, and why

Spec §4.2 puts `sourceRectFor` and `sourceToFrame` in
`src/renderer/gl/layout.ts`. **This plan puts them in
`src/shared/zoom/viewport.ts` instead.**

The reason is invariant 5. `clampToSource` in `src/shared/zoom/camera.ts` has to
clamp a camera centre using exactly the geometry the renderer samples with, and
`src/shared/` cannot import from `src/renderer/`. Leaving the geometry in the
renderer would force a second copy of the clamp in shared — which is the
duplicated-arithmetic failure invariant 5 exists to prevent. In `shared/` there
is one implementation, `clampToSource` becomes a two-line derivation of it, and
the whole thing is testable with no GL context.

`src/renderer/gl/layout.ts` keeps `screenQuad` (now the fixed frame) and
imports the rest.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/shared/zoom/viewport.ts` | **Create.** `SourceRect`, `sourceRectFor`, `sourceToFrame`. The camera's geometry and its clamp, in one place. |
| `src/shared/zoom/viewport.test.ts` | **Create.** Invariants 1–7 and 10, including the finite sweep and boundary probes of spec §3.1. |
| `src/shared/zoom/camera.ts` | **Modify.** `clampToSource` derives from `sourceRectFor` instead of computing a visible fraction of its own. |
| `src/shared/zoom/geometry.ts` | **Modify.** `maxComfortableZoom` → `pixelParityZoom`, demoted from cap to advice. |
| `src/renderer/gl/layout.ts` | **Modify.** `screenQuad` returns the fixed frame; the growing-quad clamp goes. |
| `src/renderer/gl/layout.test.ts` | **Modify.** The clamp sweeps move to `viewport.test.ts`; what is left tests the fixed frame. |
| `src/renderer/gl/shaders.ts` | **Modify.** `SCREEN_FRAG` gains `u_uv0`/`u_uv1` and samples the span. |
| `src/renderer/gl/Renderer.ts` | **Modify.** Passes the span; cursor and ripples go through `sourceToFrame`; overlays clip to the frame. |
| `src/shared/zoom/depth.ts` | **Create.** `DepthInputs`, `DepthConfig`, `zoomDepth`, `depthConfigFrom`. |
| `src/shared/zoom/depth.test.ts` | **Create.** The depth rule, including zero spread and intent ties. |
| `src/shared/zoom/types.ts` | **Modify.** `Impulse.kind`, `Cluster.intentScores`, `ZoomConfig` depth fields. |
| `src/shared/zoom/impulses.ts` | **Modify.** Stamps `kind` on each impulse. |
| `src/shared/zoom/cluster.ts` | **Modify.** Accumulates `intentScores`; `clusterIntent`. |
| `src/shared/zoom/planner.ts` | **Modify.** `fitScale` → `zoomDepth`. |
| `src/shared/zoom/keyframes.ts` | **Modify.** The ceiling becomes `cfg.maxZoom`. |
| `src/renderer/ui/Inspector.tsx` | **Modify.** `max zoom` dial. |
| `src/renderer/ui/Timeline.tsx` | **Modify.** Reports the configured ceiling. |

---

# Step 1 — Geometry (Tasks 1–6)

Spec §7 step 1. The ceiling stays at pixel parity and depth rules do not
change, so **`tune -- all` must be byte-identical through Task 5**. The only
thing that changes is what the picture does on screen.

---

### Task 1: The sampled region and its clamp

**Files:**
- Create: `src/shared/zoom/viewport.ts`
- Test: `src/shared/zoom/viewport.test.ts`

**Interfaces:**
- Consumes: `ZoomState` from `src/shared/zoom/interpolate.ts`, `Rect` and
  `clamp` from `src/shared/zoom/geometry.ts`, `Size` from
  `src/shared/zoom/types.ts`.
- Produces: `type SourceRect = { x: number; y: number; w: number; h: number }`
  and `sourceRectFor(zoom: ZoomState, frame: Rect, source: Size): SourceRect`.
  Tasks 2–5, 7 and 10 all consume these.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/zoom/viewport.test.ts
import { describe, expect, it } from "vitest";
import { screenRect } from "./geometry";
import { sourceRectFor, type SourceRect } from "./viewport";
import type { Size } from "./types";

const SOURCE: Size = { w: 1920, h: 1080 };
const PAD = 0.85;
const frameFor = (output: Size) => screenRect(SOURCE, output, PAD);

const at = (scale: number, cx = 0.5, cy = 0.5, output: Size = SOURCE): SourceRect =>
  sourceRectFor({ scale, cx, cy }, frameFor(output), SOURCE);

describe("sourceRectFor", () => {
  it("shows the whole source at rest (invariant 4)", () => {
    expect(at(1)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("samples 1/scale of the source", () => {
    expect(at(2).w).toBeCloseTo(0.5, 12);
    expect(at(1.6).w).toBeCloseTo(1 / 1.6, 12);
  });

  it("preserves the frame's aspect ratio (invariant 3)", () => {
    for (const output of [SOURCE, { w: 1080, h: 1080 }, { w: 1280, h: 720 }]) {
      const frame = frameFor(output);
      const r = sourceRectFor({ scale: 1.5, cx: 0.5, cy: 0.5 }, frame, SOURCE);
      const sampled = (r.w * SOURCE.w) / (r.h * SOURCE.h);
      expect(sampled).toBeCloseTo(frame.w / frame.h, 9);
    }
  });

  it("never leaves the source (invariant 2)", () => {
    for (const cx of [-1, 0, 0.5, 1, 2]) {
      const r = at(1.6, cx, cx);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-12);
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("centres on the requested point when there is room", () => {
    const r = at(2, 0.5, 0.5);
    expect(r.x).toBeCloseTo(0.25, 12);
    expect(r.y).toBeCloseTo(0.25, 12);
  });

  it("treats a scale below 1 as rest rather than zooming out", () => {
    expect(at(0.5)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/zoom/viewport.test.ts"
```

Expected: FAIL — `./viewport` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/shared/zoom/viewport.ts
import { clamp, type Rect } from "./geometry";
import type { ZoomState } from "./interpolate";
import type { Size } from "./types";

/** A region of the source, normalised 0..1, top-left origin. */
export type SourceRect = { x: number; y: number; w: number; h: number };

/**
 * The region of the source the camera is looking at.
 *
 * This is the camera. The drawn frame is a constant (see `screenQuad`); zoom
 * moves and shrinks THIS instead. Before 2026-09-07 it was the other way
 * round — the frame grew until the output cropped it — which capped the whole
 * zoom range at 1/paddingFactor and left the camera with zero freedom at the
 * top of it. See docs/specs/2026-09-07-camera-geometry-and-depth-design.md §1.
 *
 * The clamp is written as ONE continuous range, `clamp(v, 0, 1 - w)`, never as
 * a gated branch. At scale 1 that range collapses to [0, 0], and it must
 * collapse smoothly: the identical bug in the old growing-quad clamp was
 * written as two cases, and released one float below the crossover, teleporting
 * the camera 229px. viewport.test.ts sweeps that boundary.
 */
export function sourceRectFor(zoom: ZoomState, frame: Rect, source: Size): SourceRect {
  // How much taller the sampled region must be than it is wide, in normalised
  // source units, for it to fill a frame of this aspect without distortion.
  // Exactly 1 while the frame carries the source's aspect, which the current
  // fitted frame guarantees — written out so a future crop mode cannot make it
  // silently wrong.
  const ratio = source.w / source.h / (frame.w / frame.h);

  // A scale below 1 is rest, not a zoom out: there is nothing outside the
  // source to show.
  let w = Math.min(1, 1 / Math.max(1, zoom.scale));
  let h = w * ratio;

  if (h > 1) {
    h = 1;
    w = h / ratio;
  }

  return {
    x: clamp(zoom.cx - w / 2, 0, 1 - w),
    y: clamp(zoom.cy - h / 2, 0, 1 - h),
    w,
    h,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/zoom/viewport.test.ts"
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/zoom/viewport.ts src/shared/zoom/viewport.test.ts
git commit -m "feat(camera): the sampled source region and its clamp"
```

---

### Task 2: The continuity sweep

Spec §3.1. This is the task that stops the head-of-file jump coming back in a
new place. **Do not sample randomly** — sweep a fixed grid and probe every
boundary, because the original bug was one float wide.

**Files:**
- Modify: `src/shared/zoom/viewport.test.ts`

**Interfaces:**
- Consumes: `sourceRectFor` (Task 1).
- Produces: nothing. This is a guard.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/shared/zoom/viewport.test.ts

/**
 * The bound is derived, not guessed: w = 1/s so |dw/ds| = 1/s² <= 1 for
 * s >= 1; x = cx - w/2 gives |dx/ds| <= 0.5 and |dx/dcx| <= 1; and clamping is
 * 1-Lipschitz, so it can only ever reduce movement. K = 2 is therefore a safe
 * bound with margin. On a 1920px source it caps movement at ~4px per 0.001 of
 * scale — against the 229px the original bug produced.
 */
describe("continuity (invariant 7)", { timeout: 60_000 }, () => {
  const K = 2;
  const EPS = 1e-4;
  const OUTPUTS: Size[] = [SOURCE, { w: 1080, h: 1080 }, { w: 1280, h: 720 }];
  const MAX_ZOOM = 2.5; // past any configured ceiling: the function must hold up

  const dist = (a: SourceRect, b: SourceRect): number =>
    Math.max(
      Math.abs(a.x - b.x),
      Math.abs(a.y - b.y),
      Math.abs(a.w - b.w),
      Math.abs(a.h - b.h),
    );

  /** Every boundary where a clamp can begin or stop binding. */
  const boundaries = (scale: number): number[] => {
    const half = 1 / (2 * scale);
    return [0, half, 1 - half, 1];
  };

  it("moves proportionally when the scale moves", () => {
    for (const output of OUTPUTS) {
      for (let s = 1; s <= MAX_ZOOM; s += 0.005) {
        for (const cx of [0, 0.05, 0.2, 0.5, 0.8, 0.95, 1]) {
          const a = at(s, cx, cx, output);
          const b = at(s + EPS, cx, cx, output);
          expect(dist(a, b)).toBeLessThanOrEqual(K * EPS + 1e-9);
        }
      }
    }
  });

  it("moves proportionally when the centre moves", () => {
    for (const output of OUTPUTS) {
      for (let s = 1; s <= MAX_ZOOM; s += 0.005) {
        for (let cx = 0; cx <= 1; cx += 0.05) {
          const a = at(s, cx, cx, output);
          const b = at(s, cx + EPS, cx + EPS, output);
          expect(dist(a, b)).toBeLessThanOrEqual(K * EPS + 1e-9);
        }
      }
    }
  });

  /**
   * scale = 1 is the crossover: the clamp range [0, 1 - w] collapses to zero
   * width there. It is the direct analogue of the old crossover at
   * w === output.w, and it is where the 229px teleport lived.
   */
  it("is continuous either side of every boundary", () => {
    for (const output of OUTPUTS) {
      for (const s of [1, 1.176, 1.6, 2.0]) {
        for (const b of boundaries(s)) {
          for (const eps of [-EPS, 0, EPS]) {
            const a = at(s, b + eps, b + eps, output);
            const c = at(s + EPS, b + eps, b + eps, output);
            expect(dist(a, c)).toBeLessThanOrEqual(K * EPS + 1e-9);
          }
        }
        // and across the scale boundary itself
        expect(dist(at(s - EPS, 0.5, 0.5, output), at(s + EPS, 0.5, 0.5, output)))
          .toBeLessThanOrEqual(K * 2 * EPS + 1e-9);
      }
    }
  });
});
```

- [ ] **Step 2: Run it**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/zoom/viewport.test.ts"
```

Expected: PASS. Task 1's implementation already satisfies it — that is the
point. If it fails, the clamp was written as a branch rather than a range; fix
`sourceRectFor`, do not loosen `K`.

- [ ] **Step 3: Prove the test can fail**

Temporarily break the clamp into two cases and confirm the sweep catches it:

```ts
    // TEMPORARY - revert immediately
    x: w >= 1 ? 0 : clamp(zoom.cx - w / 2, 0, 1 - w),
```

Run the test. Expected: FAIL at a boundary probe. **Revert the change.** A
guard nobody has seen fail is a guard nobody should trust.

- [ ] **Step 4: Commit**

```bash
git add src/shared/zoom/viewport.test.ts
git commit -m "test(camera): sweep the sampled region for discontinuities"
```

---

### Task 3: One mapping from source to frame

**Files:**
- Modify: `src/shared/zoom/viewport.ts`
- Modify: `src/shared/zoom/viewport.test.ts`

**Interfaces:**
- Consumes: `SourceRect` (Task 1), `Rect`.
- Produces:
  `sourceToFrame(p: { x: number; y: number }, rect: SourceRect, frame: Rect): { x: number; y: number } | null`.
  `p` is normalised source, top-left origin. Returns output-space pixels, or
  `null` when the point is outside the sampled region. Task 4 uses it for both
  the cursor and the ripples.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/shared/zoom/viewport.test.ts, and add sourceToFrame to the import

describe("sourceToFrame (invariants 5 and 6)", () => {
  const frame = frameFor(SOURCE);

  it("maps the centre of the region to the centre of the frame", () => {
    const rect = at(1.6, 0.3, 0.7);
    const p = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };

    expect(sourceToFrame(p, rect, frame)).toEqual({
      x: frame.x + frame.w / 2,
      y: frame.y + frame.h / 2,
    });
  });

  it("maps the whole source across the whole frame at rest", () => {
    const rect = at(1);
    expect(sourceToFrame({ x: 0, y: 0 }, rect, frame)).toEqual({ x: frame.x, y: frame.y });
    expect(sourceToFrame({ x: 1, y: 1 }, rect, frame)).toEqual({
      x: frame.x + frame.w,
      y: frame.y + frame.h,
    });
  });

  /** Invariant 6: an overlay outside the sampled region is not rendered. */
  it("rejects a point outside the sampled region", () => {
    const rect = at(2, 0.5, 0.5); // samples the middle half
    expect(sourceToFrame({ x: 0.05, y: 0.5 }, rect, frame)).toBeNull();
    expect(sourceToFrame({ x: 0.5, y: 0.95 }, rect, frame)).toBeNull();
  });

  it("keeps top-left orientation (invariant 10)", () => {
    // A point in the source's TOP half must land in the frame's TOP half.
    const rect = at(1);
    const mapped = sourceToFrame({ x: 0.5, y: 0.25 }, rect, frame);
    expect(mapped?.y).toBeLessThan(frame.y + frame.h / 2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL — `sourceToFrame` is not exported.

- [ ] **Step 3: Implement**

```ts
// append to src/shared/zoom/viewport.ts

/**
 * A point in the source, in output-space pixels — or null if it is not on
 * screen.
 *
 * The ONE mapping (invariant 5). The screen samples this region in the shader;
 * the cursor and the ripples map through this function. Three call sites each
 * carrying their own arithmetic is how they drift apart, and they agree today
 * only because they are all the identity.
 *
 * `p` and the result share one convention (invariant 10): top-left origin, y
 * increasing downward. There is no flip here — the only Y flip in the system
 * is in QUAD_VERT's gl_Position.
 */
export function sourceToFrame(
  p: { x: number; y: number },
  rect: SourceRect,
  frame: Rect,
): { x: number; y: number } | null {
  const u = (p.x - rect.x) / rect.w;
  const v = (p.y - rect.y) / rect.h;

  if (u < 0 || u > 1 || v < 0 || v > 1) return null;

  return { x: frame.x + u * frame.w, y: frame.y + v * frame.h };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/zoom/viewport.test.ts"
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/zoom/viewport.ts src/shared/zoom/viewport.test.ts
git commit -m "feat(camera): one source-to-frame mapping for every overlay"
```

---

### Task 4: The renderer stops growing the frame

This is the visible change. After it, the frame is a constant and the picture
moves inside it.

**Files:**
- Modify: `src/renderer/gl/layout.ts`
- Modify: `src/renderer/gl/layout.test.ts`
- Modify: `src/renderer/gl/shaders.ts`
- Modify: `src/renderer/gl/Renderer.ts`

**Interfaces:**
- Consumes: `sourceRectFor`, `sourceToFrame` (Tasks 1 and 3).
- Produces: `screenQuad(source, output, paddingFactor)` — **the zoom argument
  is gone**. It now returns `screenRect` and exists only so call sites keep one
  name for "the frame".

- [ ] **Step 1: Make the frame a constant**

In `src/renderer/gl/layout.ts`, replace the whole body of `screenQuad`:

```ts
import { screenRect, type Rect } from "../../shared/zoom/geometry";
import type { Size } from "../../shared/zoom/types";

/**
 * The frame the recording is drawn into. NOT a function of zoom.
 *
 * Zoom used to scale this rectangle until the output cropped it, which meant
 * the whole zoom range was 1/paddingFactor and the camera had no freedom at
 * the top of it. The camera is now `sourceRectFor` — the region SAMPLED into
 * this frame. See the 2026-09-07 spec §1.
 */
export function screenQuad(source: Size, output: Size, paddingFactor: number): Rect {
  return screenRect(source, output, paddingFactor);
}
```

- [ ] **Step 2: Move the old clamp tests out**

`layout.test.ts`'s `describe("screenQuad clamping", …)` sweeps a clamp that no
longer exists here — `viewport.test.ts` Task 2 is its replacement. Delete that
`describe` block and any of the `screenQuad` tests that pass a `ZoomState`.
Keep and adjust the tests that describe the frame itself (`reduces exactly to
screenRect`, `keeps padding visible`), which are now trivially true.

Add one test pinning the new contract:

```ts
it("does not move when the zoom changes", () => {
  // The whole point of the 2026-09-07 change: the frame is presentation, the
  // sampled region is the camera.
  const a = screenQuad(HD, HD, PAD);
  const b = screenQuad(HD, HD, PAD);
  expect(a).toEqual(b);
  expect(a).toEqual(screenRect(HD, HD, PAD));
});
```

- [ ] **Step 3: Teach the shader to sample a span**

In `src/renderer/gl/shaders.ts`, in `SCREEN_FRAG`, add the two uniforms and
sample through them. `v_uv` still drives the rounded-rect SDF, because that is
in quad space and the quad has not changed:

```glsl
uniform vec2  u_uv0;
uniform vec2  u_uv1;
```

and replace the first two statements of `main()`:

```glsl
  // The camera: sample this region of the recording across the fixed frame.
  vec2 uv = u_uv0 + v_uv * (u_uv1 - u_uv0);
  vec3 c = texture(u_tex, uv).rgb;

  if (u_sharpen > 0.0) {
    vec3 blur = texture(u_tex, uv + vec2(u_texel.x, 0.0)).rgb
              + texture(u_tex, uv - vec2(u_texel.x, 0.0)).rgb
              + texture(u_tex, uv + vec2(0.0, u_texel.y)).rgb
              + texture(u_tex, uv - vec2(0.0, u_texel.y)).rgb;
    c = clamp(c + u_sharpen * (c - blur * 0.25), 0.0, 1.0);
  }
```

Then add `"u_uv0"` and `"u_uv1"` to the uniform-name list the screen program is
built with in `Renderer.ts` (the array containing `"u_quadPx"`), or the
uniforms resolve to null and the screen renders black.

- [ ] **Step 4: Pass the span, and fix the sharpen term**

In `Renderer.ts`, `drawFrame`:

```ts
    const quad = screenQuad(src, out, style.paddingFactor);
    const region = sourceRectFor(state.zoom, quad, src);
```

and pass `region` into `drawScreen`, `drawRipples` and `drawCursor`. In
`drawScreen`, replace the `sampleScale` line and add the uniforms:

```ts
    // Upscaling begins when the sampled region is narrower than the frame it
    // is drawn into — which now depends on zoom, not on the quad's size.
    const sampleScale = quad.w / (src.w * region.w);
    const sharpen = sampleScale > 1 ? Math.min(MAX_SHARPEN, sampleScale - 1) : 0;

    gl.uniform2f(this.screen.uniforms.u_uv0 ?? null, region.x, region.y);
    gl.uniform2f(
      this.screen.uniforms.u_uv1 ?? null,
      region.x + region.w,
      region.y + region.h,
    );
```

- [ ] **Step 5: Map the overlays through the one mapping**

In `drawRipples`, replace the two position lines:

```ts
      const at = sourceToFrame({ x: r.x / src.w, y: r.y / src.h }, region, quad);
      if (at === null) continue;
      const { x, y } = at;
```

In `drawCursor`, replace the two position lines:

```ts
    const at = sourceToFrame({ x: sample.x / src.w, y: sample.y / src.h }, region, quad);
    if (at === null) return;
    const { x, y } = at;
```

Both functions take `region: SourceRect` as a new parameter.

- [ ] **Step 6: Clip the overlays to the frame**

An overlay whose anchor is inside the region can still overhang the frame's
edge, and there is no longer an output edge to crop it. Add one helper to
`Renderer.ts` and wrap the two overlay passes in it:

```ts
  /**
   * Run `draw` with rendering clipped to the frame.
   *
   * The ONE place a bottom-left origin appears: gl.scissor measures from the
   * bottom of the drawing buffer while every coordinate in this codebase
   * measures from the top (invariant 10). Confining the flip here is what
   * keeps that invariant true everywhere else.
   *
   * The scissor box is rectangular and the frame has rounded corners, so an
   * overlay can still show over a corner's cut. At a 12px radius that is a few
   * pixels in the extreme corners; accepted rather than masked.
   */
  private withFrameClip(quad: Rect, out: Size, draw: () => void): void {
    const gl = this.gl;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      Math.floor(quad.x),
      Math.floor(out.h - (quad.y + quad.h)),
      Math.ceil(quad.w),
      Math.ceil(quad.h),
    );
    try {
      draw();
    } finally {
      gl.disable(gl.SCISSOR_TEST);
    }
  }
```

Call sites:

```ts
    if (style.cursor.ripples) {
      this.withFrameClip(quad, out, () =>
        this.drawRipples(state.ripples ?? [], quad, region, out, src),
      );
    }

    if (state.cursor !== undefined && state.cursor.style.visible) {
      const cursor = state.cursor;
      this.withFrameClip(quad, out, () =>
        this.drawCursor(cursor.sample, cursor.style, quad, region, out, src),
      );
    }
```

- [ ] **Step 7: Verify**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm test"
```

Expected: typecheck silent, tests pass. Then:

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run tune -- all"
```

Expected: **byte-identical to before this task.** Nothing here touches the
planner; if `tune` moved, something in `geometry.ts` was changed by accident.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/gl src/shared/zoom
git commit -m "feat(camera): the frame stops moving and the camera samples the source"
```

---

### Task 5: The clamp stops being computed twice

**Files:**
- Modify: `src/shared/zoom/camera.ts`
- Modify: `src/shared/zoom/camera.test.ts`
- Modify: `src/shared/zoom/geometry.ts`
- Modify: `src/renderer/ui/Timeline.tsx` (the `maxComfortableZoom` prop)

**Interfaces:**
- Consumes: `sourceRectFor` (Task 1).
- Produces: `pixelParityZoom(source, output, paddingFactor)` replacing
  `maxComfortableZoom` — same arithmetic, honest name. Task 7 stops treating it
  as a cap.

- [ ] **Step 1: Derive the clamp instead of recomputing it**

In `src/shared/zoom/camera.ts`, replace `clampToSource` and delete `clampAxis`:

```ts
/**
 * Keep the viewport inside the source.
 *
 * Derived from `sourceRectFor` rather than reimplemented: two copies of this
 * arithmetic would be free to disagree, and the one the renderer samples with
 * is the one that decides what is on screen. Applied to the SMOOTHED path
 * rather than the raw cursor, so approaching an edge decelerates the camera
 * instead of sticking it against the wall.
 */
export function clampToSource(
  centre: { cx: number; cy: number },
  scale: number,
  ctx: PlanContext,
): { cx: number; cy: number } {
  const frame = screenRect(ctx.source, ctx.output, ctx.paddingFactor);
  const r = sourceRectFor({ scale, cx: centre.cx, cy: centre.cy }, frame, ctx.source);

  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
}
```

`camera.ts` already imports `screenRect`; add `sourceRectFor` from
`./viewport`, and drop `clamp` from the import if nothing else in the file uses
it — the compiler will say so under `noUnusedLocals`.

- [ ] **Step 2: Update the tests that encoded the old geometry**

`camera.test.ts`'s `"does not pin the camera when nothing is cropped"` and
`"has nowhere to pan at the zoom ceiling"` describe the OLD model, where
nothing cropped below 1/paddingFactor. Under the new geometry every scale above
1 crops. Replace them with:

```ts
  it("clamps so the viewport never leaves the source", () => {
    const { cx } = clampToSource({ cx: 0, cy: 0.5 }, 1.6, ctx);
    expect(cx).toBeCloseTo(1 / 1.6 / 2, 9);
  });

  it("leaves a centred viewport alone", () => {
    expect(clampToSource({ cx: 0.5, cy: 0.5 }, 1.6, ctx)).toEqual({ cx: 0.5, cy: 0.5 });
  });

  /** The camera now has somewhere to go at EVERY aspect, which it did not before. */
  it("pans at the native aspect", () => {
    const a = clampToSource({ cx: 0.45, cy: 0.5 }, 1.6, ctx).cx;
    const b = clampToSource({ cx: 0.5, cy: 0.5 }, 1.6, ctx).cx;
    expect(b).toBeGreaterThan(a);
  });

  it("decelerates into an edge rather than sticking at it", () => {
    const a = clampToSource({ cx: 0.35, cy: 0.5 }, 1.6, ctx).cx;
    const b = clampToSource({ cx: 0.4, cy: 0.5 }, 1.6, ctx).cx;
    expect(b).toBeGreaterThan(a);
  });
```

- [ ] **Step 3: Rename the ceiling to what it measures**

In `src/shared/zoom/geometry.ts`, rename `maxComfortableZoom` to
`pixelParityZoom` and rewrite its doc comment:

```ts
/**
 * The zoom at which one source pixel maps to one frame pixel. Above it the
 * picture is upscaled and softens.
 *
 * ADVICE, NOT A CAP, since 2026-09-07. It used to be the hard ceiling, which
 * made the entire zoom range 1/paddingFactor — the factor at which the old
 * growing frame exactly filled the output. The cap is now `ZoomConfig.maxZoom`
 * (Task 7); this number is what the UI reports so the softening threshold
 * stays visible.
 */
export function pixelParityZoom(source: Size, output: Size, paddingFactor: number): number {
```

Update every call site: `keyframes.ts`, `camera.test.ts`, `keyframes.test.ts`,
`Editor.tsx`, `Timeline.tsx`. The compiler will list them.

- [ ] **Step 4: Verify**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm test; npm run tune -- all"
```

Expected: tests pass; `tune` still byte-identical.

- [ ] **Step 5: Commit**

```bash
git add src/shared src/renderer
git commit -m "refactor(camera): one clamp, and a ceiling named for what it measures"
```

---

### Task 6: Re-baseline the guards, then watch it

**Files:**
- Modify: `tests/fixtures/basic/project.json` (or wherever the parity fixture's
  project lives — see `tools/verify-parity.ts`)

**Interfaces:** none. This task produces evidence.

- [ ] **Step 1: Re-baseline parity deliberately, in its own commit**

The parity fixture's stored keyframes carry absolute scales computed against
the old ceiling, so the first run after Task 4 proves less than usual.

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run verify:parity"
```

If it fails on stored scales rather than on preview/export disagreement, regenerate
the fixture's project and commit that alone, with a message saying why.
**If preview and export disagree with each other, stop** — that is a real
divergence and Task 4 introduced it.

- [ ] **Step 2: Run every guard**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck; npm run build; npm run verify:decode; npm run verify:parity"
```

Expected: 279+ tests, typecheck silent, decode 6/6, parity 25/25.

- [ ] **Step 3: Render a take and WATCH IT**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx tsx tmp\render-curves.ts 2026-09-06T17-50-34"
```

(or export from the editor). **This is a checkpoint, not a formality.** The
question this step answers: does a fixed frame with the picture moving inside
it read as a camera? Nothing downstream is worth doing if the answer is no.

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "test(camera): step 1 verified on real footage"
```

---

# Step 2 — Raise the ceiling (Task 7)

---

### Task 7: maxZoom becomes a dial

**Files:**
- Modify: `src/shared/zoom/types.ts`, `src/shared/zoom/config.ts`
- Modify: `src/shared/zoom/keyframes.ts`
- Modify: `src/renderer/ui/Inspector.tsx`, `src/renderer/ui/Timeline.tsx`
- Test: `src/shared/zoom/keyframes.test.ts`, `src/shared/project/migrate.test.ts`

**Interfaces:**
- Produces: `ZoomConfig.maxZoom: number`. Task 10 reads it through
  `depthConfigFrom`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/shared/zoom/keyframes.test.ts

/** Invariant 8: depth is relative, so the ceiling can move under it. */
describe("maxZoom", () => {
  it("maps full depth onto the configured ceiling", () => {
    const deep = { ...cfg, maxZoom: 1.6 };
    const kfs = segmentsToKeyframes([seg()], deep, ctx);
    expect(kfs[0]?.scale).toBeCloseTo(1.6, 9);
  });

  it("does not invalidate a stored depth when the ceiling changes", () => {
    const shallow = segmentsToKeyframes([seg()], { ...cfg, maxZoom: 1.2 }, ctx);
    const deep = segmentsToKeyframes([seg()], { ...cfg, maxZoom: 2.0 }, ctx);

    // Same stored segment, same normalised depth, different rendered scale.
    expect(shallow[0]?.scale).toBeCloseTo(1.2, 9);
    expect(deep[0]?.scale).toBeCloseTo(2.0, 9);
  });
});
```

```ts
// append to src/shared/project/migrate.test.ts
it("gives a project written before maxZoom the default ceiling", () => {
  const p = normalizeProject({ zoom: { config: { minHoldMs: 1500 } } }, "b");
  expect(p.zoom.config.maxZoom).toBe(1.6);
});
```

- [ ] **Step 2: Run them and watch them fail**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/zoom/keyframes.test.ts src/shared/project/migrate.test.ts"
```

Expected: FAIL — `maxZoom` is not on `ZoomConfig`.

- [ ] **Step 3: Add the field**

In `src/shared/zoom/types.ts`, in `ZoomConfig`:

```ts
  /**
   * The deepest the camera goes. A sharpness choice, not a geometric limit:
   * above `pixelParityZoom` (~1.18 at 1080p into 1080p) the picture is
   * upscaled. Because the frame is inset by paddingFactor, a zoom of s
   * upscales by s * paddingFactor — 1.6 costs 1.36x, not 1.6x.
   */
  maxZoom: number;
```

In `src/shared/zoom/config.ts`:

```ts
  maxZoom: 1.6,
```

In `src/shared/zoom/keyframes.ts`, replace the ceiling:

```ts
  // The configured cap, not the pixel-parity point. Before 2026-09-07 these
  // were the same number and that is exactly what capped every zoom at
  // full-bleed.
  const ceiling = cfg.maxZoom;
```

and delete the now-unused `maxComfortableZoom`/`pixelParityZoom` import there.

- [ ] **Step 4: Run the tests and watch them pass**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/zoom src/shared/project"
```

- [ ] **Step 5: Surface it**

In `src/renderer/ui/Inspector.tsx`, add to `FIELDS`:

```ts
  { key: "maxZoom", label: "max zoom (×)", step: 0.05, min: 1 },
```

In `src/renderer/ui/Timeline.tsx`, the footer already reports
`ceiling {maxComfortableZoom.toFixed(2)}×`. Pass `config.maxZoom` instead, and
label it `max zoom` — the pixel-parity number is no longer the ceiling.

- [ ] **Step 6: Verify and judge on footage**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm test; npm run tune -- all"
```

`tune` WILL change here: every zoom's scale moves from 1.176 to 1.6. **Zoom
counts and times must not change** — only scales. Then export and watch:

**The question this checkpoint answers: is 1.36× upscaling acceptable on your
text?** If not, lower the default and stop; step 1's benefit is kept either way.

- [ ] **Step 7: Commit**

```bash
git add src/shared src/renderer
git commit -m "feat(camera): the zoom ceiling becomes a choice, defaulting to 1.6x"
```

---

# Step 3 — Depth grading (Tasks 8–11)

Spec §5. **This step changes zoom counts**, unlike steps 1 and 2 — a cluster
spread over `contextFraction` of the source resolves to scale 1 and the planner
drops it. Judge it on the `tune` funnel, not only on scales.

---

### Task 8: Impulses carry their kind, clusters carry their intent

**Files:**
- Modify: `src/shared/zoom/types.ts`, `src/shared/zoom/impulses.ts`,
  `src/shared/zoom/cluster.ts`
- Test: `src/shared/zoom/cluster.test.ts`

**Interfaces:**
- Produces: `Impulse.kind: ImpulseKind`, `Cluster.intentScores`, and
  `clusterIntent(c: Cluster, cfg: DepthConfig): Intent`. Task 10 calls
  `clusterIntent`.
- Note: `Intent` and `DepthConfig` are defined in Task 9. Implement Task 9
  first if you are working alone; the two are split because they are separately
  reviewable, not because they are independent.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/shared/zoom/cluster.test.ts
import { clusterIntent } from "./cluster";
import { DEFAULT_DEPTH_CONFIG } from "./depth";

describe("clusterIntent", () => {
  const cfg = DEFAULT_DEPTH_CONFIG;
  const imp = (kind: "click" | "key" | "wheel", t: number, x = 500) => ({
    t, x, y: 400, w: 1, srcIndex: 0, kind,
  });

  it("calls a lone click a click", () => {
    expect(clusterIntent(clusterOf([imp("click", 0)]), cfg)).toBe("click");
  });

  /**
   * The case the design cares about: people click into a field before typing
   * into it, and a typing run wants CONTEXT, not the deepest zoom available.
   * One click scores 1.0 against twenty keystrokes at 8.0.
   */
  it("calls a typing run opened by a click a typing run", () => {
    const imps = [imp("click", 0), ...Array.from({ length: 20 }, (_, i) => imp("key", i * 50))];
    expect(clusterIntent(clusterOf(imps), cfg)).toBe("type");
  });

  it("calls a scroll burst a scroll", () => {
    const imps = Array.from({ length: 6 }, (_, i) => imp("wheel", i * 40));
    expect(clusterIntent(clusterOf(imps), cfg)).toBe("scroll");
  });

  /** Deterministic, and it errs toward context: too much is recoverable. */
  it("breaks a tie toward the shallower intent", () => {
    // 1 click (1.0) against 2.5 keys' worth of weight is not a tie; construct
    // one exactly: 1 click = 1.0, and 2.5 keys = 1.0.
    const c = clusterOf([imp("click", 0)]);
    c.intentScores.key = c.intentScores.click;
    expect(clusterIntent(c, cfg)).toBe("type");
  });
});
```

Add the helper at the top of the file if one does not already exist:

```ts
function clusterOf(imps: Impulse[]): Cluster {
  return clusterImpulses(imps, DEFAULT_ZOOM_CONFIG)[0] as Cluster;
}
```

- [ ] **Step 2: Run it and watch it fail**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/zoom/cluster.test.ts"
```

Expected: FAIL — `clusterIntent` is not exported.

- [ ] **Step 3: Stamp the kind on each impulse**

In `src/shared/zoom/types.ts`:

```ts
export type ImpulseKind = "click" | "key" | "wheel";

export type Impulse = {
  t: number;
  x: number;
  y: number;
  w: number;
  srcIndex: number;
  /**
   * What produced this impulse. Separate from `w`: that weight decides whether
   * a cluster earns a zoom at all (minWeight), while intent decides how deep
   * the zoom goes. Sharing one number would mean tuning depth silently changed
   * how many zooms there are.
   */
  kind: ImpulseKind;
};
```

In `src/shared/zoom/impulses.ts`, add `kind` to each of the three `out.push`
calls: `"click"` in the `down` case, `"wheel"` in the `wheel` case, `"key"` in
the `key` case.

- [ ] **Step 4: Accumulate the scores**

In `src/shared/zoom/types.ts`, on `Cluster`:

```ts
  /** Summed intent weight per kind; `clusterIntent` takes the argmax. */
  intentScores: Record<ImpulseKind, number>;
```

In `src/shared/zoom/cluster.ts`, in `absorbImpulse`:

```ts
  c.intentScores[im.kind] += 1;
```

in `absorbCluster`:

```ts
  a.intentScores.click += b.intentScores.click;
  a.intentScores.key += b.intentScores.key;
  a.intentScores.wheel += b.intentScores.wheel;
```

and in the object literal that starts a new cluster inside `clusterImpulses`:

```ts
      intentScores: { click: 0, key: 0, wheel: 0, [im.kind]: 1 },
```

`mergeAndFilter`'s `{ ...c }` shallow-copies the record, which two merged
clusters would then share; give it its own copy:

```ts
    merged.push({ ...c, intentScores: { ...c.intentScores } });
```

Do the same in `applyGuards`'s `kept.push({ ...c })`.

**Counts, not weights, go in `intentScores`** — the weighting happens in
`clusterIntent`, so the weights stay tunable without re-clustering.

- [ ] **Step 5: Implement clusterIntent**

```ts
// append to src/shared/zoom/cluster.ts
import type { DepthConfig, Intent } from "./depth";

/**
 * What the user was doing, as one label.
 *
 * The greatest summed intent weight wins. Ties break toward the SHALLOWER
 * intent, which is deterministic and errs the safe way: a viewer can recover
 * from seeing too much context, not from seeing too little.
 */
export function clusterIntent(c: Cluster, cfg: DepthConfig): Intent {
  // Shallowest first, so a >= comparison naturally keeps the shallower one on
  // a tie.
  const ranked: Array<[Intent, number]> = [
    ["scroll", c.intentScores.wheel * cfg.intentWeight.wheel],
    ["type", c.intentScores.key * cfg.intentWeight.key],
    ["click", c.intentScores.click * cfg.intentWeight.click],
  ];

  let best: Intent = "scroll";
  let bestScore = -1;

  for (const [intent, score] of ranked) {
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }

  return best;
}
```

- [ ] **Step 6: Run the tests and watch them pass**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm test"
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/zoom
git commit -m "feat(camera): impulses carry their kind, clusters their intent"
```

---

### Task 9: The depth rule

**Files:**
- Create: `src/shared/zoom/depth.ts`
- Test: `src/shared/zoom/depth.test.ts`

**Interfaces:**
- Produces: `Intent`, `DepthInputs`, `DepthConfig`, `DEFAULT_DEPTH_CONFIG`,
  `zoomDepth(inputs, cfg): number`, `depthConfigFrom(cfg: ZoomConfig)`.
  Tasks 8 and 10 consume them.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/zoom/depth.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_DEPTH_CONFIG, zoomDepth } from "./depth";

const cfg = DEFAULT_DEPTH_CONFIG;
const none = { x: 0, y: 0 };

describe("zoomDepth", () => {
  it("goes deepest for a click", () => {
    expect(zoomDepth({ intent: "click", spread: none }, cfg)).toBeCloseTo(cfg.base.click, 9);
  });

  it("leaves context when reading", () => {
    const type = zoomDepth({ intent: "type", spread: none }, cfg);
    expect(type).toBeLessThan(zoomDepth({ intent: "click", spread: none }, cfg));
    expect(type).toBeGreaterThan(zoomDepth({ intent: "scroll", spread: none }, cfg));
  });

  /**
   * The most common path, not an edge case: 29 of the 54 clusters on disk have
   * no spatial spread at all.
   */
  it("applies no pullback at zero spread", () => {
    expect(zoomDepth({ intent: "click", spread: none }, cfg)).toBeCloseTo(cfg.base.click, 9);
  });

  it("pulls back so a spread-out cluster still fits", () => {
    const wide = zoomDepth({ intent: "click", spread: { x: 0.5, y: 0.1 } }, cfg);
    expect(wide).toBeLessThan(cfg.base.click);
    expect(wide).toBeCloseTo(cfg.contextFraction / 0.5, 9);
  });

  it("uses the larger axis of the spread", () => {
    const a = zoomDepth({ intent: "click", spread: { x: 0.5, y: 0.1 } }, cfg);
    const b = zoomDepth({ intent: "click", spread: { x: 0.1, y: 0.5 } }, cfg);
    expect(a).toBeCloseTo(b, 12);
  });

  it("never zooms out, and never passes the ceiling", () => {
    expect(zoomDepth({ intent: "click", spread: { x: 0.99, y: 0.99 } }, cfg)).toBe(1);
    expect(zoomDepth({ intent: "click", spread: none }, { ...cfg, maxZoom: 1.2 })).toBe(1.2);
  });

  it("is pure — same inputs, same answer", () => {
    const inputs = { intent: "click" as const, spread: { x: 0.2, y: 0.2 } };
    expect(zoomDepth(inputs, cfg)).toBe(zoomDepth(inputs, cfg));
  });

  /** The seam. Absent must mean "no constraint", never "size zero". */
  it("ignores an absent target size", () => {
    expect(zoomDepth({ intent: "click", spread: none, targetSize: undefined }, cfg))
      .toBeCloseTo(cfg.base.click, 9);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL — `./depth` does not exist.

- [ ] **Step 3: Implement**

```ts
// src/shared/zoom/depth.ts
import { clamp } from "./geometry";
import type { ImpulseKind, ZoomConfig } from "./types";

export type Intent = "click" | "type" | "scroll";

export type DepthInputs = {
  /** Dominant kind of activity in the cluster, by weight. */
  intent: Intent;
  /**
   * The cluster's bounding box as a FRACTION of the source, per axis — not in
   * pixels, so the rule is resolution-independent and a 4K capture grades the
   * same way a 1080p one does.
   */
  spread: { x: number; y: number };
  /**
   * NOT AVAILABLE TODAY, and deliberately so. The telemetry is raw screen
   * coordinates with no element behind them; getting real bounds needs either
   * UI Automation over COM or computer vision on the captured frame, and both
   * are their own project. See the 2026-09-07 spec §8.
   *
   * Absent means "no constraint" — never "size zero".
   */
  targetSize?: { x: number; y: number };
};

export type DepthConfig = {
  base: Record<Intent, number>;
  /** What fraction of the frame the activity may occupy. */
  contextFraction: number;
  maxZoom: number;
  intentWeight: Record<ImpulseKind, number>;
};

export const DEFAULT_DEPTH_CONFIG: DepthConfig = {
  base: { click: 1.55, type: 1.35, scroll: 1.15 },
  contextFraction: 0.6,
  maxZoom: 1.6,
  intentWeight: { click: 1, key: 0.4, wheel: 0.3 },
};

/**
 * How deep a zoom goes, as an absolute scale.
 *
 * Intent sets the base and spread only ever pulls it back. That asymmetry is
 * measured, not stylistic: of the 54 clusters that earn a zoom across every
 * take on disk, 29 have zero spatial spread and 38 are under 200px, so there
 * is nothing to grade on for most zooms. Spread is a safety valve that stops a
 * wide scatter of activity being framed too tightly; it fires on about 8 of
 * those 54.
 *
 * Pure: no renderer, no layout, no clock (invariant 9).
 */
export function zoomDepth(inputs: DepthInputs, cfg: DepthConfig): number {
  const base = cfg.base[inputs.intent];
  const spreadMax = Math.max(inputs.spread.x, inputs.spread.y);

  // A zero-spread cluster has no spread constraint. Written out rather than
  // left to division by zero: `0.6 / 0` is Infinity and therefore happens to
  // give the right answer, and a correct result reached by accident is one
  // refactor away from a NaN.
  const pullback = spreadMax > 0 ? cfg.contextFraction / spreadMax : Number.POSITIVE_INFINITY;

  return clamp(Math.min(base, pullback), 1, cfg.maxZoom);
}

/**
 * The depth rule's config, from the persisted one.
 *
 * `ZoomConfig` stays flat because `normalizeProject` spreads it over the
 * defaults — a nested object stored partially would replace the whole default
 * rather than merge into it, and old projects would silently lose fields. This
 * adapter is what lets the pure function take the shape the spec describes
 * while persistence keeps the shape migration can handle.
 */
export function depthConfigFrom(cfg: ZoomConfig): DepthConfig {
  return {
    base: { click: cfg.zoomClick, type: cfg.zoomType, scroll: cfg.zoomScroll },
    contextFraction: cfg.contextFraction,
    maxZoom: cfg.maxZoom,
    intentWeight: {
      click: cfg.intentWeightClick,
      key: cfg.intentWeightKey,
      wheel: cfg.intentWeightWheel,
    },
  };
}
```

- [ ] **Step 4: Add the flat config fields**

In `src/shared/zoom/types.ts`, on `ZoomConfig`:

```ts
  /** Base zoom for a click-led cluster. See depth.ts. */
  zoomClick: number;
  /** Base zoom for a typing run — shallower, because reading needs context. */
  zoomType: number;
  /** Base zoom for a scroll burst. */
  zoomScroll: number;
  /** What fraction of the frame the activity may occupy before pulling back. */
  contextFraction: number;
  /** Intent weights. Separate from Impulse.w, which gates minWeight instead. */
  intentWeightClick: number;
  intentWeightKey: number;
  intentWeightWheel: number;
```

In `src/shared/zoom/config.ts`:

```ts
  zoomClick: 1.55,
  zoomType: 1.35,
  zoomScroll: 1.15,
  contextFraction: 0.6,
  intentWeightClick: 1,
  intentWeightKey: 0.4,
  intentWeightWheel: 0.3,
```

- [ ] **Step 5: Run the tests and watch them pass**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npx vitest run src/shared/zoom/depth.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add src/shared/zoom
git commit -m "feat(camera): grade zoom depth by intent, with a spread pullback"
```

---

### Task 10: The planner uses it

**Files:**
- Modify: `src/shared/zoom/planner.ts`
- Test: `src/shared/zoom/planner.test.ts`

**Interfaces:**
- Consumes: `zoomDepth`, `depthConfigFrom` (Task 9), `clusterIntent` (Task 8),
  `scaleToDepth` (existing, `keyframes.ts`).
- Produces: nothing new. `fitScale` in `geometry.ts` becomes unused — delete it
  and its tests.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/shared/zoom/planner.test.ts
it("zooms deeper for a click than for a scroll", () => {
  const click = plan([{ t: 1000, k: "down", x: 500, y: 400, b: 1 }], DEFAULT_ZOOM_CONFIG, ctx);
  const scroll = plan(
    Array.from({ length: 6 }, (_, i) => ({ t: 1000 + i * 40, k: "wheel" as const, x: 500, y: 400, dy: -1 })),
    DEFAULT_ZOOM_CONFIG,
    ctx,
  );

  expect(click[0]?.scale ?? 0).toBeGreaterThan(scroll[0]?.scale ?? 0);
});

it("pulls back for activity spread across the screen", () => {
  const tight = plan([{ t: 1000, k: "down", x: 960, y: 540, b: 1 }], DEFAULT_ZOOM_CONFIG, ctx);
  const wide = plan(
    [
      { t: 1000, k: "down", x: 200, y: 540, b: 1 },
      { t: 1200, k: "down", x: 1700, y: 540, b: 1 },
    ],
    { ...DEFAULT_ZOOM_CONFIG, clusterRadiusPx: 2000 },
    ctx,
  );

  expect(wide[0]?.scale ?? 0).toBeLessThan(tight[0]?.scale ?? 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL — every zoom is currently the same scale, so both assertions
compare equal numbers.

- [ ] **Step 3: Replace fitScale in the planner**

In `src/shared/zoom/planner.ts`:

```ts
import { clusterIntent } from "./cluster";
import { depthConfigFrom, zoomDepth } from "./depth";
```

and in the loop over clusters:

```ts
  const depthCfg = depthConfigFrom(cfg);

  for (const c of clusters) {
    const scale = zoomDepth(
      {
        intent: clusterIntent(c, depthCfg),
        // Normalised per axis, so the rule does not depend on the capture's
        // resolution.
        spread: {
          x: (c.maxX - c.minX) / ctx.source.w,
          y: (c.maxY - c.minY) / ctx.source.h,
        },
      },
      depthCfg,
    );
    if (scale <= 1.0001) continue;
    // …unchanged from here
```

and the waypoint's depth uses the configured ceiling:

```ts
        depth: scaleToDepth(w.scale, cfg.maxZoom),
```

with the `ceiling` local and the `pixelParityZoom` import removed.

- [ ] **Step 4: Delete fitScale**

It has no call sites left. Remove it from `src/shared/zoom/geometry.ts` and
remove its tests from `geometry.test.ts`. Leaving a second, differently-tuned
depth rule in the tree is how the two drift apart.

- [ ] **Step 5: Run everything**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm test"
```

- [ ] **Step 6: Judge the funnel, not just the scales**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run tune -- all"
```

**Zoom counts will change here** — a cluster spread over `contextFraction` of
the source resolves to scale 1 and gets dropped. The widest cluster on disk
spans 1638px of 1920 (0.85), so expect it to stop earning a move. Read the
funnel line, not just the scale range, and check the count drop is the wide
clusters rather than something unintended.

Then export a take and watch it. Tune `zoomClick` / `zoomType` /
`contextFraction` against what you see, not against what reads well here.

- [ ] **Step 7: Commit**

```bash
git add src/shared/zoom
git commit -m "feat(camera): the planner grades depth instead of fitting bounds"
```

---

### Task 11: Handover

- [ ] **Step 1: Update `HANDOVER.md`**

The camera section describes the OLD model in several places and must be
rewritten, not appended to:

- "at peak zoom the shot is full-bleed by design" — no longer true, and it was
  the whole problem.
- "follow does nothing at the native aspect" — no longer true; cropping now
  begins at any scale above 1.
- The `maxComfortableZoom` / three-call-sites note — the ceiling no longer
  derives from output size.

Add: the frame is presentation and the sampled region is the camera; where the
clamp lives now; that `tune`'s zoom counts changed at Task 10 and why.

- [ ] **Step 2: Record what was actually decided on footage**

The three checkpoints (Tasks 6, 7 and 10) each answered a question by watching.
Write down what was chosen and what it looked like — the numbers in
`config.ts` are worthless to the next session without the judgement behind
them.

- [ ] **Step 3: Say plainly what is still not fixed**

The preview decode cost is unchanged by this plan: advancing one source frame
still decodes from the nearest keyframe, ~15 frames on average at GOP 30. If
the preview still stutters, that is why, and an incremental decoder is the fix.
Do not let three watchable improvements imply a fourth that did not happen.

- [ ] **Step 4: Commit**

```bash
git add HANDOVER.md
git commit -m "docs: hand over the camera geometry and depth work"
```

---

## Self-Review

**Spec coverage.** §3 invariants 1–4 are Tasks 1 and 4; 5 and 6 are Tasks 3 and
4; 7 is Task 2; 8 is Task 7; 9 is Task 9; 10 is Tasks 3 and 4 (and the scissor
helper is the one place the flip is allowed). §4 geometry is Tasks 1, 3, 4 and
5. §5 depth is Tasks 8, 9 and 10. §6's upscaling budget is what Task 7's
checkpoint judges. §7's three steps are the three task groups. §8 is the
`targetSize` field and its test in Task 9. §9's testing table is distributed
across the tasks it belongs to. §10's risks: cursor clipping is Task 4 step 6,
the continuity regression is Task 2, parity re-baselining is Task 6 step 1, and
the stale-absolute-scale case is Task 7's migrate test.

**Deviation from the spec, recorded.** `sourceRectFor` and `sourceToFrame` live
in `src/shared/zoom/viewport.ts`, not `src/renderer/gl/layout.ts`, so that
`clampToSource` can derive from the same implementation instead of keeping a
second copy — see the section above the file table.

**Placeholders.** None. Every code step carries the code. Task 4's shader edit
and Task 8's cluster edits describe changes to existing lines precisely rather
than restating whole files, which would drift.

**Type consistency.** `SourceRect` (Task 1) is consumed by `sourceToFrame`
(Task 3), `Renderer` (Task 4) and `clampToSource` (Task 5). `Intent` and
`DepthConfig` (Task 9) are consumed by `clusterIntent` (Task 8) — the two are
cross-referenced in Task 8's interface block because the dependency runs
backwards there. `ZoomConfig.maxZoom` (Task 7) is read by `keyframes.ts` (Task
7) and `depthConfigFrom` (Task 9). `pixelParityZoom` (Task 5) replaces
`maxComfortableZoom` at every call site.

**Risk.** Task 4 is the one that can silently break rendering, and parity is
re-baselined immediately after it, so read Task 6 step 1 carefully — a parity
failure there might be a real divergence rather than a stale fixture. Task 10
is the one that changes pacing.
