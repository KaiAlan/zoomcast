# Handoff — capture is on the gdigrab fallback, and it caps everything

> **RESOLVED 2026-09-08, later the same day.** Capture runs on ddagrab at
> 55.42fps against the 32.59fps baseline below. The hypothesis in "The single
> hypothesis worth testing first" was correct; the adapter sweep that framed it
> was not. **Read the correction before trusting any table on this page.**
>
> ## The correction
>
> The adapter table below has the two GPUs **swapped**. `dx:0` is not the AMD.
> Running the same probe with `-loglevel verbose` says so in one line:
>
> ```
> [D3D11VA] Selecting d3d11va adapter 0
> [D3D11VA] Using device 10de:25a2 (NVIDIA GeForce RTX 3050 Laptop GPU).
> ```
>
> That single line is what the sweep was missing, and it inverts the reading.
> It is not that "there is exactly one output and Desktop Duplication refuses
> it". It is that the NVIDIA driver had rewritten DXGI enumeration for the
> process: with no GPU preference set Windows hands ffmpeg the discrete GPU,
> Optimus presents the panel's output on it, and the AMD that actually
> composites the desktop reports **no outputs at all**. Duplication then fails
> because the desktop is not on the adapter holding the output.
>
> Measured three ways, deterministically:
>
> | pin on ffmpeg.exe | `dx:0` resolves to | ddagrab |
> | --- | --- | --- |
> | absent | NVIDIA `10de:25a2` | FAIL |
> | `GpuPreference=2` | NVIDIA `10de:25a2` | FAIL |
> | `GpuPreference=1` | AMD `1002:1636` | **OK** |
>
> `GpuPreference=2` behaving identically to no pin is the useful half of that:
> "high performance" is not the opposite of the fix, it is the same as doing
> nothing. Only power saving moves the process.
>
> Corroboration was already on the machine — Loom's recorder ships
> `GpuPreference=1` in the same registry key.
>
> ## Two more bugs were behind it
>
> Neither was reachable while the probe returned gdigrab, so the ddagrab path
> had in fact never run:
>
> 1. `-pix_fmt yuv420p` was in `buildCaptureArgs`'s shared encode block, so it
>    applied to ddagrab too and inserted an `auto_scale` that D3D11 frames
>    cannot pass through.
> 2. **`scale_d3d11` does not work on this AMD iGPU** — `Could not create the
>    texture (80070057)`, E_INVALIDARG, allocating its NV12 texture array. Nor
>    will `h264_amf` take BGRA D3D11 surfaces directly; it errors on the first
>    frame. The chain is now `ddagrab,hwdownload,format=bgra,format=nv12`,
>    measured at 58.3fps against the 58fps ddagrab reaches with no encoder at
>    all — the download is free because the capturing GPU is the integrated one.
>
> `format=nv12` is load-bearing beyond speed: without it ffmpeg picks
> `yuvj420p` and writes full range, which would disagree with the gdigrab
> path's limited-range `yuv420p`.
>
> ## What shipped
>
> - `duplicationSweep.ts` — sweeps adapters and outputs, stops on the "no such
>   adapter"/"no such output" wordings rather than probing a fixed grid, and
>   keeps every refusal for the log.
> - `gpuPreference.ts` — writes `GpuPreference=1` for the resolved ffmpeg path,
>   **only after a sweep has already failed**, then sweeps once more. A machine
>   where Desktop Duplication works never has its registry touched.
> - `probeCapture(log)` replaces `probeBackend(adapterIndex)`. It returns the
>   adapter AND output that worked, and it logs — the `catch { return
>   "gdigrab" }` that hid all of the above is gone.
> - `npm run verify:capture` — drives the real probe and the real
>   `ScreenSource`, and fails on a fallback or on a rate below 50fps.
>
> One consequence worth noting: `scale_d3d11` was the documented reason not to
> bundle ffmpeg-static, because the essentials builds lack it. Every filter in
> the new chain is core. That does not mean bundling should be retried — it
> means the filter list is no longer the thing standing in the way.
>
> Everything below is the original handoff, kept because the measurements are
> real and the reasoning is worth seeing next to its correction.

---

**Written 2026-09-08.** Branch `main`, clean, all gates green.
**State:** 383 tests / 43 files, typecheck silent, `verify:decode` 6/6 k=0,
`verify:parity` 30/30, `tune -- all` unchanged from the session baseline.

## The ask

Recording asks for 60fps and gets ~32. `probeBackend(0)` returns **`gdigrab`**,
not `ddagrab`, so every take on this machine has been captured through the
CPU-bound GDI path. That is the single biggest quality lever left: 60fps
capture improves the export, the camera read, and the preview at once.

**This was not caused by anything in the 2026-09-08 session.** It predates it.
It was found while verifying an unrelated ffmpeg change.

## What is measured, and what it rules out

Run from PowerShell. Every command below was run on 2026-09-08.

**ffmpeg is not the problem.** PATH carries gyan.dev 9.0.1 **full**, which has
both filters capture needs:

```powershell
ffmpeg -hide_banner -filters | Select-String 'ddagrab|scale_d3d11'
```

**The machine is hybrid graphics**, and that matters:

```
NVIDIA GeForce RTX 3050 Laptop GPU   no resolution reported  -> headless
AMD Radeon(TM) Graphics              1920 wide               -> drives the display
```

**Adapter sweep** — `-init_hw_device d3d11va=dx:N`, `ddagrab=output_idx=0`:

| adapter | result |
| --- | --- |
| `dx:0` | **"Selected output not supported"** — AMD, drives the display |
| `dx:1` | "Failed to enumerate DXGI output 0" — the headless NVIDIA, expected |
| `dx:2` | "Failed to create Direct3D device (887a0004)" — no such adapter |

**Output sweep on the display adapter** — `dx:0`, `output_idx=N`:

| output_idx | result |
| --- | --- |
| `0` | **"Selected output not supported"** |
| `1`, `2`, `3` | "Failed to enumerate DXGI output N" — they do not exist |

So: **there is exactly one output, ddagrab finds it, and Desktop Duplication
refuses it.** The adapter initialises cleanly first — the verbose log shows
`Using provided hw_device_ctx` before the failure.

That rules out, with evidence:

- a missing or wrong ffmpeg build (both filters present)
- a wrong adapter index (only dx:0 has an output at all)
- a wrong output index (only output 0 exists)
- the probe being malformed (the full capture chain, with `scale_d3d11` and
  `h264_amf`, fails identically — it is not an artifact of the short probe)

## The single hypothesis worth testing first

`"Selected output not supported"` is ddagrab reporting `DXGI_ERROR_UNSUPPORTED`
from `IDXGIOutput1::DuplicateOutput`. On a hybrid-graphics laptop the usual
cause is that **the process is not running on the GPU that owns the output**:
Windows hands ffmpeg the discrete NVIDIA by default, and Desktop Duplication on
the AMD-owned display then refuses.

Test it by pinning ffmpeg to the integrated GPU:

> Settings → System → Display → Graphics → Add desktop app → ffmpeg.exe →
> Options → **Power saving** (integrated), then re-run the dx:0 probe.

If that flips dx:0 to exit 0, the fix in the app is to make the same choice for
the ffmpeg it spawns, not to ask the user to configure Windows. Two ways, in
order of preference:

1. Set the adapter preference on the spawned process. `ScreenSource.start`
   already builds the environment; `DXGI_ADAPTER` / driver-specific env vars
   are worth checking before anything heavier.
2. Fall back to enumerating adapters and picking the one whose output actually
   duplicates, rather than hardcoding `output_idx=0` and adapter 0.

## Other causes to check, if that one fails

- **RDP or a remote session.** DDA is unsupported over RDP. Confirm the run is
  on the physical console.
- **Protected content path.** A window using hardware DRM can disable DDA
  session-wide. Close browsers playing DRM video and retry.
- **A stale duplication handle.** Only one process may duplicate an output at a
  time; another capture tool holding it produces exactly this error. Check for
  OBS, Discord, GeForce Experience, Xbox Game Bar.

## What to change in the code, once it works

`src/main/capture/ScreenSource.ts`:

- `probeBackend(adapterIndex)` hardcodes `output_idx=0` and is called with a
  single adapter. It should sweep adapters and outputs and return the pair that
  worked, not just a backend name.
- `buildCaptureArgs` takes `opts.adapterIndex` but likewise hardcodes
  `output_idx=0`.
- The probe swallows the error entirely (`catch { return "gdigrab" }`). It
  should log the stderr through `logDiag`, or the next person also has to
  rediscover all of the above by hand.

**Guard it.** `capture:rate` already logs `backend=` and the achieved fps
(`logDiag`), so a regression from ddagrab back to gdigrab is visible in
`%APPDATA%\zoomcast\main-error.log` without new instrumentation.

## Do not assume this is fixed until

`npm run tune -- <new take>` shows a take captured at ~60fps, and the log line
reads `capture:rate: backend=ddagrab requested=60 achieved=<~60>`. The current
baseline to beat, from a real 47s take on 2026-09-08:

```
capture:rate: backend=gdigrab requested=60 achieved=32.59 size=1920x1080
```

## Two smaller items, unrelated and independent

> **Both resolved 2026-09-08.** The judder item's diagnosis was wrong in the
> same way the adapter table was: measured as per-frame acceleration, the
> camera was 30x rougher than the path it follows (rms 18.2 vs 0.59, max
> 321.6px in one frame) — a teleport, not a 10Hz kink. Two keyframe-timing
> bugs, both fixed; `FOLLOW_SAMPLE_MS` stays at 100 and the trade-off table
> lives in its comment. The zigzag item was right that it is a planning change:
> `dropDoubleBacks` in segments.ts, gated on rest time and on the waypoint
> being visible from both neighbours.


- **Follow-camera judder.** `FOLLOW_SAMPLE_MS = 100` with `easing: "linear"`
  means the follow path updates at 10Hz with a velocity kink at every sample.
  No take currently plans a follow segment (the planner only emits `fixed`), so
  it has never been seen — but switching a shot to follow in the inspector will
  show it. Precompute on a finer grid, or ease between samples.
- **Mid-hold waypoint zigzag.** The camera pans between waypoints inside one
  shot and can double back: measured `cx 0.319 -> 0.608 -> 0.449` on
  2026-09-07T17-22-48, a 555px move right then 305px back left, and a 14.5px
  direction reversal on 2026-09-08T14-53-54. It is the planner following
  activity, working as designed, but it reads as quirky. Fixing it is a
  planning change — merge or order waypoints that double back — not a
  smoothing one.
