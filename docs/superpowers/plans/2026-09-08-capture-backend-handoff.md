# Handoff — capture is on the gdigrab fallback, and it caps everything

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
