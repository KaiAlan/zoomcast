# Context-aware automatic camera

Automatic zoom follows the size of the relevant control as well as cursor activity. Windows UI Automation supplies local bounds and control roles for native applications, browsers and Electron apps. The selector prefers whole toolbars, menus, fields, dropdowns, lists, trees, grids, tables, headers and useful panels/groups over their tiny buttons or labels. Wide controls pull the zoom back; small controls allow a closer view. Focused fields stay framed during typing even when the mouse moves away. Output padding, aspect ratio and edge controls are handled through the actual rendered viewport geometry.

The optional reader runs in a separate, hidden Windows PowerShell process using built-in Windows assemblies. It warms while capture initializes, has a bounded request queue and a provider timeout, and stops with the take. A broken or inaccessible provider leaves screen/audio capture running with ordinary telemetry. Only roles and rectangles are stored: no accessible names, field values, page text or screenshots are sent to a service. There are no new dependencies, bundled models or downloads.

Custom canvases, games, inaccessible apps and poorly labelled web components may expose no useful control bounds. These use a wider click-based frame, with extra room around the interaction. This is a fallback rather than visual understanding of every pixel. Existing recordings cannot gain control metadata retroactively, but their automatic shots benefit from click-led timing and improved framing. User-claimed/fixed camera shots retain their chosen depth and timing.

Pointer telemetry samples up to 120 Hz, retains the trailing movement in each interval and never throttles click events. Automatic shots begin at the actual click. Hovering, scrolling and keyboard input alone cannot start a shot; typing can extend a shot that began with a click. Whole-control bounds determine the depth at an interaction, which stays steady between interactions. Actual rapid click bursts and drags reserve a wider composition for the shot rather than repeatedly zooming out and back in. Transitions interpolate the drawn camera rectangle over the full configured duration, avoiding jumps caused by scale-dependent edge clamps. In apps without control bounds, cursor escapes move the camera through a safe area using damping that carries velocity and limits speed. Following brakes before recovery; semantic controls stay framed during typing. The drawn cursor lands at the click location even when smoothing is enabled. Camera and cursor paths remain deterministic for seeking, preview and export. Gentle motion blur defaults on for new takes and strengthens with speed; slow movement stays sharp. Existing saved blur settings, including zero, are preserved. Motion blur remains adjustable in Appearance and Cursor settings.

Automatic transitions use a symmetric curve for gentle departure and arrival. Entrance, exit and pan duration controls still apply. The curve selector applies to fixed or manually claimed shots; legacy lead-in and scroll-depth values remain loadable but are hidden from the inspector.

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
$env:ZOOMCAST_PARITY_CONFIGS = 'default,click-pacing,semantic-fast,square,cursor-loop-cut,follow'
npx tsx tools/verify-parity.ts
```

The pacing fixture checks frames before the click, during entrance, fast cursor following and recovery. The semantic fixture changes from a message field to a wide toolbar and rapid opposite-corner clicks, then back to typing. Evidence is written under `tmp/semantic-zoom-validation` and `tmp/parity`.

The pacing regression fixture at `tests/fixtures/zoom-motion/input.jsonl` retains only timestamps and pointer geometry from the local test take. Key codes are replaced with `KeyA`; cursor images, video, accessible text and app content are excluded. It reproduces the scroll-only shot and the previous 296.94-pixel camera jump in a single 60 Hz frame. Unit checks bound camera travel and depth changes, verify constant depth during hover, smooth following and braking, click-only shot creation, and regeneration after aspect changes.

The pacing fix passed typecheck, lint, production build, all 844 tests and 30 focused preview/export comparisons. On the test take, peak camera travel fell from 296.94 to 37.40 pixels per 60 Hz frame, and peak scale change fell from 0.4676 to 0.03353. These checks verify timing, bounded motion and renderer agreement; they do not substitute for a user judging the camera feel.

Changes are kept local. No release, push or installed-app update is performed.
