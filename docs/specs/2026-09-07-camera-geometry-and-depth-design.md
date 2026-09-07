# Camera geometry and zoom depth — design

**Status:** approved 2026-09-07, unimplemented.
**Supersedes:** decision 1 of `docs/superpowers/plans/2026-09-06-phase-c-camera.md`
("the zoom ceiling stays where it is… do not fix this"), deliberately reversed
below after watching an export.
**Related:** `2026-09-04-composition-and-camera-design.md` §7 (render model),
§9 (camera), §11 (timeline).

## 1. The problem, measured

Zoom currently means **the screen rectangle grows until the output frame crops
it**. `screenQuad()` scales `screenRect()` by `zoom.scale`; `drawScreen` maps
the texture 1:1 across that rectangle; the output edge does the cropping.

Two consequences, both visible in the export of 2026-09-07T09-22-19:

1. **The whole zoom range is 1.0 → 1.176×**, and all it does is eat the 15%
   padding. `maxComfortableZoom` is `source.w / screenRect.w`, which with
   `output == source` is exactly `1 / paddingFactor`. Every zoom in every take
   on disk sits at that number — `tune` prints `scale 1.176–1.176` on all of
   them. At 2s the frame is composed with background visible; at 6s it is
   precisely full-bleed, and that is as far as it goes.
2. **At the ceiling the camera has zero freedom.** The quad exactly covers the
   output, so `cx`/`cy` are clamped to the only legal position — dead centre.
   The camera logic is inert exactly when the zoom is deepest, which is why the
   result reads as "the screen is being scaled" rather than "a camera is
   moving". It is not an interpolation defect: `zoomAt` already lerps scale,
   cx and cy from one easing at one progress value, and `screenQuad` already
   composes them into a single transform.

The composition is also lost precisely when zoomed in, because filling the
frame is what "zoomed in" means under this model.

## 2. Decisions

1. **The frame stops moving.** Zoom becomes a sub-region of the *source*
   sampled across a *fixed* frame, not a growing frame. The inset screen with
   its rounded corners, shadow and background stays the same size forever.
2. **The ceiling is a sharpness choice, not a geometric limit.** It becomes one
   configured number (`maxZoom`, default 1.6) rather than a value derived from
   the output size.
3. **Depth is graded**, by interaction intent with a spread-based pullback.
4. **Target size is out of scope**, and is a seam rather than a dependency —
   see §8.
5. **Three separately watchable steps** (§7). Motion cannot be judged by
   reasoning; each step is judged on an export before the next begins.

## 3. Camera invariants

These are the contract. Each is a property test, not a comment.

1. **`screenRect` is not a function of zoom.** The drawn frame depends on
   source size, output size and `paddingFactor` only.
2. **`sourceRect` lies completely inside the source.** No sample ever falls
   outside `[0,1]²`, so background never leaks inside the frame.
3. **`sourceRect` preserves the frame's aspect ratio.** Note *frame*, not
   output: `screenRect` fits the source's aspect inside the padded output, so a
   1:1 output shows a letterboxed 16:9 frame rather than a square crop. Tying
   the invariant to the frame keeps it correct if a true crop mode is ever
   added; tying it to the output would be wrong today.
4. **`zoom = 1` shows the maximum intended source region** — today the whole
   source, and "intended" leaves room for a future crop mode.
5. **Cursor, ripples and screen pixels use one shared mapping.** A single
   `sourceToFrame(p, sourceRect, screenRect)` serves all three; there is no
   second copy of the arithmetic.
6. **An overlay whose source position lies outside `sourceRect` is not
   rendered.** A cursor beside the sampled region must not draw over the
   background.
7. **Camera animation interpolates continuously between valid camera states.**
   No discontinuity in `sourceRect` as a function of `(scale, cx, cy)` — see
   §3.1.
8. **Changing `maxZoom` does not invalidate stored normalised depth.**
   `ZoomSegment.waypoints[].depth` stays 0–1 against whatever the current
   ceiling is.
9. **`zoomDepth()` is deterministic and has no renderer or layout side
   effects.** Pure function, testable in `src/shared/` with no GL context.

### 3.1 The continuity invariant, specifically

The head-of-file jump (fixed 2026-09-06) was a clamp discontinuity in
`screenQuad`: the legal range collapsed to zero width at exactly the crossover,
pinning `x` while the unclamped value was hundreds of pixels away, and one
float below the crossover the clamp released and the camera teleported. It was
measured at 229px.

**That clamp moves to `sourceRect`, so its property tests move with it.** The
required property, swept exhaustively rather than sampled:

> For any centre and any two scales differing by ε, `sourceRect` differs by
> O(ε). There is no scale at which a small change in scale or centre produces a
> large change in the sampled region.

Both bounds must be written as one continuous range, exactly as the current
clamp is, and for the same reason.

## 4. Geometry

### 4.1 What the renderer does now

```
frame      = screenRect(source, output, paddingFactor)   // fixed
sourceRect = sourceRectFor(zoom, frame)                  // 1/scale of the source
draw:  sample sourceRect of the texture across frame
```

`sourceRectFor` returns a normalised region:

```ts
export type SourceRect = { x: number; y: number; w: number; h: number }; // 0..1

export function sourceRectFor(zoom: ZoomState, frame: Rect, source: Size): SourceRect;
```

- `w = 1 / zoom.scale`, and `h = w * (source.w / source.h) / (frame.w / frame.h)`
  — which is `h = w` while the frame carries the source's aspect, written the
  long way so invariant 3 is enforced rather than assumed.
- Centred on `(cx, cy)`, then clamped so the region stays inside `[0,1]²`.
- At `scale = 1` it is exactly `{ x: 0, y: 0, w: 1, h: 1 }` (invariant 4).

### 4.2 Changes by file

| File | Change |
|---|---|
| `src/renderer/gl/layout.ts` | `screenQuad` returns the fixed frame. New `sourceRectFor` carries the clamp and the continuity property. New `sourceToFrame(pNorm, sourceRect, frame)` — the one shared mapping of invariant 5, returning `null` when the point is outside (invariant 6). |
| `src/renderer/gl/shaders.ts` | Screen fragment shader gains `u_uv0`/`u_uv1`; `v_uv` is remapped into that span. |
| `src/renderer/gl/Renderer.ts` | `drawScreen` passes the UV span. `sampleScale` becomes `frame.w / (source.w * sourceRect.w)`. `drawCursor` and `drawRipples` go through `sourceToFrame` and skip anything it rejects. `drawShadow` becomes static. |
| `src/shared/zoom/camera.ts` | `clampToSource` collapses to `visibleFraction = 1/scale`, always binding. The "does anything crop at this aspect?" branch disappears. |
| `src/shared/zoom/geometry.ts` | `maxComfortableZoom` is renamed `pixelParityZoom` and demoted to advice — the point at which one source pixel maps to one output pixel, reported in the UI, no longer a cap. The cap is `cfg.maxZoom`. |

### 4.3 What gets simpler

- The ceiling stops depending on output size, so the three `outputSizeFor` call
  sites no longer have to agree about it to compute a scale.
- The follow camera starts working at 16:9. It is currently inert there
  because nothing crops below the ceiling.
- Corner radius and shadow stop scaling with zoom.

## 5. Depth

### 5.1 The function

```ts
export type DepthInputs = {
  /** Dominant kind of activity in the cluster, by weight. */
  intent: "click" | "type" | "scroll";
  /**
   * The cluster's bounding box as a FRACTION of the source, per axis, not in
   * pixels: normalised so the rule is resolution-independent and a 4K capture
   * grades the same way a 1080p one does.
   */
  spread: { x: number; y: number };
  /**
   * Absent today and expected to stay absent for a while — see §8. When
   * present, the interacted element's size as a fraction of the source.
   * Absent means "no constraint", never "size zero".
   */
  targetSize?: { x: number; y: number };
};

export function zoomDepth(inputs: DepthInputs, cfg: DepthConfig): number;
```

Returns an absolute scale, clamped to `[1, cfg.maxZoom]`.

### 5.2 The rule

```
base     = cfg.base[intent]                       // click > type > scroll
pullback = cfg.contextFraction / max(spread.x, spread.y)
scale    = clamp(min(base, pullback), 1, cfg.maxZoom)
```

- **Intent sets the base.** `click` deepest; `type` middle, because reading
  needs surrounding context; `scroll` shallowest.
- **Spread only ever pulls back.** `contextFraction` says what fraction of the
  frame the activity may occupy — expressed as a fraction rather than a pixel
  margin so it survives a resolution change.
- Starting constants: `click 1.55`, `type 1.35`, `scroll 1.15`,
  `contextFraction 0.6`, `maxZoom 1.6`. **These are starting points, not
  decisions** — they get tuned with `tune -- all` and exports.

**The pullback can remove a zoom, not just shallow it.** Activity spanning
`contextFraction` of the source resolves to a scale of 1, and the planner
already drops a segment whose scale is not above 1. On the takes on disk the
widest cluster spans 1638px of 1920 — 0.85 — so it would stop earning a camera
move at all. That is intended (activity filling the screen has nothing to zoom
into), but it means **step 3 changes zoom counts**, unlike steps 1 and 2. Judge
it on `tune -- all` funnels, not only on depth numbers.

**The planner stores depth, not scale.** `zoomDepth` returns an absolute scale;
the planner converts with `scaleToDepth(scale, cfg.maxZoom)` before writing the
waypoint, which is what invariant 8 protects.

### 5.3 Why intent has to carry it

Measured over every take on disk: 54 clusters earn a zoom, and **29 of them
have zero spatial spread** — a single click. Median spread is 0; 38 of 54 are
under 200px; only 8 exceed 600px.

So spread cannot be the primary grader: for most zooms there is nothing to
grade on. It is a safety valve that fires on roughly 8 of 54 clusters and stops
a wide scatter of activity being framed too tightly. This is also why
"compute depth from the cluster's bounds", which is what `fitScale` does today,
saturates at the cap: a single click has bounds of zero and asks for ~12×.

### 5.4 Upstream change

`Impulse` gains a `kind` (`click | key | wheel`), and a cluster's intent is its
dominant kind by weight. Keystrokes already borrow the most recent click's
position, so a typing cluster is anchored where the typing is happening.

`fitScale` is replaced by `zoomDepth` at its one call site in the planner.

## 6. What upscaling actually costs

Because the frame is inset to `paddingFactor`, a zoom of `s` upscales the
source by `s × paddingFactor`, not by `s`:

| zoom | source px sampled | into frame px | upscale |
|---|---|---|---|
| 1.0 | 1920 | 1632 | 0.85× (downsampling, sharp) |
| 1.176 | 1632 | 1632 | 1.00× (pixel parity) |
| 1.6 | 1200 | 1632 | 1.36× |
| 2.0 | 960 | 1632 | 1.70× |

`drawScreen` already applies a sharpen pass above 1:1 (`u_sharpen`, capped at
`MAX_SHARPEN`), so 1.36× is meaningfully gentler than the raw number suggests.
1080p is the whole budget on this machine; a higher-resolution capture lifts
every row with no code change.

## 7. Sequencing

Three steps, each a commit that can be judged and reverted on its own.

| Step | Content | Judged by |
|---|---|---|
| 1 | Model B geometry. Ceiling left at pixel parity (1.176×); depth rules unchanged. | One export: is a fixed frame with the picture moving inside it the right feel? |
| 2 | `maxZoom` becomes a dial, default 1.6. | One export: is 1.36× upscaling on text acceptable? |
| 3 | Intent + spread depth grading. | `tune -- all`, then exports. |

If step 2's softness is unacceptable, stopping there keeps step 1's benefit.

## 8. Out of scope: target size

The telemetry is `move / down / up / wheel / key / cursor-shape`, all raw
screen coordinates. There is no element and no bounds — the recorder is outside
the app being recorded. Two routes exist and both are their own project:

- **UI Automation** — `ElementFromPoint` → `BoundingRectangle` gives the real
  element rect. It is COM, not the flat C API the existing koffi binding uses,
  and it needs the target app's accessibility tree; Chrome builds one on
  demand, which slows the browser being recorded.
- **Computer vision** — region detection around the click point in the captured
  frame. No dependency on the app, works everywhere, and it guesses.

`WindowFromPoint` is cheap and koffi-friendly but useless here: the recordings
are Chrome and Figma, one HWND for the whole window.

**The decision is to validate intent + spread on real footage first.** After
step 3, judge specifically:

- Does the camera zoom too deeply into large UI elements?
- Does it fail to zoom deeply enough for small, important interactions?
- Are there recurring cases where intent and spread together cannot determine
  good framing?

Only a consistent yes justifies the subsystem. `targetSize` is a documented
optional field so that adding it later is a new term in one pure function, not
a restructure.

## 9. Testing

| Invariant | Guard |
|---|---|
| 1, 3, 4 | Unit tests on `sourceRectFor` over a sweep of scales, centres and output aspects. |
| 2, 7 | Exhaustive sweep in `layout.test.ts`, carried over from the `screenQuad` clamp tests — the ones that hold the head-of-file jump closed. |
| 5, 6 | Unit tests on `sourceToFrame`, including points outside the sampled region. |
| 8 | `depthToScale`/`scaleToDepth` round-trip at two different `maxZoom` values. |
| 9 | `zoomDepth` tested in `src/shared/` with no GL context. |
| Whole pipeline | `verify:parity` — preview and export both go through `Renderer`, so divergence is caught for free. Expect to re-baseline the fixture: its stored keyframes carry absolute scales computed against the old ceiling. |
| Pacing | `tune -- all` before and after steps 1 and 2, which must not change zoom *counts* — only depths. Step 3 is expected to change counts; see §5.2. |

## 10. Risks

- **Cursor clipping is new** and easy to get subtly wrong at frame edges. It
  has no equivalent today, because the output edge did the clipping.
- **The continuity bug can come back in a new place.** The clamp moves; §3.1 is
  the mitigation.
- **Parity's fixture needs re-baselining**, which means a green parity run
  proves less on the first commit than it usually does. Re-baseline
  deliberately and in its own commit.
- **`ZoomKeyframe.scale` is absolute and persisted.** Derived keyframes are
  regenerated on load so they self-heal, but a pinned or manual keyframe from
  before this change carries a scale computed against the old ceiling.
  `normalizeProject` should be checked against that case.
