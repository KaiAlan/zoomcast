# Unreleased

Changes prepared in the 0.1.5 candidate; these are not part of the published 0.1.4 installer.

## Highlights

- Customize cursor styles, size and motion effects, with consistent preview and export.
- Choose from 24 photo backgrounds and 24 gradients.
- Split, reorder and delete video clips, and split zoom segments at the playhead.
- Generate editable offline transcripts, export subtitles and include captions in MP4s.
- See an in-app update notice when opening Zoomcast and a short summary after updating.

## Added

- Optional offline caption support downloads about 64 MB only when requested. Generate from microphone or system audio, edit text and timing, and export SRT/VTT or MP4 captions. Saved captions follow cuts, reordered clips and audio sync. Removing speech support retains saved captions.
- Classic, rounded, filled, dot and outline cursor styles, with size, motion blur, bounce, duration and sway controls. Outline has a black fill and white border.
- A collection of 24 high-resolution photo backgrounds with source attribution, and 24 gradient presets.
- A base video track. Select a video clip or zoom, position the playhead, and split with the scissors button or Ctrl+B. Delete selected pieces, drag video pieces to reorder, or use Alt+Left/Right. Undo and redo include these edits.
- Ctrl+scroll zooms the timeline around the pointer. Shift+scroll pans horizontally. Add segment inserts a zoom at the playhead.
- A checked release-note pipeline: detailed changes on GitHub and in CHANGELOG.md, short Highlights in the app after an installed version changes, and full release-note links in Settings and update notices.
- One automatic update check when opening Zoomcast. An available version appears in an in-app notice, with no Windows notification, hourly polling or wake-up checks. Downloads and restarts remain user actions.

## Fixed

- Cursor styles and effects now update paused previews and exported video consistently, including the start of a recording.
- The zoom segment popup anchors to the selected segment and closes on an outside click. Repeated zoom preset clicks, Fixed/Follow cursor and Reset to auto work reliably.
- Splitting or reordering clips preserves source-linked zooms and keeps exported video and audio in the same order.
- Timeline scaling leaves the helper text fixed. Short zoom segments have valid transitions, the aspect dropdown updates the preview, and playback returns to the beginning at the end.
