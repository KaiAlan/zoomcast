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
- Backgrounds, rounded corners, shadows, and cursor effects.
- MP4 export with hardware encoding when supported.

## Use

Press **Ctrl+Alt+Z** to start or stop recording. The editor opens after recording. Press **Space** to play or pause, edit the timeline, and choose **Export**.

Zoomcast runs in the system tray. Closing the editor keeps the recording hotkey available. Quit from the tray menu. Recordings are stored locally in `%LOCALAPPDATA%\zoomcast\recordings`.

## Updates

Installed version 0.1.1 checks for newer releases on startup and shows **Update**, followed by **Restart to update**. The current build requires GitHub access configured under **Settings → App updates**. Public updates without a token are being prepared. Version 0.1.0 requires one manual upgrade.

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
