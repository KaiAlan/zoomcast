# Handoff — phase A, the cursor pipeline

Read `HANDOVER.md` first for the project as a whole. This file covers only
phase A and what is mid-flight. It replaces the earlier draft of the same name.

Spec: `docs/specs/2026-09-04-composition-and-camera-design.md`
Plan: `docs/superpowers/plans/2026-09-04-phase-a-cursor.md`
Ledger: `.superpowers/sdd/2026-09-04-phase-a-cursor/progress.md`

**The ledger is the recovery map.** It names every commit and every ruling with
its cost if wrong. Trust it and `git log` over anything remembered.

## Where things stand

```
main                 65944bb  packaging: installer, icon, autostart
                     dba4fa0  planner: segment guards + real-footage tuning
feat/cursor-pipeline 1200940  <- branch head, 9 of 10 tasks done, 1 fix round open
```

Test suite: **166 passing** (136 at the start of phase A). Typecheck silent.
`verify:decode` 6/6. `verify:parity` 5/5. Working tree clean apart from this
file.

| Task | State |
| --- | --- |
| 1 koffi probe | complete — `fb5384b` |
| 2 shape tracker | complete — `e8ee73b` |
| 3 capture wiring | complete — in `0a0f401` |
| 4 vector shapes | complete — `fb0501e` + `0a0f401` |
| 5 cursor path | complete — `acac228` + `da079e6` |
| 6 cursor config | complete — `b9ca700` |
| 7 render pass | complete — `3786849` + fix `1708467` |
| 8 click ripples | complete — `d53fe6e` + fix `b22b112` |
| **9 inspector controls** | **committed `1200940`, review failed — 3 fixes open** |
| 10 handover update | not started — it rewrites `HANDOVER.md`, so it comes after the fix round and the final review |

## Start here: Task 9's open fix round

The review found three Important issues, all plan-mandated (they trace to the
brief's own snippets, not to implementer error). All three are one-liners in
two files. This is roughly a ten-minute round — the diagnosis is already done,
so do not re-derive it.

**1. The paused preview never updates when a cursor control changes.**
`src/renderer/ui/Editor.tsx:391-393` — `onCursorChange` writes into
`project.style.cursor` via `setProject` but never forces a redraw. Its sibling
`onConfigChange` (`Editor.tsx:237-249`) ends with
`playerRef.current?.seek(playerRef.current.playheadMs)`. `PreviewPlayer.draw()`
runs only on `play()` / `seek()` / `toggle()`, and nothing watches `project`,
so toggling visible/shadow/ripples or dragging size/smoothing does nothing
visible until the user scrubs or hits play. Add the same `seek` call.

**2. The `sizePct` floor is decorative.** `src/renderer/ui/Inspector.tsx:81-92`
— the field declares `min={10}`, but the `onChange` guard only rejects
`Number.isNaN(value) || value <= 0`. Browsers do not enforce `min` on typed
input, only on the spinner, so 1-9 reach the project. Make the guard
`value < 10` so the attribute and the logic agree.

**3. The new labels break the panel's idiom.**
`src/renderer/ui/Inspector.tsx:72,81,97,113,122` — the five `<span>` labels omit
the `style={{ fontSize: 13, opacity: 0.8 }}` that every `FIELDS` row label
carries (`Inspector.tsx:53`), so the cursor section renders larger and brighter
than the zoom fields directly above it. The section header at
`Inspector.tsx:69` has the same problem against the "zoom planner" header
(`fontSize: 13, opacity: 0.55`). Apply the existing styles.

After the fix round: one scoped re-review, then the final whole-branch review
(most capable model, `git merge-base main HEAD`..HEAD), then Task 10, then
`superpowers:finishing-a-development-branch`.

## What phase A actually built

`drawMouse` stays `false` — v1 decision #6, because a cursor baked into the
pixels cannot be smoothed, resized, or kept sharp under zoom. Everything below
exists to draw it back on top, better.

- `src/main/capture/CursorShapeReader.ts` polls `user32!GetCursorInfo` at 30Hz
  via koffi and writes shape events into the telemetry stream.
- `src/shared/cursor/shapeTracker.ts` maps handle to shape, suppressing repeats.
- `src/shared/cursor/shapes.ts` holds eight vector shapes, drawn not extracted.
- `src/shared/cursor/path.ts` precomputes the smoothed position path.
- `src/shared/cursor/ripples.ts` returns the active click ripples at a time.
- `src/renderer/gl/cursorTexture.ts` rasterises a shape per (shape, size) and
  caches the texture.
- `src/renderer/gl/Renderer.ts` draws ripples, then the cursor, over the screen.
- `src/renderer/ui/Inspector.tsx` exposes all five `CursorStyle` controls.

## Things that will bite you

Each cost real time in this phase; none is hypothetical.

**The cursor must not scale with the zoom.** Position maps through the screen
quad so the cursor tracks the camera, but size derives from output height
alone. A cursor that grows as the camera pushes in reads as a bug.

**Textures are re-rasterised per (shape, size), never scaled from one bitmap.**
That is the entire reason the shapes are vectors, and it is what keeps the
cursor sharp under zoom and at 4K export.

**The rasterised size and the on-screen geometry must come from one value.**
`CursorTextureCache.get` returns `{ texture, px }` where `px` is the clamped,
rounded size it actually drew; `Renderer.drawCursor` derives the quad and the
hotspot offset from that `px` and the exported `PAD`. An earlier version
clamped in the cache and computed geometry from the raw request, which puts the
hotspot off the click point at any non-default size. Verified correct at
`sizePct: 250` by pixel measurement — source (960,540) maps to (522.5, 365.7)
and the glyph lands within 2px.

**Preview and export are two separate `drawFrame` call sites.** Every feature
must be wired into `src/renderer/media/exportClip.ts` as well as
`src/renderer/ui/Editor.tsx`, and both must sample on the **source** timeline
(`tSource` from `outputToSource`; `frame.tSourceMs` in export) or a project
with cuts desyncs. This caught both Task 7 and Task 8 — the plan wired only the
preview both times.

**`verify:parity` only guards what it samples.** `tools/verify-parity.ts`
`SHOTS` is now `[0, 1000, 1900, 2500, 4600]`; 1900 was added because the
original four never landed inside a ripple window, so ripples were passing the
guard without ever being rendered. **When you add a time-windowed visual
feature, add a sample time that lands inside its window** — otherwise a
preview-only or export-only regression passes silently.

**A green suite proves almost nothing about this phase.** A cursor drawn in the
wrong corner, upside-down, mis-scaled or clipped passes every automated check.
Take the `ZOOMCAST_UI_SHOT` and actually open the PNG.

**koffi gotchas** (unchanged, still true):

- **`koffi.inout(koffi.pointer(CURSORINFO))`, never `koffi.out(...)`.** `out()`
  never marshals `cbSize` *into* the call, so `GetCursorInfo` fails with
  `ERROR_INVALID_PARAMETER` on every call — silently. The shape stream just
  stays empty.
- **Allocate the `info` literal fresh inside the poll closure.** koffi zeroes
  `cbSize` when decoding, so a reused object fails from the second poll on.
- **`koffi.address()` returns `bigint`** in koffi 3.2.1. Handles are small
  (65539-65567), so `Number(...)` is lossless.
- Confirmed handles: arrow 65539, ibeam 65541, wait 65543, nwse 65549,
  nesw 65551, ew 65553, ns 65555, hand 65567.

## Verification for this phase

```powershell
cd C:\dev\zoomcast
npm test              # 166
npm run typecheck     # silent
npm run build
npm run verify:decode # 6/6
npm run verify:parity # 5/5, now including the ripple sample

# cursor at a non-default size, from a bundle's own project.json
$env:ZOOMCAST_UI_SHOT = 'C:\dev\zoomcast\tmp\task9-cursor-shot\basic'
$env:ZOOMCAST_UI_SHOT_SEEK = '3700'
$env:ZOOMCAST_UI_SHOT_OUT = 'C:\dev\zoomcast\tmp\ui\cursor.png'
npx electron .
```

`tmp/task9-cursor-shot/basic` is a scratch copy of `tests/fixtures/basic` with a
`project.json` carrying `style.cursor.sizePct: 250`. It is gitignored scratch —
recreate it the same way if it is gone.

## Still owed to a human

One check no subagent could perform, deferred deliberately:

**Open the app and drive the cursor controls by hand.** Change size and
smoothing on a real recording, confirm the preview updates live, and confirm
the values survive closing and reopening the take. The headless substitute
proved a persisted `sizePct` is read and applied, but not that editing is live
— and finding 1 above says it currently is *not*, on a paused preview. Re-check
this after that fix lands.

## Deferred minors — triage before merge

- Task 2: no test for a hidden-to-hidden repeat.
- Task 3: plan text assumed two manifest-write sites; there is only one.
- Task 4: `path`/`hotspot` doc comments restate structure rather than reasoning.
- Task 4: the `wait` glyph reads as a broken ring rather than an hourglass.
- Task 5: no test for `cursorAt` past the last grid sample.
- Task 5: `!("x" in first)` is dead at runtime, kept for TS narrowing, unsaid.
- Task 8: the `e.k !== "down"` guard inside `ripplesAt` is now dead weight, both
  callers pre-filter. Kept so the ruling could freeze `ripplesAt`'s body.
- Task 9: the "cursor" section header style, as above.
- **Judgement call, not a defect:** ripples anchor to the raw click coordinate
  while the cursor is smoothed, so the two can visibly separate during a fast
  move. Invisible on real telemetry, obvious on the fixture, which teleports the
  pointer. Decide whether the ripple should follow the smoothed path instead.

## After phase A

Only phase A has an implementation plan. **B is independent of A and can be
planned immediately.** C-F depend on decisions that only exist once A and B are
built.

| Phase | Deliverable |
| --- | --- |
| B | Background presets, blur, custom image, frame border, aspect/resolution — and the `style` UI that has never existed |
| C | Persisted zoom segments, follow-cursor camera, retuned transitions, preview performance |
| D | Directional motion blur |
| E | Draggable zoom segments, segment/global popover, real cut regions, undo/redo |
| F | Clip speed — reverses v1 decision #9; abandoning it is an acceptable outcome |

**Phase B is smaller than it looks.** `drawFrame` already runs
`drawBackground -> drawShadow -> drawScreen`, so a linear-gradient background,
rounded-rect shadow and corner radius all exist today. Task 9 just built the
first `style` UI section, which is the pattern B extends.

The three complaints that started this work map to: no cursor (phase A, now
built), background options (phase B), snappy/laggy zooms (phase C).
