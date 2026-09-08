# Preview frame-source split, and three ports from Recordly

**Written 2026-09-08.** Branch `recordly-lessons`, cut from `main` at `de58d62`.

Supersedes nothing. Extends
`docs/specs/2026-09-04-composition-and-camera-design.md` §13 (phase D) and
answers the preview-performance question left open by
`docs/superpowers/plans/2026-09-07-camera-feel-handoff.md`.

## Why

The editor preview runs at ~13fps. `bench:preview` measures it repeatably
(13.6 / 13.0 / 13.0 on a 60fps take). That is what "lagging and glitchy" was,
and it means camera work currently has to be judged on an export.

The 2026-09-07 handoff listed three routes: decouple the playhead from the wall
clock, preview at reduced resolution, or skip to motion blur. **This spec takes
a fourth route that was not considered then**, found by reading the Recordly
source (`github.com/webadderallorg/Recordly`, v1.4.0, AGPLv3 — read for ideas,
no code copied).

### The root cause, stated precisely

`VideoSource.frameAt` is a manual media pipeline: mp4box demux, a fresh
`VideoDecoder` per frame, a hand-rolled rAF scheduler, and a playhead driven
from `performance.now()`.

The decoding itself is not the problem — `VideoDecoder` *is* Chromium's
hardware decoder. The problem is the orchestration around it:

- **15x amplification.** A new decoder per frame decoding from the nearest
  keyframe, against a GOP of exactly 30, is ~15 decoded frames per displayed
  frame.
- **A feedback loop.** `PreviewPlayer` sets the playhead from the wall clock,
  so a slow draw advances it ~60 frames — past the next keyframe — and an
  incremental decode path can never engage during playback. This is why the
  stateful-decoder attempt went from 13fps to 1.5fps with `fastHits: 0`.

Recordly never hits either, because their preview is an `HTMLVideoElement`
feeding a GPU texture. The browser owns demux, buffering, and frame timing.

### Why a split rather than a replacement

Export and preview have opposite requirements:

| | needs | `<video>` can do it? |
| --- | --- | --- |
| Export | deterministic frame-exact random access at arbitrary output times | No — seeks are async and approximate |
| Preview | smooth forward playback | Yes, and better than we can |

Sharing `frameAt` between both is *why* `verify:parity` holds by construction,
and that was good thinking. The error was scope: one mechanism serving two
workloads that want different things. So the decoder stays for export and
`<video>` is added for preview.

## What changes

| Step | Change | Risk |
| --- | --- | --- |
| 0 | `zc://` honours HTTP Range | Low — blocker for step 1 |
| 1 | `FrameSource` interface; `<video>` source for preview | High — the main work |
| 2 | `ZOOM_IN_OVERLAP_MS = 500` in the planner | Low |
| 3 | Directional motion blur (phase D) | Medium |
| 4 | Bundle ffmpeg — **gated on a probe** | Blocked until probed |

## Step 0 — Range support on `zc://`

**This is a hard prerequisite for step 1 and is the reason it comes first.**

`src/main/index.ts:85` handles `zc://` by calling `net.fetch(file://…)` and
returning `new Response(res.body, …)`. It never reads `request.headers.range`,
never returns 206, and sets neither `Accept-Ranges` nor `Content-Range`.

That is fine today: `VideoSource` reads the whole file into an ArrayBuffer, so
range requests never arise. But **Chromium's media stack seeks by issuing Range
requests.** Point a `<video>` at a range-less URL and it must buffer the entire
recording before seeking behaves. Measuring `bench:preview` against a video
element that is still downloading would produce a meaningless number.

This is precisely what Recordly's `electron/mediaServer.ts` exists for — it
implements `resolveHttpByteRange`, 206, `Content-Range`, `Accept-Ranges` and
416. It reads like dev-server scaffolding and is in fact the enabling piece for
their preview.

**Decision: extend the `zc://` handler rather than stand up a second server.**
`zc://` already solved the same-origin problem; a localhost HTTP server is a
second surface to secure, port-allocate and tear down.

Behaviour:

- No `Range` header → today's behaviour, plus `Accept-Ranges: bytes`.
- `bytes=N-M`, `bytes=N-`, `bytes=-S` → 206 with `Content-Range` and a
  `createReadStream(path, { start, end })` body.
- Unsatisfiable start → 416 with `Content-Range: bytes */<size>`.

Testable as a pure function (`resolveByteRange(header, size)`) plus a thin
handler, mirroring how the rest of `src/shared` is structured.

## Step 1 — the `FrameSource` split

New `src/renderer/media/FrameSource.ts`, shaped to today's `VideoSource`
surface so `DecodedFrameSource` satisfies it without behaviour changes:

```ts
export interface FrameSource {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  /** Resolves to something the Renderer can upload as a texture. */
  frameAt(tMs: number): Promise<TexImageSource>;
  /** One frame of lookahead. A no-op for the <video> source. */
  prefetch(tMs: number): Promise<void>;
  close(): void;
}
```

`prefetch` stays in the interface because `PreviewPlayer` takes it as a
constructor argument and `Editor.tsx:247` drives it. For `VideoElementSource`
it is a no-op — the browser's own buffering replaces it — but dropping it from
the interface would churn `PreviewPlayer` for no gain in this pass.

Two implementations:

- **`DecodedFrameSource`** — today's `VideoSource`, moved behind the interface,
  logic unchanged. Consumers: `exportClip.ts:118`, `tools/verify-decode.ts`,
  `src/renderer/shoot.ts`.
- **`VideoElementSource`** — an `HTMLVideoElement` plus
  `requestVideoFrameCallback`. Consumer: `Editor.tsx:191` (preview only).

`Renderer` needs no shader or geometry change: `gl.texImage2D` accepts
`HTMLVideoElement` and `VideoFrame` under the same `TexImageSource` union, so
`FrameState` and the composition passes are untouched.

### PreviewPlayer

During playback, stop computing `outputAtStart + elapsed`. Instead:

- `video.play()`, and draw from the `requestVideoFrameCallback` callback.
- Take the playhead from the callback's `mediaTime` — the exact presentation
  timestamp of the frame about to be drawn.

**This obtains route (1) from the handoff doc — decoupling the playhead from
the wall clock — as a side effect rather than as work.** Frame accuracy
improves rather than degrades: composing against `mediaTime` aligns telemetry
to the frame actually on screen, which the current requested-`t` model only
approximates.

Paused scrubbing sets `currentTime` and draws on `seeked`.

### Explicitly out of scope for this step

**Audio keeps its current sync model.** Do not let `<video>` take over as the
master clock in this pass. That is a separate change with its own failure modes
and it would confound the `bench:preview` comparison.

## Step 2 — `ZOOM_IN_OVERLAP_MS = 500`

Recordly's zoom-in *finishes* 500ms after its region starts, so the camera is
still arriving as activity begins. Ours arrives exactly at the start.

A new dial in `src/shared/zoom/config.ts` alongside `transitionMs: 1500` and
`transitionOutMs: 1000`, applied where keyframes are emitted.

Per the standing rule in HANDOVER: run `npm run tune -- all` before and after,
and record both. No dial moves without it.

## Step 3 — motion blur (phase D)

Pass 5 of the composition pipeline as already specified in
`2026-09-04-composition-and-camera-design.md:214` — a directional post pass
driven by camera velocity.

The control law was measured on 2026-09-07 and is recorded in the camera-feel
handoff. Restated here so this spec stands alone:

- track camera `dx`, `dy`, `dScale` per frame; clamp `dt` to 1–80ms
- `speed = |velocity| + |dScale| * max(w, h) * 0.5` — scale change counts as
  motion, so a pure zoom blurs
- `normalised = min(1, speed / 2000)`
- `blur = normalised^2 * 8px * amount` — quadratic, so gentle moves get almost
  none
- below 15 px/s the blur is zero; without this deadzone an idle camera shimmers
- direction from the velocity vector, magnitude `* 1.2`
- kernel size steps 5 / 9 / 11 by blur amount

Ours renders in WebGL2, not pixi, so the filter itself is written here; the
control law above is the part that needed measurement and it is done.

**Must be evaluated on the fixed grid, not per displayed frame.** A per-frame
formulation makes a 60fps preview and a 30fps export diverge and fails
`verify:parity` — the same trap already noted for the cursor spring.

Strength is a setting and may default off if export time suffers
(`2026-09-04-composition-and-camera-design.md:375`).

## Step 4 — ffmpeg bundling, gated

Two facts sit in tension:

- HANDOVER calls the unbundled ffmpeg a gap: a machine without ffmpeg installs
  fine and then fails to record.
- `src/main/ffmpeg.ts:5` records the opposite as a deliberate decision:
  ffmpeg "is deliberately NOT vendored".

More decisive: **capture requires the `ddagrab` filter**, which `ffmpeg.ts:56`
already asserts. `ffmpeg-static` ships a generic build and it is unverified
whether it includes `ddagrab`. Recordly can use `ffmpeg-static` because for
them ffmpeg is the *fallback* — their capture is native WGC/DXGI.

**If that build lacks `ddagrab`, bundling it does not fix a broken install; it
breaks a working one.**

Gate: probe first — install `ffmpeg-static`, run `-filters`, grep `ddagrab`.

- Present → bundle it, keep `ZOOMCAST_FFMPEG` and PATH as overrides, and update
  the `ffmpeg.ts` comment to record the reversal and why.
- Absent → do not bundle. Add a first-run capability check that fails loudly
  with a real message instead of at record time.

## Invariants

Nothing below may regress. Each is already enforced by an existing harness.

| Invariant | Harness |
| --- | --- |
| Preview and export compose identically | `verify:parity`, 25/25 at ≥28dB |
| The export decode path is unchanged | `verify:decode`, 6/6, k=0 wins |
| Unit suite | `npm test`, 326 passing / 36 files |
| Types | `npm run typecheck`, silent |

`verify:parity` carries more weight after this change than before. Today parity
holds *by construction* because both paths call `frameAt`. After the split it
holds *by verification*. That is a real reduction in guarantee strength and is
accepted deliberately, because the harness already exists, already covers five
configurations and five output times, and was built precisely to catch
preview/export divergence.

## Verification

- **`bench:preview`, batch against batch.** Never one run against one — 9.6 and
  20.7fps have both been measured on identical code. Record median and spread
  before and after.
- **`verify:parity` after step 1.** The colour-space risk lands here.
- **`npm run tune -- all` around step 2.**
- Motion blur is judged on an export, not in the editor.

The editor cannot be driven from this environment (WSL); everything above runs
through `powershell.exe`. Final subjective "does it feel smooth" is the user's.

## Risks

| Risk | Mitigation |
| --- | --- |
| Colour space differs between `VideoFrame` and `<video>` texture upload (BT.709) | `verify:parity` is the guard; budget for an explicit colourspace uniform. Recordly carries a whole `videoColorSpace.ts` for this |
| Range support on `zc://` proves awkward | Falls back to route 2 (reduced-resolution preview) as an interim; step 1 pauses, steps 2–3 are unaffected |
| `<video>` seek granularity hurts scrubbing | Draw on `seeked` and compose against `mediaTime`; scrubbing is already not the smooth-playback case |
| Motion blur costs too much per frame | Strength is a setting, may default off |

## What this deliberately does not do

- **No native capture helper.** Recordly's C++ WGC/DXGI helpers buy portability,
  not speed. `ddagrab` + `h264_amf` is already measured at 88.7fps / 1.48x
  realtime.
- **No CUDA compositor, no three-route export policy.** Both exist to serve
  hardware and platforms this project does not target.
- **No pixi.js.** The WebGL2 renderer works and carries the project's
  composition semantics; adopting pixi would rewrite that for no gain.
- **No audio clock rework.** Named in step 1 as out of scope.
