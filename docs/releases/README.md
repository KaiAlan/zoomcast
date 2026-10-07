# Installers and releases

## Download

Download `zoomcast-Setup-<version>.exe` from the [latest release](https://github.com/KaiAlan/zoomcast/releases/latest). The Windows x64 installer includes FFmpeg and ffprobe. Other assets support updates or provide corresponding media source; users do not need them to install.

## Updates

Version 0.1.2 and later check public GitHub releases without an account or access token. Versions 0.1.0 and 0.1.1 need one manual upgrade to 0.1.2. After that, use Update and Restart to update.

Updates download on request. Restart waits for recording and export to finish and saves open projects before silently installing and reopening the app.

## Build and validate

Use native Windows Node.js 24 and MSYS2 MINGW64. See [media build instructions](../../build/FFMPEG-SOURCES.md).

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run dist
npm run verify:release
npm run verify:packaged
npm run verify:project-save
npm run verify:feedback
```

Run installed upgrade and capture/export validation on Windows before shipping changes to those paths. The installer is currently unsigned.

The project-save guard checks deleted and empty zoom timelines, audio edits, Ctrl+S, disk failures, retry, and switching recordings through the native editor and real save IPC. The feedback guard checks the form and native IPC, report encoding, long-report fallback, keyboard behavior, and browser failure/retry. It captures browser launches and clipboard writes without submitting reports or changing the user's clipboard.

## Ship

1. Keep versions in 0.1.x until the maintainer approves a new minor version.
2. Update package.json and package-lock.json together, and add matching release notes here.
3. Push the matching v<version> tag after CI passes. The release workflow builds and validates a draft release.
4. Review the installer and publish the draft. Keep the installer, blockmap, latest.yml, matching media source archive, and source checksum together. Do not replace an installer after generating its metadata.

## Licenses

Zoomcast's own code uses the [MIT License](../../LICENSE). Retain [third-party notices](../../THIRD_PARTY_NOTICES.md) and matching GPL media sources with each release. Keep corresponding-source archives available for older distributed versions.
