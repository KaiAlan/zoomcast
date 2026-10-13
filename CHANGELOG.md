# Changelog

Detailed changes for each Zoomcast release. The app shows the Highlights from these same notes.

## [Zoomcast 0.1.7](https://github.com/KaiAlan/zoomcast/releases/tag/v0.1.7)

Windows x64 beta release.

### Highlights

- Choose your microphone and test microphone input or a live camera preview before recording.
- See microphone levels and capture warnings while recording, with optional microphone processing controls.
- Start recordings with a large centered countdown, quiet ticks and a distinct start chime.
- New recordings use a portable copy of your current desktop wallpaper, with a bundled image fallback.
- Choose from 24 solid background colors and drag the timeline without selecting its labels.

### Added

- Settings → Recording includes microphone selection, microphone and camera tests, and shortcuts to Windows privacy settings. Opening Settings does not request device access. Camera tests show a muted live preview; microphone tests record up to 15 seconds and provide level monitoring and temporary sample playback. Samples stay local, are excluded from the recording library, and are cleared when leaving the section. Device tests are unavailable during recording.
- Select microphone and camera devices in the recorder's three-dot menu. Choices persist and synchronize with Settings. A disconnected selected microphone produces a warning instead of silently switching inputs. Noise suppression, echo cancellation and automatic microphone volume are optional and default off; device support varies.
- The recording widget shows microphone input level and status. Visible warnings identify failed capture, lost or muted audio tracks, write failures and an unresponsive audio recorder. After 15 seconds without detected microphone sound, a separate advisory asks you to check the mute switch; sound clears it. System audio failures also appear in the widget.
- A large countdown is centered on the recorded display, with a quiet tick each second and a distinct chime after capture starts. It cancels immediately, stays out of the recorded video and respects No delay / 3 / 5 / 10 second choices.
- New recordings copy the currently applied Windows desktop wallpaper into their recording folder. Later wallpaper changes do not alter earlier projects. Appearance opens with the Image tab first; desktops without a usable image use the bundled Ribbons background.
- Solid background presets now include 24 colors across neutrals, pastels, richer colors and dark shades, alongside the custom color picker, photo backgrounds and gradients.

### Fixed

- Audio chunks are written in order and acknowledged before finalizing audio files. Only tracks with saved bytes appear in the recording manifest.
- Cancelling a device test, changing its device or preferences, leaving its Settings section, or closing Settings releases the test devices, including delayed permission responses.
- Dragging the playhead or timeline segments no longer selects time labels or clip text.

### Upgrade notes

Install the Windows setup executable, or open Settings → App updates → Check for updates in your current installation. Download and restart when ready. Existing projects, settings and downloaded caption support are retained.

Automatic zoom and camera following use the same behavior as published 0.1.6. The experimental camera rework tested during development is excluded from this release.

Microphone and camera access depends on Windows permissions and device availability. Device tests help check input before recording; review capture warnings during a take. New microphone processing options default off and do not enable themselves during an upgrade.

The installer includes FFmpeg and ffprobe. Matching media sources and their checksum accompany the release. The beta installer is unsigned.

## [Zoomcast 0.1.6](https://github.com/KaiAlan/zoomcast/releases/tag/v0.1.6)

Windows x64 beta release.

### Highlights

- Choose custom background colors with a Figma-style picker, precise values and a screen eyedropper.
- Generate editable offline transcripts and export subtitles or captioned MP4s.
- Customize cursor styles and choose from 24 photo backgrounds and 24 gradients.
- Split, reorder and delete video clips, with reliable zoom editing and looping playback.
- Find settings in searchable sections, with release highlights kept out of the editor.

### Added

- Settings has searchable sections for General, Recording, Captions, App updates, and Help & feedback. Controls save automatically, with retry when a save fails. The window fits the desktop and supports smaller sizes and both themes.
- A custom background color picker replaces the Windows color dialog. Adjust saturation and brightness in a color area, drag the hue slider, enter HEX/RGB/HSB values, sample the screen, and reuse recent colors. Preview updates while dragging; Undo restores the whole gesture. Keyboard arrows adjust the color area, and Escape closes the picker. Colors persist in projects.
- Open Captions in the editor, download caption support once, and generate a transcript from microphone audio, system audio, or both. The optional Windows CPU engine and multilingual speech model download about 64 MB outside the installer. Recognition runs locally with no audio upload.
- Correct caption text and timing, search transcript segments, seek to their video position, and change font, size, position, color and background. Projects retain the transcript and appearance; Undo restores a replaced or edited transcript.
- Export SRT and WebVTT subtitles, or include visible captions in exported MP4s. Subtitle and video captions follow cuts, reordered or repeated clips, and the audio sync offset.
- Cancel speech downloads or transcription, verify downloaded files, and remove speech support in Settings to reclaim storage. Removal keeps saved captions and exported files; app upgrades retain downloaded speech support.
- Classic, rounded, filled, dot and outline cursor styles, with size, motion blur, bounce, duration and sway controls. Choose from 24 high-resolution photo backgrounds with source attribution and 24 gradients.
- Split video clips or zoom segments at the playhead with the scissors button or Ctrl+B. Delete selected pieces, drag clips to reorder, or use Alt+Left/Right. Ctrl+scroll zooms the timeline; Shift+scroll pans it. Undo and redo retain these edits.
- Reviewed release notes supply detailed GitHub notes and short Highlights in Settings. The editor no longer displays the installed version's What's new card, preserving preview and timeline space. A single automatic update check runs after opening the app; available releases appear quietly in the app. Downloads and restart remain user actions.

### Fixed

- Cursor changes redraw paused previews and remain consistent in exports. Zoom popups, repeated presets, Fixed/Follow cursor, Reset to auto and short zoom transitions work reliably.
- Splitting or reordering clips preserves source-linked zooms and exports audio in the same order. Aspect changes update the preview, and playback loops to the beginning at the end.
- Includes the published 0.1.4 recording-shortcut fix.
- Updating waits for active caption tasks alongside recording and export before restarting.

### Upgrade notes

Install the Windows setup executable, or open Settings → App updates → Check for updates in your current installation. Download and restart when you are ready. Existing projects and settings are retained.

Caption support is optional and downloads only when requested. No API key or subscription is needed. Recognition accuracy depends on speech, language and recording quality. Review text and captions around cuts through a sentence; subtitles split at cuts rather than infer word timings. Regenerating replaces the transcript, and Undo restores it.

The installer includes FFmpeg and ffprobe. Matching media sources and their checksum accompany the build. Speech engine and model licenses are retained with the optional download.

For native Windows validation, run typecheck, lint, tests and build. Run npm run verify:captions to use an isolated profile and a synthetic spoken recording to check real downloads, offline recognition, edits, Ctrl+S, visibility, reopen, subtitles, reordered MP4 export, audio and removal. Run npm run verify:caption-package to repeat the checks in a separate packaged app with bundled FFmpeg and no development overrides. Run npm run verify:parity to compare captioned preview/export frames across reordered clips. Test evidence stays outside the installer.

## [Zoomcast 0.1.5](https://github.com/KaiAlan/zoomcast/releases/tag/v0.1.5)

Windows x64 beta candidate.

### Highlights

- Generate editable transcripts and captions offline, without an API key or subscription.
- Export SRT/VTT subtitles and MP4 captions that follow your cuts and clip order.
- Customize cursor styles and choose from 24 photo backgrounds and 24 gradients.
- Split, reorder and delete video clips, with reliable zoom editing and looping playback.
- See a quiet in-app update notice on startup and a short summary after updating.

### Added

- Open Captions in the editor, download caption support once, and generate a transcript from microphone audio, system audio, or both. The optional Windows CPU engine and multilingual speech model download about 64 MB outside the installer. Recognition runs locally with no audio upload.
- Correct caption text and timing, search transcript segments, seek to their video position, and change font, size, position, color and background. Projects retain the transcript and appearance; Undo restores a replaced or edited transcript.
- Export SRT and WebVTT subtitles, or include visible captions in exported MP4s. Subtitle and video captions follow cuts, reordered or repeated clips, and the audio sync offset.
- Cancel speech downloads or transcription, verify downloaded files, and remove speech support in Settings to reclaim storage. Removal keeps saved captions and exported files; app upgrades retain downloaded speech support.
- Classic, rounded, filled, dot and outline cursor styles, with size, motion blur, bounce, duration and sway controls. Choose from 24 high-resolution photo backgrounds with source attribution and 24 gradients.
- Split video clips or zoom segments at the playhead with the scissors button or Ctrl+B. Delete selected pieces, drag clips to reorder, or use Alt+Left/Right. Ctrl+scroll zooms the timeline; Shift+scroll pans it. Undo and redo retain these edits.
- Reviewed release notes supply detailed GitHub notes and short in-app Highlights. A single automatic update check runs after opening the app; available releases appear quietly in the app. Downloads and restart remain user actions.

### Fixed

- Cursor changes redraw paused previews and remain consistent in exports. Zoom popups, repeated presets, Fixed/Follow cursor, Reset to auto and short zoom transitions work reliably.
- Splitting or reordering clips preserves source-linked zooms and exports audio in the same order. Aspect changes update the preview, and playback loops to the beginning at the end.
- Includes the published 0.1.4 recording-shortcut fix.
- Updating waits for active caption tasks alongside recording and export before restarting.

### Upgrade notes

Install the Windows setup executable. Published stable releases are discoverable through the app's Update button; this candidate has not been published.

Caption support is optional and downloads only when requested. No API key or subscription is needed. Recognition accuracy depends on speech, language and recording quality. Review text and captions around cuts through a sentence; subtitles split at cuts rather than infer word timings. Regenerating replaces the transcript, and Undo restores it.

The installer includes FFmpeg and ffprobe. Matching media sources and their checksum accompany the build. Speech engine and model licenses are retained with the optional download.

For native Windows validation, run typecheck, lint, tests and build. Run npm run verify:captions to use an isolated profile and a synthetic spoken recording to check real downloads, offline recognition, edits, Ctrl+S, visibility, reopen, subtitles, reordered MP4 export, audio and removal. Run npm run verify:caption-package to repeat the checks in a separate packaged app with bundled FFmpeg and no development overrides. Run npm run verify:parity to compare captioned preview/export frames across reordered clips. Test evidence stays outside the installer.

## [Zoomcast 0.1.4](https://github.com/KaiAlan/zoomcast/releases/tag/v0.1.4)

Windows x64 beta.

### Highlights

- Open recording controls with Ctrl+Alt+R even after fully quitting Zoomcast.
- Use a consistent recording shortcut and optional Start with Windows.

### Added

- Ctrl+Alt+R opens recording controls even when Zoomcast has been fully quit. The installer automatically creates a Windows-owned **zoomcast Recorder** Start menu shortcut for fresh installations and upgrades. Opening it while Zoomcast runs brings the existing recorder forward.
- Recording shortcuts stay consistent instead of silently moving to another key combination when occupied. Settings shows the actual shortcut, explains availability, and offers **Start with Windows** for faster access at sign-in. Startup remains optional.
- Development and unpacked builds report Ctrl+Alt+R conflicts and continue to support recording from the tray.

### Upgrade notes

If another application owns Ctrl+Alt+R, release those keys there. The launcher shortcut remains available from the Start menu. Existing installations receive it when upgrading to 0.1.4; installing 0.1.3 does not add it.

Versions 0.1.2 and 0.1.3 can receive this release through the in-app Update button. Versions 0.1.0 and 0.1.1 need one manual installation of the latest version.

The installer includes FFmpeg and ffprobe. Matching media sources and their checksum accompany this release. The Windows installer remains unsigned.

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

