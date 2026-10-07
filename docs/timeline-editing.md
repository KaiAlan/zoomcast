# Timeline editing — local preview

The timeline has two visible tracks: zoom segments and base video clips. Old ripple cuts appear as the surviving video clips. Select a region, place the playhead with the ruler, and use the scissors button or Ctrl+B to split it. With no selection, splitting operates on the base video at the playhead. Splits remove no footage; Delete removes the selected piece. Drag base clips to reorder them, or use Alt+Left/Right while a clip has keyboard focus. Each operation supports undo/redo and Save project.

Zooms remain associated with source footage. Splitting a base clip divides crossing zooms at that boundary; deleting a base clip removes its attached zoom pieces; reordering moves their visible output positions with the clip. Each zoom piece can be selected, split again, resized, moved, reset, or deleted independently. Add segment inserts a three-second zoom at the actual playhead, bounded by the host clip and next zoom. If the playhead is inside a zoom, only the part covered by the new zoom is replaced.

Ctrl+wheel changes timeline scale around the pointer. Shift+wheel pans horizontally. Ruler and tracks share the scrollable region; helper text and transport readouts stay outside it. The popup measures the selected segment's real DOM position and stays inside the window, above the timeline toolbar. One click outside closes the popup while preserving selection for toolbar actions. Preview aspect is a working select control. Playback repeats from zero when the last remaining clip ends, including when source EOF occurs earlier in a reordered sequence.

Project version 1 adds an optional `clips` list of `{ id, startMs, endMs }` source ranges in playback order. Its absence preserves the legacy `cuts` mapping. When present, the list is authoritative, including an empty list after deleting all footage. The editor, cursor effects, media clock, export frame plan, webcam sampling, and FFmpeg audio trims use the same mapping. Audio streams are aligned to the source clock, padded for late starts or early finishes, trimmed in clip order, and concatenated. Older builds cannot interpret clip ordering.

Segment-generated keyframes are rebuilt for every edit rather than retained merely because the source segment was pinned or manual. This fixes repeated depth edits, Fixed/Follow, and Reset to auto keeping obsolete keyframes. Legacy standalone pinned keyframes still reproject when no segment model exists. Short manual or split zooms shorten their transitions to fit their own bounds. Outline cursor has a black interior and white border.

Validation:

- `npm test`: clip mapping, migration, splits, delete/reorder, repeated zoom edits, short zooms, ordered media clock, native ended handling, replay, and actual FFmpeg output.
- The FFmpeg test checks decoded red/blue frame order, 880/440 Hz audio order, initial silence for a 200ms audio offset, duration and frame count using both libx264 and h264_amf.
- `npm run build` then `npm exec -- electron tools/verify-timeline.cjs`: native pointer, keyboard and wheel interactions; paused repaint without forced renders; save; undo/redo; reordering; playback; user export and FFprobe validation. Reports and screenshots are in `tmp/timeline-validation`.
- `npm run verify:ui`: existing inspector, cursor, appearance and project controls.
- `ZOOMCAST_PARITY_CONFIGS=reordered-clips,split-short-zooms` with `tsx tools/verify-parity.ts`: preview/export pixel comparisons at ten output times.

All application execution and verification must run natively on Windows from `C:\dev\zoomcast`.

Verified on 2026-10-08: 711 tests across 73 files; typecheck and lint; 41 native timeline checks; 78 existing native UI checks; ten preview/export matches (PSNR 41.3–43.9 dB). Local build: `C:\dev\zoomcast\tmp\timeline-editor-build\win-unpacked\zoomcast.exe`.
