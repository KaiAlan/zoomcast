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
10. **One coordinate convention, one flip boundary.** Every coordinate in this
    system — telemetry, `sourceRect`, `screenRect`, `sourceToFrame` input and
    output — is **top-left origin, y increasing downward**. This is already
    true and must stay true: `u_rect` places geometry in output space from the
    top left, and textures are uploaded *without* `UNPACK_FLIP_Y_WEBGL`, so
    `v_uv.y = 0` is the top row of the image. The single Y flip into clip space
    happens in one place, `QUAD_VERT`'s `gl_Position`. `sourceToFrame` inherits
    that convention and performs no flip of its own. The failure this prevents
    is three call sites (screen, cursor, ripple) each carrying their own
    correction and happening to agree today.

### 3.1 The continuity invariant, specifically

The head-of-file jump (fixed 2026-09-06) was a clamp discontinuity in
`screenQuad`: the legal range collapsed to zero width at exactly the crossover,
pinning `x` while the unclamped value was hundreds of pixels away, and one
float below the crossover the clamp released and the camera teleported. It was
measured at 229px.

**That clamp moves to `sourceRect`, so its property tests move with it.**

**Where the crossover is now.** `sourceRect.x` is clamped to `[0, 1 - w]`. That
range collapses to zero width exactly at `w = 1`, which is `scale = 1` — the
direct analogue of the old crossover at `w = output.w`. So `scale = 1` is the
boundary that matters, and it must be written as one continuous range
(`clamp(x, 0, 1 - w)`), never as a gated branch. Written that way the collapse
is continuous: the range shrinks to `[0, 0]` smoothly rather than releasing one
float away. Writing it as two cases is exactly how the 229px teleport happened.

**The testable property.** "Exhaustive" cannot mean every float, so it means a
defined finite domain plus targeted probes:

> For a perturbation ε in either scale or centre,
> `distance(sourceRect(s, c), sourceRect(s ± ε, c ± ε)) ≤ K·ε + tol`
> in normalised source units.

`K = 2` is the bound to assert, derived rather than guessed: `w = 1/s`, so
`|dw/ds| = 1/s² ≤ 1` for `s ≥ 1`; `x = cx - w/2` gives `|dx/ds| ≤ 0.5` and
`|dx/dcx| ≤ 1`; and clamping is 1-Lipschitz, so it can only reduce movement.
Two is therefore a safe bound with margin. In concrete terms on a 1920px
source, a 0.001 change in scale may move the sampled region by at most ~4px —
against the 229px the original bug produced.

**The domain to sweep**, all of it, plus probes at `boundary − ε`, `boundary`
and `boundary + ε` for each boundary below:

| Swept | Values |
|---|---|
| scale | a fixed grid from 1.0 to `maxZoom` in steps of 0.005 |
| centre | a fixed grid of `cx`, `cy` over `[0, 1]` in steps of 0.05, including exactly 0 and 1 |
| output aspect | native, 1:1, and one output smaller than the source |

| Boundary | Why it is a boundary |
|---|---|
| `scale = 1` | the clamp range collapses to zero width (above) |
| `cx = w/2`, `cx = 1 − w/2` | the centre reaches an edge and the clamp begins to bind |
| `cx = 0`, `cx = 1` | the extremes of the centre's own domain |
| `scale = maxZoom` | the configured cap |
| `scale = pixelParityZoom` | not a clamp, but where the sharpen term switches on; assert it too, since `min(MAX_SHARPEN, s − 1)` is continuous only if written that way |

Systematic coverage of where discontinuities can live beats a claim of
universal coverage that no test can honour.

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

**That last point is conditional, and the condition must not be forgotten.**
`scale = 1` can only produce `{0, 0, 1, 1}` while the maximum intended source
region and the frame share the source's aspect ratio, which the current fitted
frame guarantees. **A future crop mode must redefine the maximum intended
source region before this invariant can hold**, because a frame that crops to
a different aspect cannot show the whole source at any scale. Read
"`zoom = 1` = whole source" as a consequence of today's frame, never as a
definition.

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

Returns an absolute scale, clamped to `[1, cfg.maxZoom]`. `DepthConfig` carries
`base` (per intent), `contextFraction`, `maxZoom` and `intentWeight` (§5.4).

### 5.2 The rule

```
base      = cfg.base[intent]                      // click > type > scroll
spreadMax = max(spread.x, spread.y)
pullback  = spreadMax > 0
              ? cfg.contextFraction / spreadMax
              : Infinity                          // no constraint
scale     = clamp(min(base, pullback), 1, cfg.maxZoom)
```

**A zero-spread cluster has no spread constraint and resolves to its intent
base.** This is not an edge case to be discovered at runtime: 29 of the 54
clusters on disk have zero spread, so it is the single most common path through
this function. Dividing by zero happens to yield `Infinity` and therefore the
right answer in JavaScript, which is exactly why it must be written explicitly —
a correct result reached by accident is one refactor away from a `NaN`.

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

`Impulse` gains a `kind` (`click | key | wheel`). Keystrokes already borrow the
most recent click's position, so a typing cluster is anchored where the typing
is happening.

**Intent is the kind with the greatest summed intent weight.** Two rules make
that unambiguous:

```
weightFor(kind) = cfg.intentWeight[kind]          // click 1.0, key 0.4, wheel 0.3
score(kind)     = Σ weightFor(kind) over the cluster's impulses of that kind
intent          = argmax score, ties broken toward the SHALLOWER base
```

1. **`cfg.intentWeight` is its own config, not `Impulse.w`.** The existing
   impulse weight feeds `minWeight`, which decides whether a cluster earns a
   zoom at all. Reusing it here would couple two unrelated decisions, so that
   tuning how deep a typing zoom goes could silently change how many zooms
   there are. The starting values are the same numbers; the point is that they
   can move apart.
2. **Ties break toward the shallower base** (`scroll` < `type` < `click`).
   Deterministic, and it errs the safe way: showing too much context is
   recoverable for a viewer, showing too little is not.

The rule gives the behaviour the design wants without a special case. One click
followed by twenty keystrokes scores `1.0` against `8.0`, so **a typing run
opened by a click classifies as `type`**, which is the intent whose base depth
is deliberately shallower because reading needs surrounding context.

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
| 2, 7 | The finite grid and the boundary probe table of §3.1, in `layout.test.ts`, carried over from the `screenQuad` clamp tests that hold the head-of-file jump closed. Assert the `K = 2` bound, not "looks continuous". |
| 5, 6 | Unit tests on `sourceToFrame`, including points outside the sampled region. |
| 10 | One test asserting a known source point lands where expected in the frame at a non-trivial zoom, for the screen, the cursor and a ripple — the three that must agree. A y-flip in any one of them fails it. |
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
