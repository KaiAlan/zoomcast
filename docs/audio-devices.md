# Microphone and camera checks

Settings → Recording includes microphone and camera selection, permission shortcuts to Windows privacy settings, and device tests. Opening Settings does not open either device. Camera checks show a muted live preview. Microphone checks record up to 15 seconds, show input level and provide a temporary sample with playback controls. Nothing is uploaded or added to the recording library. Samples are cleared when leaving the section. Stopping, cancelling, changing device/preferences, leaving the section and closing Settings release test devices, including delayed permission responses. Tests are unavailable during a recording.

Microphone selection also appears in the recording widget's three-dot menu, alongside camera selection. Device choices persist and synchronize with Settings. A disconnected selected microphone produces a warning instead of silently using a different input. Noise suppression, echo cancellation and automatic microphone volume are optional and default off, preserving existing capture behavior. Tests and actual recordings use the same constraints; support depends on the device.

During capture, the widget shows microphone status and input level. Capture failures, lost or muted tracks, write errors and a stalled audio renderer show a red badge and visible alert. After 15 seconds without detected microphone sound, an amber advisory invites the user to check their mute switch; silence is distinct from failed capture. Sound clears the advisory. System audio failures also show a visible alert. Captured chunks are written in order and acknowledged before finalizing audio files. Only tracks with saved bytes appear in the manifest.

No dependencies, cloud service or bundled speech models are added. Existing projects and the installed app are unchanged. These changes are prepared locally, without a push or release.

## Validation

Run on Windows from `C:\dev\zoomcast`:

```
npm run typecheck
npm run lint
npm test -- --maxWorkers=4
npm run build
npm run verify:audio-devices
npm run verify:ui
```

`verify:audio-devices` uses an isolated profile and library, Chromium's fake camera and a generated PCM microphone input. It checks actual live camera frames, recorded sample playback, selected-device/processing constraints, non-silent decoded samples and real screen-recording microphone tracks, permission errors, cancellation, cleanup, device disconnection, missing devices, mute, silence recovery and the stalled-renderer watchdog. Hardware disconnection/mute signals are injected into real capture streams. Evidence is written to `tmp/audio-device-validation/validation.json`. Physical-device availability and OS permission configuration can vary between computers.
