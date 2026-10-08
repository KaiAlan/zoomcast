# Context-aware automatic camera

Automatic zoom follows the size of the relevant control as well as cursor activity. Windows UI Automation supplies local bounds and control roles for native applications, browsers and Electron apps. The selector prefers whole toolbars, menus, fields, dropdowns, lists, trees, grids, tables, headers and useful panels/groups over their tiny buttons or labels. Wide controls pull the zoom back; small controls allow a closer view. Focused fields stay framed during typing even when the mouse moves away. Output padding, aspect ratio and edge controls are handled through the actual rendered viewport geometry.

The optional reader runs in a separate, hidden Windows PowerShell process using built-in Windows assemblies. It warms while capture initializes, has a bounded request queue and a provider timeout, and stops with the take. A broken or inaccessible provider leaves screen/audio capture running with ordinary telemetry. Only roles and rectangles are stored: no accessible names, field values, page text or screenshots are sent to a service. There are no new dependencies, bundled models or downloads.

Custom canvases, games, inaccessible apps and poorly labelled web components may expose no useful control bounds. These use a wider activity-based frame, with extra room for typing and scrolling. This is a fallback rather than visual understanding of every pixel. Existing recordings cannot gain control metadata retroactively, but their automatic shots benefit from movement lookahead and improved framing. User-claimed/fixed camera shots retain their chosen depth and timing.

Pointer telemetry samples up to 120 Hz, retains the trailing movement in each interval and never throttles click events. Automatic camera samples include exact interaction times and anticipate upcoming activity; rapid movement can widen the view instead of leaving the camera behind. The drawn cursor lands at the click location even when smoothing is enabled. Camera and cursor paths remain deterministic for seeking, preview and export. Gentle motion blur defaults on for new takes and strengthens with speed; slow movement stays sharp. Existing saved blur settings, including zero, are preserved. Motion blur remains adjustable in Appearance and Cursor settings.

## Validation

Run with Windows Node/Electron from `C:\dev\zoomcast`:

```
npm run typecheck
npm run lint
npm test
npm run build
npx electron tools/verify-semantic-zoom.cjs
```

The native check uses an isolated Chromium window/profile, a native Windows Forms fixture and actual Windows accessibility queries. It verifies whole toolbar/menu/group/field/dropdown bounds, legacy native controls, password-field privacy, capture-relative coordinates, real telemetry integration and worker shutdown. Unit checks cover context selection, malformed/old telemetry, fast clicks, focused typing, complete-control visibility in native/square/portrait/ultrawide outputs, manual shot ownership and cursor click alignment.

Focused preview/export validation:

```powershell
$env:ZOOMCAST_PARITY_CONFIGS = 'default,semantic-fast,square,cursor-loop-cut,follow'
npx tsx tools/verify-parity.ts
```

The semantic fixture changes from a message field to a wide toolbar and rapid opposite-corner clicks, then back to typing. Evidence is written under `tmp/semantic-zoom-validation` and `tmp/parity`.

Local validation completed: typecheck, lint, production build, the full unit/end-to-end suite, 17 native semantic checks, 30 audio-device regression checks, and 25 preview/export comparisons. No release, push or installed-app update is performed.
