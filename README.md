# Zoomcast

A Windows screen recorder and editor with automatic cursor-aware zoom.
Record your screen, edit the camera movement and cuts, add a background, and export an MP4.

## Install

Open the [latest release](https://github.com/KaiAlan/zoomcast/releases/latest), expand **Assets**, and download **zoomcast-Setup-<version>.exe**. Run the installer. It includes FFmpeg and ffprobe; no separate media installation is required.

Requires Windows 10 or 11, x64. The current beta installer is unsigned. Download the installer from GitHub Releases.

## Features

- Screen, microphone, system audio, and optional webcam recording.
- Automatic zooms from cursor and keyboard activity.
- Editable zoom segments, cuts, undo, and redo.
- 24 bundled 4K backgrounds, 24 gradients, rounded corners, and shadows.
- Five cursor styles with size, motion blur, click bounce, sway, and looping controls.
- MP4 export with hardware encoding when supported.

## Use

Press **Ctrl+Alt+Z** to start or stop recording. The editor opens after recording. Press **Space** to play or pause, edit the timeline, and choose **Export**.

Zoomcast runs in the system tray. Closing the editor keeps the recording hotkey available. Quit from the tray menu. Recordings are stored locally in `%LOCALAPPDATA%\zoomcast\recordings`.

Choose **Save project** or press **Ctrl+S** to keep your edits with the recording. Reopening preserves your timeline, including deleted zoom shots.

Choose **Cursor** in the editor toolbar to customize the cursor. **Loop Cursor** returns it to its first kept position near the end of the edited clip. **Reset cursor** restores the defaults and supports undo. Choose **Appearance → Image** or **Gradient** for the background galleries; image presets are copied into the recording folder so projects remain portable.

Choose **Send feedback** in the workspace or Settings to prepare a bug report, feature request, or general feedback. Review and submit it on GitHub; reports are public and require GitHub sign-in. Long reports are copied for you to paste into the description.

## Updates

Installed version 0.1.2 and later check for newer releases on startup and shows **Update**, followed by **Restart to update**. Public-update builds need no GitHub account or access token. Older builds that ask for update access need one manual upgrade from [GitHub Releases](https://github.com/KaiAlan/zoomcast/releases).

## Develop

Use native Windows Node.js 24 and npm:

```powershell
git clone https://github.com/KaiAlan/zoomcast.git
cd zoomcast
npm ci
npm run dev
```

Development recording needs a compatible FFmpeg on PATH or `ZOOMCAST_FFMPEG`. To build the bundled media tools and installer, follow [the media build instructions](build/FFMPEG-SOURCES.md) and run `npm run dist`.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Preview and export share the same renderer. Run `npm run verify:parity` when changing composition or camera behavior. See [release and validation instructions](docs/releases/README.md).

## Licensing

Zoomcast's own code is licensed under the [MIT License](LICENSE). Third-party components retain their original licenses. The FFmpeg build includes x264 and is GPL-2.0-or-later; matching media sources and notices accompany each release. See [media licensing and source details](build/FFMPEG-SOURCES.md).

Versions remain in the **0.1.x** beta series until the maintainer approves a new minor version.
