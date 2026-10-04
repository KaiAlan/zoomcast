# Export throughput investigation

**Latest optimization (2026-10-04):** three alternating native baseline/optimized pairs reduced median one-minute 1080p60 export time from **136.899s to 85.288s**: **37.7% less elapsed time / 1.61× throughput**. Every output retains all 3,600 frames and exactly 60 seconds. The comparison uses the same fixture, output settings and h264_amf encoder, with no competing validation/build work. This replaces the single-run estimate for the gain; the earlier 256.7s overloaded export is not the baseline.

Prepared in an isolated checkout from cf4031a. No camera/planner or zoom feature changes.

Run on native Windows with no competing tests, builds, captures or games:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
& node_modules\.bin\electron.cmd tools\bench-export.cjs
```

Inspect `tmp/export-throughput.json`, including `ok`; do not rely only on the PowerShell exit code. The benchmark uses a separate profile and a copied, repeated fixture. It does not start recordings or modify original projects. It validates 1920×1080, 3,600 frames and 60 seconds. Repeat the same run three times before and after an optimization and compare medians. Run `npm run verify:parity` and the native background-export lifecycle guard after any pipeline change.

The renderer report separates setup, screen/webcam decoding, draw submission, synchronous GL readback plus vertical flip, IPC plus encoder write, progress/preview callbacks, and finishing. GPU drawing is asynchronous: readback time may include waiting for earlier drawing. Progress timing measures synchronous callback work, not completion of the asynchronous progress IPC. Main-process write timing measures successful stdin write callbacks. The difference between renderer transfer/write time and main write time estimates IPC serialization, dispatch, reply and scheduling overhead; it is not a pure copy benchmark. Reports are emitted for completed exports only.

The historical 256.7-second run overlapped other work and is not a controlled baseline. Windows execution was restored on 2026-10-04. Validation ran in `C:\dev\zoomcast-export-speed-testing`, isolated from the other agent's active zoom changes. Native type checking, clean lint, production build and 595 tests across 59 files passed.

A successful native baseline exported 3,600 frames at 1920×1080 and retained exactly 60 seconds: 128.203 seconds including worker startup, 127.161 seconds in exportClip (28.31fps). Stage totals: setup 0.412s; decode 0.985s; draw submission 1.640s; readback/flip 49.103s; transfer/write 73.945s; synchronous progress work 0.980s; finishing 0.049s. Encoder write callbacks account for 16.987s; the remaining 56.958s estimates transport and scheduling overhead. 29,859,840,000 RGBA bytes crossed the pipeline. This establishes a baseline, not an optimization speedup or a three-run median.

An earlier 126.706-second run produced all frames but reported failure because the benchmark used an obsolete Electron console-event signature and missed renderer timings. The corrected listener uses the event object's message property and the full benchmark passes. The validated profiling changes were applied to the active Windows repository after checking for overlapping changes. Validation covers cf4031a plus these export changes; the other agent's ongoing zoom changes require separate integration checks.

Likely follow-ups depend on measured stage costs: bounded overlap of decoding/drawing with an outstanding encoder write (with separate owned buffers); transferable frame transport if serialization dominates; GPU readback changes if synchronization dominates. Preserve awaited buffer ownership, bounded memory, cancellation, exact frames, BT.709 conversion and preview/export parity. Do not change the shared camera code to improve throughput.

Native decode verification passed 6/6 exact-frame comparisons. Preview/export parity passed 60/60 comparisons, including webcam, styling, follow camera and cuts. Native editor UI passed 72 checks after stabilizing a pre-existing animated color assertion: the guard now waits for the primary button's CSS transition to finish before checking the final color. Two initial fixed-delay runs failed that assertion; a diagnostic run and the revised guard passed. No theme or camera product code changed.

The full native background-export lifecycle guard passed all 14 checks: concurrent recording and opening another take, immutable export duration/all 3,600 frames, successful Windows notification and completion UI, and cancellation without a success notification. Elapsed time was 139.049 seconds with the intentional recording overlap; use the separate 128.203-second run as the throughput baseline.

## What changed

Frames use a dedicated MessagePort between the page's main world and the main process, forwarded by preload once per session. Large arrays no longer pass through contextBridge. The browser snapshots the buffer before postMessage returns, so the renderer can reuse its readback buffer while the encoder consumes its own copy. Only one encoder write and one prepared next frame are allowed; acknowledgements follow stdin write completion. The final write is drained before finishing and 100% progress. Cancellation is checked again after waiting for a write and before finishing.

Export readback now leaves pixels in WebGL's bottom-up order. FFmpeg vflip handles orientation before the existing BT.709 conversion, avoiding JavaScript's second full-frame buffer and row copy. Renderer.readPixels keeps its top-down default for diagnostics. The inputBottomUp encoder option is optional, so existing rawvideo clients keep their original orientation.

Each channel belongs to the renderer that started the session. Duplicate connections, another renderer's requests and interleaved legacy IPC writes are rejected. Frame length/sequence, disconnects, serialization errors, encoder failures and timeouts are handled with session cleanup; FFmpeg's stderr remains in diagnostics. An attempted ArrayBuffer transfer yielded undefined data in MessagePortMain during native validation and was removed. This implementation uses snapshots, not zero-copy transfer.

## Paired measurements

| Run | Baseline (seconds) | Optimized (seconds) |
| --- | ---: | ---: |
| 1 | 144.898 | 85.288 |
| 2 | 133.198 | 85.283 |
| 3 | 136.899 | 91.045 |
| Median | 136.899 | 85.288 |

There is normal timing variation on the machine. Each optimized run is faster than its paired baseline. Median readback/flip stage time falls from 54.891s to 47.215s; median blocked transfer/write time falls from 77.519s to 39.663s. In the pipelined implementation, renderer transferAndWriteMs measures sending plus waiting not hidden by rendering. It cannot be subtracted from the total overlapping encoder-write time to estimate copy overhead; the benchmark emits null for that estimate when pipelined=true.

## Final verification

Native Windows type checking, clean lint, production build and **618 tests / 62 files** pass. Decode verification is **6/6**, pixel parity **60/60**, editor UI **72 checks**, and background-export lifecycle **14 checks**, including recording/opening another take, completion notification and cancellation. The new native channel guard passes **11 checks**, including owner isolation, duplicate/interleaved writes, actual frame finalization, malformed frames and a forced encoder failure retaining the real FFmpeg diagnostic.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:decode
npm run verify:parity
npm run verify:ui
& node_modules\.bin\electron.cmd tools\verify-background-export.cjs
& node_modules\.bin\electron.cmd tools\verify-export-channel.cjs
```

Validation uses the isolated export checkout from cf4031a. The zoom agent's concurrent changes need their own integration verification. Remaining performance targets are synchronous GPU readback and port serialization; no camera/planner behavior was changed to achieve this gain.
