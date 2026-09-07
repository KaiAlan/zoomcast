# zoomcast — composition, cursor and camera design

Date: 2026-09-04
Status: approved for planning
Extends: `docs/specs/2026-09-03-screen-recorder-design.md`

## 1. Purpose

Phases 0–7 produced a tool that records, plans zooms, cuts, scrubs and exports.
What it does not yet produce is footage that looks composed: there is no
cursor, no background, and the camera snaps between fixed points.

Most of this is not new scope. The v1 spec §3 already lists "styled frame:
background, padding, rounded corners, drop shadow" and "custom-rendered cursor
with smoothing and click ripples"; §10 already specifies the five renderer
passes in order.

Three of those passes exist. `Renderer.drawFrame` runs
`drawBackground → drawShadow → drawScreen` today: a linear gradient or solid
background, a rounded-rect drop shadow, and the screen quad with padding,
corner radius and unsharp. What is missing is the **cursor pass**, the richer
background kinds (mesh gradient, image, blur), the frame border, and — the
reason none of it is apparent — **any UI at all for `style`**. The Inspector
exposes zoom config and nothing else, so the background has never been
changeable.

This document is therefore a completion of §10, plus two genuinely new pieces:
a follow-cursor camera, and editable zoom segments on the timeline.

The reference is Cursorful, whose UI the author recorded for comparison.

## 2. What the reference does

From the demo recording, Cursorful's editor offers:

| Group | Controls |
| --- | --- |
| Output | Aspect ratio (Native) |
| Background | `Image / Hidden / Gradient / Color`, twelve presets, custom image, **Image blur** (Moderate / Strong) |
| Browser frame | `Default / Minimal / Hidden`, frame shadow, frame border |
| Cursor | Size, smooth movement, cursor shadow, movement sway |
| Effects | Motion blur |
| Timeline | Zoom segments as draggable, resizable regions on their own track |
| Zoom popover | `Segment / Global`; per segment **Position: Follow cursor / Fixed** and **Depth**; globally a default depth and an *Apply zooms* master toggle |
| Clip actions | Speed, crop, trim, zoom |

The two ideas worth taking wholesale are **the zoom as a first-class timeline
object** and **the camera following the cursor rather than sitting on a fixed
anchor**. The second is why their footage reads as fluid: a damped follow
produces continuous motion, where a fixed anchor can only teleport between
still points.

## 3. Diagnosis of the current build

Each of these was measured, not assumed.

**No cursor.** `drawMouse: false` is hardcoded at `SessionController.ts:107`
and `:176`. That is correct per v1 decision #6 — the cursor is meant to be
drawn, not captured — but the drawing half was never built, so there is no
cursor at all.

**Snappy zooms.** `transitionMs` is 600 with `cubicBezier(0.33, 0, 0.1, 1)`,
an aggressive decelerate that spends most of its motion in the first third.
The curve is secondary though: the camera is pinned to a static `cx, cy` per
keyframe, so between shots it can only cut or slide in a straight line.

**Laggy preview.** Three independent causes:

1. `PreviewPlayer` calls `onTick` on every `requestAnimationFrame`, and the
   editor's `onTick` calls `setPlayheadMs`, re-rendering the React tree 60
   times a second.
2. `PreviewPlayer.draw()` drops any frame that arrives while a decode is in
   flight (`if (this.busy) return`). Dropping is correct in preference to
   queueing, but nothing prefetches, so the drops are frequent.
3. gdigrab measured 26–29fps against 30 requested. There are simply fewer
   source frames than smooth camera motion needs, and no amount of easing
   hides it.

**Invisible zooms.** The timeline draws cuts and a playhead. Zoom keyframes
exist in the project and are re-planned live, but nothing renders them, so the
plan can only be judged by watching playback.

**Unreachable style.** `StyleConfig` — padding, corner radius, shadow,
background — is honoured by the renderer and persisted in `project.json`, but
`Inspector.tsx` lists only `ZoomConfig` fields. Every styling control in this
document is therefore new UI over partly-existing rendering, not new rendering
throughout.

## 4. Scope

In scope:

- Synthetic cursor with real shapes, size, smoothing and shadow
- Background: procedural gradients, solid colour, custom image, blur
- Frame: corner radius, drop shadow, border, and a `Default / Minimal / Hidden`
  preset triple
- Aspect ratio and export resolution controls
- Follow-cursor camera with damping, and retuned transitions
- Directional motion blur driven by camera velocity
- Zoom segments as draggable, resizable timeline objects with per-segment
  position and depth
- Undo/redo
- Real trim regions, and clip speed

Out of scope, unchanged from v1 §18: window-following capture, silence
detection, multi-monitor, HDR, GIF/WebM export.

Explicitly **not** taken from the reference: webcam PiP stays deferred to
phase 8 as already planned, and "movement sway" is omitted — it is a
stylistic tic that fights the damping rather than complementing it.

## 5. Background presets are procedural

Cursorful ships twelve bitmap backgrounds. This design generates mesh
gradients in the fragment shader instead.

Three reasons: shipped images carry a licence that travels with anything
redistributed; generated gradients stay sharp at any export resolution,
including 4K, where a 1080p bitmap would not; and the installer stays small.
Custom image upload covers the case procedural gradients cannot.

A custom image is **copied into the project directory** rather than
referenced, so a project does not break when the source file moves.

## 6. Data model

### project.json

`style` grows to match what v1 §10 already assumed, plus the new controls:

```jsonc
"style": {
  "paddingFactor": 0.85,
  "frame": {
    "preset": "default",          // default | minimal | hidden
    "cornerRadiusPx": 12,
    "shadow": { "blurPx": 48, "opacity": 0.35, "offsetYPx": 16 },
    "border": { "visible": false, "widthPx": 1, "color": "#ffffff22" }
  },
  "background": {
    "kind": "gradient",           // gradient | color | image | hidden
    "preset": "aurora",           // named procedural gradient
    "color": "#0d0e11",
    "imageFile": null,            // copied into the project dir
    "blur": "moderate"            // none | moderate | strong
  },
  "cursor": {
    "visible": true,
    "sizePct": 100,
    "smoothing": 0.8,             // 0 = raw telemetry, 1 = heavily damped
    "shadow": true,
    "ripples": true
  },
  "motionBlur": { "enabled": true, "strength": 0.5 }
},
"output": { "width": 1920, "height": 1080, "aspect": "native", "fps": 60 }
```

### Zoom segments

`src/shared/zoom/segments.ts` already has a `Segment` type, introduced when the
pacing guards were added. It is currently an internal stage between clusters and
keyframes. It gets promoted to the persisted, editable unit:

```ts
type ZoomSegment = {
  id: string;
  startMs: number;              // source time
  endMs: number;
  position: "follow" | "fixed";
  depth: number;                // 0..1, mapped onto the derived zoom ceiling
  origin: "auto" | "manual";
  pinned: boolean;
};
```

Keyframes remain the render-time representation; segments are what the planner
emits, the timeline draws and the user edits. `replan()` keeps its existing
contract — pinned and manual segments survive re-planning.

### Telemetry

No change. `TelemetryEvent` already carries
`{ t, k: "cursor", shape: CursorShape }` and the manifest already carries
`telemetry.hasCursorShapes`. The schema was designed for this and never filled.

## 7. Render model

v1 §10's pass order stands. Passes 1–3 exist and are extended; 4 and 5 are new.

1. **Background** *(exists: linear gradient, solid)* — extended with mesh
   gradient presets, image, and a blur stage.
2. **Shadow** *(exists)* — unchanged.
3. **Screen quad** *(exists: camera transform, SDF corners, unsharp)* —
   extended with an optional border.
4. **Cursor** *(new)* — vector shape at the smoothed position, constant
   apparent size under zoom, optional shadow and click ripples.
5. **Motion blur** *(new)* — directional post pass, driven by camera velocity.

v1 numbered the webcam as pass 4 and the cursor as 5; since the webcam is still
deferred to phase 8, the cursor takes 4 here and motion blur — which v1 did not
have — takes 5. When phase 8 lands the webcam slots in between the screen quad
and the cursor. It does not interact with anything in this document.

**Preview and export keep calling this same `Renderer`.** That is the
structural claim the whole design rests on, and `verify:parity` is its guard.
Every phase below must leave it passing.

## 8. Cursor pipeline

Capture: `koffi` calling `user32!GetCursorInfo` at 30Hz from the main process,
appending shape events to the existing telemetry stream. `drawMouse` stays
`false`.

Shapes are **drawn as vectors**, not extracted from Windows `HCURSOR` bitmaps.
Extraction means `GetIconInfo`, colour/mask bitmap handling and DPI variants,
for a result that is a fixed-size bitmap — the one thing that cannot survive
being zoomed. Eight vector shapes cover `CursorShape` and stay sharp at any
depth and any export resolution.

Position comes from the same *function* the camera uses (§9), evaluated at two
half-lives: a cursor-scale one driven by the `smoothing` style control, and a
camera-scale one fixed by the segment. They are deliberately not one shared
path. `smoothing` is a presentation control the user can set to 0 — raw
telemetry — and a camera that inherited that would jitter every time someone
turned cursor smoothing off. So `buildCursorPath` takes `halfLifeMs` directly
and the 0-1 mapping (`smoothingToHalfLife`, capped at 90ms) is applied at the
call site. Sharing the function is what keeps the two from disagreeing about
*shape*; the half-lives are what let them disagree about *lag*, which is
correct — a camera lags a cursor on purpose.

Size is compensated for zoom so apparent size stays constant: a cursor that
grows with the zoom looks like a bug, not a feature.

## 9. Camera

The planner keeps deciding **when** to zoom — that is the pacing work already
tuned against real footage, and it is unaffected. Segments decide **where**.

For `position: "fixed"`, the centre is the cluster centroid, as today.

For `position: "follow"`, the centre tracks a **smoothed cursor path**: a
exponential (one-pole) lag over the telemetry position events, evaluated once
for the whole take and cached on the project.

The lag is deliberate in preference to a true second-order spring. Memoryless
exponential decay composes exactly across step sizes, so the no-overshoot and
frame-rate-independence properties hold exactly rather than approximately — a
real spring, carrying velocity state, would give neither for free, and an
overshooting camera looks broken.

Precomputing rather than integrating per frame is the important decision. A
per-frame simulation depends on frame timing, so preview at 60fps and export at
30fps would produce different paths — and `verify:parity` would be right to
fail. A precomputed path is a pure function of telemetry and config: identical
in both, and testable in `src/shared/` with no renderer at all.

The viewport is clamped so a follow never shows outside the source frame; the
clamp is applied to the smoothed path, not the raw cursor, so hitting an edge
decelerates rather than sticking.

Transitions get longer and gentler than the current 600ms, and both duration
and curve become per-project settings rather than constants.

## 10. Preview performance

Three fixes, matching the three causes in §3:

1. The playhead moves to a ref, with React state updated on a throttle
   (~10Hz) for the readout only. The timeline playhead is positioned by direct
   style write, not by re-render.
2. `VideoSource` prefetches the next frames during playback, so `draw()` has a
   decoded frame waiting rather than dropping.
3. The measured capture rate is surfaced in the editor. This one cannot be
   fixed in software — it is the gdigrab fallback documented in the handover —
   but it can stop being mistaken for a rendering fault.

## 11. Timeline

Zoom segments render as labelled regions on a dedicated track, draggable to
move and resizable from either edge. Selecting one opens a popover with the
reference's `Segment / Global` split: per-segment position and depth, globally
a default depth and an *apply zooms* master toggle.

Cuts become real regions with the same affordances, replacing the placeholder
"cut 0.5s here" button.

Undo/redo arrives here, implemented as v1 §6 specifies — immutable project
snapshots. It lands in this phase rather than earlier because this is the first
point where editing is rich enough that losing work hurts.

## 12. Speed — reversing a v1 decision

The author asked for clip speed. It is included, last, and with its cost
stated plainly, because it **reverses v1 decision #9** and moves an item out of
v1 §18.

v1 chose ripple cuts only so that `sourceToOutput` / `outputToSource` stay
monotonic and piecewise with constant slope 1. §9 of that spec says directly:
"speed ramps would make the slope vary and force zoom keyframes to be remapped
through it." That is exactly what adding speed does. The timeline mapping is
the module v1 identified as most likely to harbour off-by-one errors, which is
why it is pure and property-tested.

So the phase carries two requirements the others do not:

- the existing property tests for the mapping must be extended to
  variable-slope segments before any speed UI exists;
- zoom segment times, cursor path times and audio must all be remapped through
  the same function, with a test that proves a zoom lands on the same *content*
  after a speed change.

If that proves as invasive as v1 predicted, the honest outcome is to stop and
leave speed out. It is the one item here that is genuinely optional.

## 13. Phases

| Phase | Content | Depends on |
| --- | --- | --- |
| A | Cursor pipeline: koffi capture, vector shapes, size, smoothing, shadow, ripples | — |
| B | Compositor: background, blur, frame radius/shadow/border, aspect + resolution | — |
| C | Camera: persisted segments, follow-cursor damping, retuned transitions, preview performance | A, B |
| D | Motion blur | C |
| E | Timeline: draggable zoom segments, segment/global popover, real cuts, undo/redo | C |
| F | Clip speed | E |
| G | UI revamp: the whole editor surface | E |

A leads because it is the loudest defect, is self-contained, and nothing
depends on it. C waits for both A and B so the camera is tuned once, against
the finished composited look rather than raw full-bleed footage.

G was added 2026-09-05 at the user's request and is deliberately last of the
feature phases. A revamp needs to know what it is presenting: E is what settles
the timeline's shape, and until draggable segments, real cut regions and
undo/redo exist, any layout would be redesigned again as they land. It has no
spec section yet — it needs its own brainstorm rather than a task list, because
unlike A–F it is not a defect with a known fix.

## 14. Testing

The existing strategy holds and extends:

- Everything in `src/shared/` stays pure — the smoothed cursor path, the
  segment model and the timeline mapping are all testable in plain node, which
  is what keeps the suite fast.
- `verify:parity` is the guard on every render change. A phase that breaks it
  is a phase that broke the design, not a phase that needs its threshold
  relaxed.
- `npm run tune` extends to report camera motion, not just zoom pacing, so the
  follow damping can be judged without watching a window.
- `ZOOMCAST_SHOOT` grows fixtures for each background kind, frame preset and
  cursor shape, so composition regressions show up as image diffs.

## 15. Risks

| Risk | Mitigation |
| --- | --- |
| Speed breaks the timeline mapping | Property tests extended first; abandoning speed is an acceptable outcome |
| Motion blur costs too much per frame | Strength is a setting; it can default off if export time suffers |
| `koffi` adds a native dependency that breaks packaging | Packaging already handles a native addon (`uiohook-napi`, `asarUnpack`); verify with the packaged record test before building on it |
| Follow camera makes footage feel drifty | Damping is a setting, and `fixed` remains available per segment |
| Scope: six phases is a lot | Each phase ships independently and leaves the app working |

## 16. Decision log

Continuing v1's numbering.

| # | Decision | Rationale |
| --- | --- | --- |
| 11 | Procedural background presets, not shipped images | No licence travels with the output, stays sharp at 4K, installer stays small |
| 12 | Vector cursor shapes, not extracted `HCURSOR` bitmaps | A bitmap cursor cannot survive being zoomed, which is the entire reason v1 chose to draw the cursor |
| 13 | Smoothed cursor path precomputed, not simulated per frame | A per-frame simulation depends on frame rate, so preview and export would diverge and `verify:parity` would fail correctly |
| 14 | Zoom segments promoted to the persisted, user-editable unit | Keyframes are a render representation; the reference proves segments are the right editing representation |
| 15 | Cursor size compensated for zoom | Constant apparent size; a growing cursor reads as a bug |
| 16 | Speed included but last, and abandonable | It reverses decision #9 and makes the highest-risk module variable-slope; it is the only item here worth dropping under pressure |
| 17 | Movement sway omitted | Fights the damping that makes follow work |
