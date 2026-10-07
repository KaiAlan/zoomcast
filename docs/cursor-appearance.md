# Cursor and appearance expansion

Implemented on `feat/cursor-appearance`, based on Zoomcast 0.1.3. The saved-timeline and feedback changes from that release are included.

## Cursor

The Cursor panel includes Classic, Rounded, Filled, Dot, and Outline styles; Show Cursor; Loop Cursor; size; motion blur; click bounce; bounce speed; sway; and Reset cursor. Smoothing, shadow, and click ripples remain available. The reference settings are supported: 2.50× size, 0.40× blur, 3.50× bounce, 350 ms bounce duration, and 0.20× sway.

Effects use the same stateless sampling in preview and export. Loop Cursor returns to the first kept source position at the last exported frame. Cuts suppress motion smearing and bounce from removed clicks. New effects default to zero for existing projects. Reset supports undo and redo.

Rounded, Dot, and Outline keep the selected glyph even when the recorded pointer changes to a hand or text cursor. Classic and Filled retain the recorded contextual shapes. Older recordings hold their first known cursor position through any missing opening coordinates; new captures explicitly record the starting position when it is inside the capture area. Recordings with no position data show an explanation in the Cursor panel.

## Appearance

There are 24 locally bundled 3840 × 2160 image backgrounds, with smaller gallery thumbnails, and 24 procedural gradient presets. Image backgrounds are copied into the recording folder when selected, keeping the project portable and available offline. Custom image uploads remain available.

The image sources and photographer credits are recorded in [background credits](../src/renderer/public/backgrounds/CREDITS.md) and [the source manifest](../tools/background-sources.json). Existing gradient names remain compatible with saved projects.

## Windows verification — 2026-10-07

- TypeScript checks, lint with warnings treated as errors, and the production build passed.
- All 691 unit tests in 72 files passed in the follow-up verification.
- The native Electron UI verification passed 78 checks, including five visibly different cursor styles updating the paused preview without a forced render, reference settings persistence, undoable reset, 24 decoded thumbnails, and portable image selection.
- Preview/export parity passed all 100 comparisons across 20 configurations, including the five cursor styles with effects, looping with cuts, a bright gradient, and a bundled image. The lowest sampled PSNR was 30.1 dB against the 28 dB requirement.
- The Windows package contains all 24 full images, all 24 thumbnails, and the credits. Every packaged image matched its source bytes. The actual executable decoded the gallery and copied and saved the selected preset successfully.
- Follow-up verification on a copy of a 91-second recording passed 68 normal UI checks: all cursor styles, visibility, size, reset/undo, bounce and speed, blur, sway, smoothing, looping, all 24 images, all 24 gradients, color, and padding. These checks observe automatic redraws instead of forcing frames after edits.
- The affected cursor and image export configurations passed another 40 preview/export comparisons. The rebuilt Windows executable passed nine capture checks across two recordings.

Paused redraws now retain the latest edit when a frame is already loading. The background texture cache retains at most three images to keep repeated 4K gallery browsing bounded, and pending image loads cannot upload into a disposed renderer.

The corrected local preview executable is `C:\dev\zoomcast\tmp\cursor-appearance-fixed-build\win-unpacked\zoomcast.exe`. This build does not publish or replace the installed release.
