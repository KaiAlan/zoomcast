# zoomcast — design spec

Date: 2026-09-03
Status: approved for planning
Author: design session (brainstorming + grilling)

## 1. Purpose

A Windows screen recorder and editor for personal use, producing clips with
automatic cursor-aware zoom, a styled frame, webcam picture-in-picture and
narration. Functionally a Screen Studio equivalent; Screen Studio is macOS-only
and the Windows alternatives are either ancient (Camtasia) or thin.

This is a tool for its author. There is no installer, no licensing, no
telemetry, no onboarding, no crash reporting and no support surface. Every
decision below optimises for the author's own friction, not for a market.

## 2. Target environment

Fixed, single machine. The design may assume it.

| Property | Value |
| --- | --- |
| OS | Windows 11 Home, build 26200 (25H2), x64 |
| Display | 1920x1080 @ 144Hz, single |
| Display adapter | AMD Radeon(TM) Graphics (integrated) — drives the panel |
| Secondary GPU | NVIDIA GeForce RTX 3050 Laptop — no display attached |
| Runtime | Node 22.x, Electron, native Windows toolchain |

Two consequences carry through the whole design:

1. **Desktop Duplication must run on the AMD adapter.** The NVIDIA card has no
   attached output, so DXGI Desktop Duplication cannot capture from it.
2. **The panel is native 1080p with no 2x backing store.** Unlike macOS Retina,
   captured pixels equal output pixels, so any zoom above 1:1 is an upscale.
   Section 8 handles this rather than ignoring it.

## 3. Scope

In scope for v1:

- Full-display capture, 1080p60
- Cursor telemetry with automatic zoom planning
- Styled frame: background, padding, rounded corners, drop shadow
- Webcam picture-in-picture
- Microphone and system audio
- Ripple cuts (trim and remove regions)
- Custom-rendered cursor with smoothing and click ripples
- Export to H.264 MP4

Explicitly out of scope, deliberately:

- Window-following capture (Windows.Graphics.Capture)
- Speed ramps / silence-based time compression
- Automatic silence detection
- Multi-monitor, HDR, and displays other than the one above
- GIF or WebM export
- Any form of packaging, updating, or distribution

## 4. Architecture

Two halves separated by one contract: a **recording bundle** on disk.

```
  ┌──────────── capture (main process) ─────────────┐
  │  ffmpeg ddagrab ──> screen.mp4                  │
  │  uiohook-napi   ──> input.jsonl                 │      ┌─────────────┐
  │  (hidden renderer)                              │ ───> │   bundle/   │
  │    getUserMedia mic      ──> mic.webm           │      └──────┬──────┘
  │    desktopCapturer loop  ──> system.webm        │             │
  │    getUserMedia webcam   ──> webcam.webm        │             │
  └─────────────────────────────────────────────────┘             │
                                                                  v
  ┌──────────── editor (renderer process) ──────────────────────────────┐
  │  zoom planner (pure TS)  ──> keyframes                              │
  │  project model (cuts, style, overrides)  ──> project.json           │
  │  WebGL2 renderer  <── preview driver (WebCodecs decode)             │
  │                   <── export driver (frame-stepped) ──> ffmpeg pipe │
  └─────────────────────────────────────────────────────────────────────┘
```

The editor never speaks to the capture layer. It reads a directory. A bundle can
be hand-written for tests, and window-following capture could be added later
without changing anything downstream.

The renderer is used identically by preview and export. This is the single most
important structural rule in the document: what you see is what you get, by
construction rather than by discipline.

## 5. Recording bundle format

Location: `%LOCALAPPDATA%\zoomcast\recordings\<id>\` where `<id>` is
`YYYY-MM-DDTHH-mm-ss`.

```
2026-09-03T14-40-12/
  manifest.json
  screen.mp4      H.264 (h264_amf), 1920x1080, 60fps, GOP 30, no cursor,
                  fragmented (+frag_keyframe+empty_moov)
  mic.webm        Opus
  system.webm     Opus
  webcam.webm     VP8/VP9 + Opus
  input.jsonl     one JSON object per line
  project.json    created on first edit, not by capture
```

### manifest.json

```jsonc
{
  "version": 1,
  "id": "2026-09-03T14-40-12",
  "createdAt": "2026-09-03T14:40:12.331Z",
  "clockBaseUnixMs": 1772806812331,   // t=0 for every timestamp in the bundle
  "status": "clean",                   // "clean" | "unclean"
  "durationMs": 184320,
  "display": {
    "adapter": "AMD Radeon(TM) Graphics",
    "outputIdx": 0, "width": 1920, "height": 1080,
    "refreshHz": 144, "scale": 1.0
  },
  "video": {
    "file": "screen.mp4", "codec": "h264", "encoder": "h264_amf",
    "width": 1920, "height": 1080, "fps": 60, "gop": 30,
    "drawMouse": false, "startOffsetMs": 0
  },
  "audio": [
    { "role": "mic",    "file": "mic.webm",    "codec": "opus", "startOffsetMs": 142, "device": "..." },
    { "role": "system", "file": "system.webm", "codec": "opus", "startOffsetMs": 138 }
  ],
  "webcam": { "file": "webcam.webm", "width": 1280, "height": 720, "fps": 30, "startOffsetMs": 155 },
  "telemetry": { "file": "input.jsonl", "hasCursorShapes": false }
}
```

`startOffsetMs` is milliseconds after `clockBaseUnixMs` at which that stream's
first sample was produced. The screen track is the reference and is normalised
to 0; every other offset is relative to it. See section 11.

### input.jsonl

One object per line, `t` in ms since `clockBaseUnixMs`. Move events are
throttled to 60Hz; everything else is recorded as it arrives.

```jsonc
{"t":1234,"k":"move","x":812,"y":455}
{"t":1250,"k":"down","x":812,"y":455,"b":1}
{"t":1310,"k":"up","x":812,"y":455,"b":1}
{"t":1600,"k":"key","d":"down","c":"KeyA"}
{"t":1750,"k":"wheel","x":800,"y":400,"dy":-120}
{"t":2000,"k":"cursor","shape":"ibeam"}    // phase 9 only
```

Coordinates are in source-display pixels. Keystrokes carry **no coordinates** —
this is a hard limitation of `uiohook-napi` and it drives the planner design in
section 7.

## 6. Modules

Each module has one job, a stated interface, and stated dependencies.

### `capture/` — main process

Orchestrates a recording session and writes a bundle. Depends on ffmpeg,
`uiohook-napi`, and a hidden renderer window for the Chromium-side streams.

- `EncoderProbe` — on first run, tries `h264_amf`, then `h264_nvenc`, then
  `libx264`, and persists the winner in settings.
- `ScreenSource` — spawns and supervises ffmpeg; parses the progress pipe to
  learn the true first-frame wall-clock time.
- `TelemetryRecorder` — `uiohook-napi` hooks appending to `input.jsonl`,
  buffered and flushed every 250ms.
- `MediaSources` (hidden renderer) — `getUserMedia` for mic and webcam,
  `desktopCapturer` with `chromeMediaSource: 'desktop'` for system-audio
  loopback; three `MediaRecorder` instances writing to disk.
- `SessionController` — start/stop, countdown, manifest assembly.

### `zoom/` — pure TypeScript, zero I/O

`planZoom(events, config, sourceSize, outputSize) => ZoomKeyframe[]`

No video, no canvas, no filesystem, fully deterministic. This is the entire
value proposition of the product expressed as a pure function, which is exactly
why it is testable and tunable. Detailed in section 7.

### `project/` — the edit document

Owns `project.json` and the source-time ↔ output-time mapping. Detailed in
section 9. Undo/redo is immutable snapshots of the project object, capped at 100
entries; the document is small enough that nothing cleverer is warranted.

### `render/` — WebGL2

`Renderer.drawFrame(state: FrameState): void`. Stateless with respect to time.
Detailed in section 10.

### `playback/` — preview driver

Demuxes `screen.mp4` with `mp4box.js`, decodes with WebCodecs `VideoDecoder`,
maintains a small frame cache, drives `Renderer` at display rate. Audio plays
through WebAudio.

### `export/` — export driver

Frame-steps the same `Renderer` and pipes results to ffmpeg. Detailed in
section 12.

### `ui/` — React

Two windows: recorder (tray-driven, source selection, countdown, overlay) and
editor (preview canvas, timeline, inspector panels).

## 7. Zoom planner

### Constraint that shapes everything

Keystrokes arrive without coordinates. Typing tells us **when** attention is
concentrated but never **where**. The planner therefore anchors position on
clicks and cursor position, and uses keystrokes only as a signal to *hold* an
existing zoom.

### Algorithm

1. **Resample.** Build a uniform 60Hz cursor track from move events, holding
   last-known position across gaps.
2. **Score.** Emit weighted attention impulses: click 1.0 at the click point,
   wheel 0.3 at the cursor, keystroke 0.4 at the most recent click position
   (falling back to cursor position if no click within `keyAnchorWindowMs`).
3. **Cluster.** Slide a `clusterWindowMs` window; impulses within
   `clusterRadiusPx` of each other merge into one cluster with a start, end,
   bounding box and total weight. Clustering — rather than reacting to
   individual events — is what stops three nearby clicks from becoming three
   separate camera moves.
4. **Filter.** Drop clusters below `minWeight`. Merge clusters separated by less
   than `minGapMs`.
5. **Guard.** Enforce, in order:
   - `minHoldMs` (default 1500) — no zoom may be replaced sooner than this
   - `deadzonePx` (default 120) — a new cluster whose centre lies within the
     deadzone of the current one extends it instead of creating a new move
   - `maxZoomsPerMinute` (default 8) — excess clusters are dropped
     lowest-weight-first

   Nearly all "seasick" auto-zoom is caused by transition *count*, not by bad
   anchor points. These three guards are the feature.
6. **Scale.** Fit each cluster's bounds plus `marginPx` into the frame, then
   clamp to `[1.0, maxComfortableZoom]` (section 8).
7. **Emit.** For each surviving cluster, an in-keyframe at
   `clusterStart - leadInMs`, a hold, and an out-keyframe at
   `clusterEnd + trailMs` returning to 1.0. Default easing
   `cubic-bezier(0.33, 0, 0.1, 1)`, `transitionMs` 600.

### Configuration

Every knob referenced above, with its default. This object is stored per project
so old recordings can be re-planned against new values.

```ts
type ZoomConfig = {
  keyAnchorWindowMs: number;   // 4000  — how stale a click may be and still anchor typing
  clusterWindowMs: number;     // 2000  — sliding window for grouping impulses
  clusterRadiusPx: number;     // 250   — spatial merge radius, source pixels
  minWeight: number;           // 0.8   — clusters below this are discarded
  minGapMs: number;            // 700   — clusters closer than this merge
  minHoldMs: number;           // 1500  — a zoom may not be replaced sooner
  deadzonePx: number;          // 120   — nearby cluster extends rather than re-zooms
  maxZoomsPerMinute: number;   // 8      — excess dropped lowest-weight-first
  marginPx: number;            // 80    — padding around cluster bounds when fitting
  leadInMs: number;            // 250   — start the move before the cluster begins
  trailMs: number;             // 400   — hold after the cluster ends
  transitionMs: number;        // 600
  easing: EasingName;          // "cubic-bezier(0.33, 0, 0.1, 1)"
};
```

These defaults are a starting point, not a result. Phase 3 exists largely to tune
them against real footage, which is why the golden-fixture harness and the config
panel ship together.

### Output

```ts
type ZoomKeyframe = {
  id: string;              // stable, derived from the anchoring event
  tSourceMs: number;
  scale: number;           // 1.0 = no zoom
  cx: number; cy: number;  // normalised 0..1 focus point in source space
  easing: EasingName;
  transitionMs: number;
  origin: "auto" | "manual";
  pinned: boolean;
};
```

### Re-planning

Keyframe ids are derived from the anchoring event, so they are stable across
runs. Editing a keyframe in the UI sets `pinned: true`. Re-planning regenerates
every keyframe where `origin === "auto" && !pinned` and leaves everything else
untouched.

This is what makes the tuning loop work: curve improvements apply retroactively
to old projects without destroying per-clip fixes. The planner does not need to
be correct — it needs to be close and correctable.

## 8. Zoom quality on a 1080p source

On this display, source pixels equal output pixels, so a naive 2x zoom is a 2x
upscale and looks soft. The design does not hardcode a limit; it derives one.

```
maxComfortableZoom = (sourceWidth / outputWidth) / paddingFactor
```

`paddingFactor` is the fraction of output width the styled frame gives to the
screen quad (default 0.85). On the current display that yields **1.18x of
genuinely free zoom** — the padding means the screen is already being displayed
below 1:1, so modest zoom costs nothing.

The timeline marks the point where a keyframe's scale crosses 1:1 so the
degradation is visible rather than discovered at export. The fragment shader
applies a mild unsharp pass when effective sample scale exceeds 1.0.

The upgrade path requires no code change: recording a 3840x2160 virtual display
(IddSampleDriver, Parsec VDD) at 200% scaling makes the same formula yield
2.35x. That is an opt-in workflow, not an app feature.

## 9. Timeline model

Ripple cuts only. Cuts are stored in **source time**, non-overlapping and
sorted; output time is derived.

```ts
type Cut = { startMs: number; endMs: number };

sourceToOutput(tSource: number): number | null;  // null when inside a cut
outputToSource(tOutput: number): number;         // total function
outputDurationMs(): number;
```

This is the module most likely to harbour off-by-one errors, so it is isolated,
pure, and property-tested (section 13). The mapping is monotonic and piecewise
with constant slope 1 — a deliberate choice, since speed ramps would make the
slope vary and force zoom keyframes to be remapped through it.

### project.json

```jsonc
{
  "version": 1,
  "bundleId": "2026-09-03T14-40-12",
  "cuts": [{ "startMs": 4200, "endMs": 7100 }],
  "zoom": { "config": { /* planner config */ }, "keyframes": [ /* ZoomKeyframe[] */ ] },
  "style": {
    "paddingFactor": 0.85, "cornerRadiusPx": 12,
    "shadow": { "blurPx": 48, "opacity": 0.35, "offsetYPx": 16 },
    "background": { "kind": "gradient", "from": "#1b1d23", "to": "#0d0e11", "angle": 135 }
  },
  "webcam": { "visible": true, "shape": "circle", "sizePct": 18,
              "position": "bottom-right", "marginPx": 32 },
  "audio": { "micGainDb": 0, "systemGainDb": -6, "syncNudgeMs": 0 },
  "output": { "width": 1920, "height": 1080, "fps": 60, "bitrateMbps": 12 }
}
```

## 10. Renderer

One WebGL2 renderer, called identically by preview and export.

```ts
type FrameState = {
  screen: TexSource;
  webcam?: TexSource;
  zoom: { scale: number; cx: number; cy: number };
  style: StyleConfig;
  cursor?: { x: number; y: number; shape: CursorShape; pressed: boolean; ripples: Ripple[] };
  outputSize: { w: number; h: number };
};
```

Passes, in order:

1. **Background** — gradient, solid or image, filling the output.
2. **Shadow** — soft rounded-rect shadow behind the screen quad.
3. **Screen quad** — zoom/pan transform, rounded corners via an SDF in the
   fragment shader, unsharp when effective scale exceeds 1.0.
4. **Webcam quad** — circle or rounded rect, positioned per project config.
5. **Cursor** — drawn from telemetry, position smoothed with a critically-damped
   spring, size compensated so apparent size stays constant under zoom, plus
   expanding click ripples.

The cursor is drawn rather than captured (`draw_mouse=0`) precisely so that
smoothing, scale compensation and ripples are possible. Phase 1 renders an arrow
only; phase 9 adds real shapes (section 14).

## 11. A/V sync

Two independent clocks: ffmpeg's and Chromium's. MediaRecorder startup jitter is
the unpredictable part.

- Both are stamped against `clockBaseUnixMs`, captured once at session start.
- `ScreenSource` records wall-clock at ffmpeg's first-frame progress event.
- Each Chromium track records wall-clock at its first emitted sample.
- Offsets are normalised so the screen track is 0 and written to the manifest.

Every stream's offset is therefore **how much later than the screen it started**.
Converting a source time to a position within a given stream is:

```
streamLocalMs = tSourceMs - stream.startOffsetMs + syncNudgeMs
```

So with `mic.startOffsetMs = 142`, source time 5000ms is 4858ms into `mic.webm`.
The sign is stated here explicitly because getting it backwards produces a
plausible-looking export with audio drifting the wrong way — a bug that is easy
to ship and slow to diagnose. The export driver has exactly one helper for this
conversion and no stream may seek without it.

Expected accuracy is roughly 20ms, which is inaudible for narration. A
`syncNudgeMs` slider (+/-200ms) in the editor is the escape hatch for the tail
cases, stored per project.

## 12. Export pipeline

Rendering is ours; encoding and muxing are ffmpeg's — ffmpeg is already a
dependency, and it handles AAC, mixing and muxing better than hand-rolled
WebCodecs plumbing would.

1. `frameCount = ceil(outputDurationMs / 1000 * fps)`
2. For each output frame `n`:
   - `tOut = n / fps * 1000`; `tSrc = outputToSource(tOut)`
   - decode the screen frame at `tSrc`; decode webcam at `tSrc + webcamOffset`
   - interpolate zoom state at `tSrc`
   - `renderer.drawFrame(state)`, then `gl.readPixels` into an RGBA buffer
   - write to ffmpeg stdin, honouring backpressure (`write()` returning false →
     await `drain`)
3. ffmpeg, roughly:

```
ffmpeg -f rawvideo -pix_fmt rgba -s 1920x1080 -r 60 -i pipe:0 \
       -i mic.webm -i system.webm \
       -filter_complex "<per-input atrim/concat from cuts>;<gains>;amix=inputs=2" \
       -c:v h264_amf -b:v 12M -c:a aac -b:a 192k out.mp4
```

Audio cuts are expressed as an `atrim`/`concat` chain built from the same `Cut[]`
that drives the video mapping, so the two cannot drift.

A debug export mode writes a PNG sequence instead, for inspecting individual
frames when something looks wrong.

## 13. Error handling

| Failure | Behaviour |
| --- | --- |
| ffmpeg dies mid-recording | Fragmented MP4 remains playable; manifest written with `status: "unclean"`; editor opens it normally |
| `h264_amf` unavailable | Probe falls back to `h264_nvenc`, then `libx264`; result persisted |
| `uiohook-napi` fails to hook | Recording proceeds; bundle marks telemetry absent; zoom is manual-only for that recording |
| System-audio loopback unavailable | Recording proceeds without `system.webm`; manifest omits the track |
| Webcam device busy | Recording proceeds without webcam; manifest omits the track |
| Export fails | Partial output deleted; the underlying ffmpeg stderr surfaced verbatim, not summarised |
| Disk below 5GB free | Recording refuses to start with the free-space figure |
| ffmpeg missing, too old, or lacking `ddagrab` | Recording refuses to start, naming the resolved binary path and what it lacks |

Capture degrades rather than aborts. A recording missing its webcam is far
better than a recording that did not happen.

## 14. Testing

Scoped to a personal tool: cover the places where bugs are invisible until they
ruin an export, and manually verify everything else.

- **Zoom planner** — golden-fixture tests. Checked-in `input.jsonl` fixtures with
  expected keyframe output. Fast, deterministic, and the harness doubles as the
  tuning loop.
- **Timeline mapping** — property tests: monotonicity, round-trip identity
  outside cuts, `outputDuration` equals the sum of kept spans, and behaviour at
  cut boundaries.
- **Export** — one end-to-end test over a checked-in 5-second synthetic bundle,
  asserting output duration, frame count and audio stream length.
- Everything else — manual.

Not tested: renderer output. GPU snapshot tests are flaky across driver updates
and the failure mode (a visibly wrong frame) is one you notice immediately.

## 15. Build order

Each phase ends in something runnable. Phases 1–5 need no capture code at all,
which front-loads the interesting work and defers the platform-specific risk.

| # | Phase | Outcome |
| --- | --- | --- |
| 0 | Scaffold | Electron + Vite + TypeScript, main/preload/renderer split, ffmpeg discovery, encoder probe |
| 1 | Bundle format + fixture generator | Synthesise a valid bundle from a test pattern and generated telemetry; unblocks everything below without capture |
| 2 | Renderer + preview | mp4box + WebCodecs decode, WebGL2 renderer, styled frame, scrubbing over a fixture bundle |
| 3 | Zoom planner | Pure module, golden tests, config panel, live re-plan |
| 4 | Timeline | Cuts, mapping module, property tests, editing UI |
| 5 | Export | ffmpeg pipe, audio filtergraph, e2e smoke test — **first real clip out of the tool** |
| 6 | Screen capture | ddagrab, telemetry, tray, global hotkey, countdown, excluded overlay |
| 7 | Audio | Mic + system loopback, offsets, nudge slider |
| 8 | Webcam PiP | Second capture stream, second decode path, placement UI |
| 9 | Polish | Cursor shapes via `koffi` + `GetCursorInfo`, ripple tuning, library view with sizes |

## 16. Dependencies

| Package | Purpose |
| --- | --- |
| `electron`, `vite`, `typescript`, `react` | Shell, build, UI |
| ffmpeg (system, 6.0+ required) | Capture encode and export encode/mux; `ddagrab` requires 6.0+ |
| `uiohook-napi` | Global mouse and keyboard hooks |
| `mp4box.js` | MP4 demuxing for WebCodecs |
| `koffi` | FFI to `user32!GetCursorInfo` (phase 9 only) |
| `vitest`, `fast-check` | Unit and property tests |
| `zod` | Manifest and project-file validation |

### ffmpeg resolution

ffmpeg is **not vendored**. The target machine already has ffmpeg 9.0.1
(winget, `Gyan.FFmpeg`) on PATH, verified to provide `ddagrab`, `h264_amf`,
`h264_nvenc` and `libx264`. Vendoring a ~100MB binary into a single-user repo
buys nothing.

Resolution order at startup: the `ffmpegPath` setting, then a PATH lookup. On
first run the app verifies the resolved binary reports `ddagrab` among its
filters, and refuses to record otherwise, naming the path it resolved.

## 17. Storage

Bundles live in `%LOCALAPPDATA%\zoomcast\recordings\` and are kept indefinitely.
At 1080p60 they run roughly 300MB per minute. A library view shows per-recording
and total size, with a one-click "delete source bundle" offered after a
successful export. Nothing is ever deleted automatically.

## 18. Deferred

Recorded so they are decisions rather than omissions:

- Window-following capture via Windows.Graphics.Capture — additive; the bundle
  format does not change
- Speed ramps — would make the timeline mapping piecewise-variable
- Automatic silence detection proposing cuts — generates candidates only, no
  model change; the cheapest of these to add later
- Multi-monitor and HDR capture
- Virtual 4K display workflow — a habit, not a feature
- Alternative export targets (GIF, WebM, 720p presets)

## 19. Decision log

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Windows-native repo and toolchain, no WSL | Electron + `uiohook-napi` + DXGI are Windows-only; WSL adds a bridge with no upside |
| 2 | Display capture only | Region becomes a free editor-side crop since we retain the full frame; window-following is the highest-risk, lowest-reliability feature |
| 3 | `h264_amf` on the iGPU | Capture and encode on the same adapter, so frames never leave the GPU; NVENC would need a cross-adapter round trip through system RAM for quality we re-encode away |
| 4 | GOP 30 (0.5s) | Worst-case seek decodes 30 frames (~10ms hardware); file size stays near long-GOP. All-intra would cost ~1GB/min for responsiveness we already have |
| 5 | Chromium-side audio and webcam | Electron's `desktopCapturer` does Windows loopback natively, removing a dependency on the barely-maintained virtual-audio-capturer DirectShow filter |
| 6 | Own-drawn cursor | Smoothing, scale compensation and click ripples are impossible once the cursor is baked into the pixels at 1x |
| 7 | Derived zoom ceiling | Encodes the 1080p limitation as a formula rather than a constant, so a higher-resolution source lifts the ceiling with no code change |
| 8 | Generated + pinned keyframes | Preserves the tuning loop: global curve improvements apply retroactively without destroying per-clip fixes |
| 9 | Ripple cuts only | Keeps the source↔output mapping monotonic with constant slope — the single highest-risk module stays trivially testable |
| 10 | Export via ffmpeg pipe | Avoids hand-rolling AAC, mixing and muxing for speed an offline export does not need |
