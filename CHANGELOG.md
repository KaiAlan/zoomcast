# Changelog

Detailed changes for each Zoomcast release. The app shows the Highlights from these same notes.

## Unreleased

Changes prepared for the next version; these are not part of the published 0.1.3 installer.

### Highlights

- Customize cursor styles, size and motion effects, with consistent preview and export.
- Choose from 24 photo backgrounds and 24 gradients.
- Split, reorder and delete video clips, and split zoom segments at the playhead.
- Use working zoom controls, timeline scroll shortcuts and looping playback.
- See automatic update notifications and a short summary after installing a new version.

### Added

- Classic, rounded, filled, dot and outline cursor styles, with size, motion blur, bounce, duration and sway controls. Outline has a black fill and white border.
- A collection of 24 high-resolution photo backgrounds with source attribution, and 24 gradient presets.
- A base video track. Select a video clip or zoom, position the playhead, and split with the scissors button or Ctrl+B. Delete selected pieces, drag video pieces to reorder, or use Alt+Left/Right. Undo and redo include these edits.
- Ctrl+scroll zooms the timeline around the pointer. Shift+scroll pans horizontally. Add segment inserts a zoom at the playhead.
- A checked release-note pipeline: detailed changes on GitHub and in CHANGELOG.md, short Highlights in the app after an installed version changes, and full release-note links in Settings and update notices.
- Automatic update checks on startup, hourly while running, and after waking from sleep. A Windows notification announces a new version once; clicking it opens App updates. Downloads and restarts remain user actions.

### Fixed

- Cursor styles and effects now update paused previews and exported video consistently, including the start of a recording.
- The zoom segment popup anchors to the selected segment and closes on an outside click. Repeated zoom preset clicks, Fixed/Follow cursor and Reset to auto work reliably.
- Splitting or reordering clips preserves source-linked zooms and keeps exported video and audio in the same order.
- Timeline scaling leaves the helper text fixed. Short zoom segments have valid transitions, the aspect dropdown updates the preview, and playback returns to the beginning at the end.

## [Zoomcast 0.1.3](https://github.com/KaiAlan/zoomcast/releases/tag/v0.1.3)

Windows x64 beta.

### Highlights

- Project saves preserve your zoom edits, including deleted zooms.
- Save with Ctrl+S and see progress or useful error feedback.
- Send bug reports and feature requests from the workspace or Settings.

### Fixed

- Save Project now preserves deleted automatic zoom shots and intentionally empty zoom timelines when reopening a recording.
- Opening another recording starts its own editor state, so edits from the previous recording cannot be saved into it.
- Saves replace the project file only after writing succeeds, show progress and useful error feedback, and support Ctrl+S.

### Added

- Send feedback is available from the workspace and Settings. Prepare a bug report, feature request, or general feedback, then review and submit it on GitHub. Reports include your text and app/Windows versions; long reports use a clipboard fallback.

### Upgrade notes

Version 0.1.2 can receive this release through the in-app Update button. Versions 0.1.0 and 0.1.1 need one manual installation of the latest version.

The installer includes FFmpeg and ffprobe. Matching media sources and their checksum accompany this release. The Windows installer remains unsigned.

## [Zoomcast 0.1.2](https://github.com/KaiAlan/zoomcast/releases/tag/v0.1.2)

Windows x64 beta.

### Highlights

- Get in-app updates from public GitHub releases without an account or token.
- Restart to update after your projects are saved and recording or export finishes.

### Changed

- In-app updates now use public GitHub releases. No GitHub account, access token, or update setup is needed.
- Removed the update access form and its credential API. Saved tokens from older builds are deleted on startup.
- Updates still download on request. Restart waits for recording and export to finish, saves open projects, installs silently, and reopens Zoomcast.

### Upgrade notes

If you use 0.1.0 or 0.1.1, install `zoomcast-Setup-0.1.2.exe` once manually. Future updates work without a token.

The installer includes FFmpeg and ffprobe. The matching media source archive and checksum accompany this release. The Windows installer remains unsigned.

## [Zoomcast 0.1.1](https://github.com/KaiAlan/zoomcast/releases/tag/v0.1.1)

Windows x64 beta.

### Highlights

- Faster exports and smoother automatic zooms with continuous cursor tracking.
- In-app updates show download progress and save projects before restarting.
- The installer includes FFmpeg and ffprobe, with matching media sources.

### Improved

- Faster export: the controlled one-minute 1080p60 benchmark improved from a median 136.9 seconds to 85.3 seconds, about 38% less time. Actual speed depends on the computer and encoder.
- Smoother automatic zooms, continuous cursor tracking and a slower first entrance.
- Private in-app updates: check on launch, download progress, and restart to update. Restart waits for recording/export work to finish, saves open projects, installs silently and reopens the app.
- Installer includes FFmpeg and ffprobe built from pinned sources; users do not need separate media tools. The matching source archive and build information accompany the release.

### Upgrade notes

Install the Windows setup executable. The 0.1.1 updater was built for private distribution and requires an access token configured under Settings → App updates. Public installer downloads do not require a token. Prefer a repository-restricted fine-grained token with Contents: read-only; collaborator accounts may require a classic repo-scoped token. Version 0.1.0 has no updater; install 0.1.1 manually once to receive later updates.

The installer is unsigned and may show Windows trust warnings. This beta has passed local installed upgrade/restart/data-preservation/uninstall checks under an isolated app identity, media-source integrity checks, native capture/export checks and all 664 automated tests. The real published GitHub feed and a recipient account should be checked after release publication. See the release README for exact validation scope.

