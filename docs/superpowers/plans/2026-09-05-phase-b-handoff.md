# Handoff — phase B, the compositor

Read `HANDOVER.md` first for the project as a whole. This file covers only
phase B and what is mid-flight.

Spec: `docs/specs/2026-09-04-composition-and-camera-design.md`
Plan: `docs/superpowers/plans/2026-09-05-phase-b-compositor.md`

---

## Start here: the phase B re-review

**A whole-branch review of phase B was dispatched and its findings are the first
thing to deal with.** If its report is not in the session you inherit, re-run it
— the branch has not been merged and has not had a whole-branch review land.

Base `65b1c26` (the phase A merge), head `dfbd1ad`, 8 commits, 27 files,
+2060/−179.

**Why this is not a formality.** Phase A passed nine task-level reviews and
then its whole-branch review found a Critical that every one of them had
missed: koffi registered process-global named types inside a per-recording
function, so the second recording of every app session silently produced no
cursor data at all. Nothing caught it because every check on that branch
recorded exactly once. The same shape of gap is the thing to hunt for here.

Seven claims in the phase B commits are measurements or deliberate deviations
rather than routine work, and the review was asked to verify rather than trust
each one:

1. Blur is image-only because on a mesh it is a measured no-op (RMS 0.108/255
   vs 4.586 on an image). The mesh blur path was removed, not left dead.
2. Blur is a mipmap LOD, not a kernel — a 3x3 kernel at "strong" put taps 27px
   apart and ghosted a grid into three copies. Check `generateMipmap`, the
   min-filter, and non-power-of-two safety under WebGL2.
3. `outputSizeFor` has three call sites, the third being the planner context.
   Check there is no fourth building an output size by hand.
4. `resolveFrame` is the only path to frame values. Check nothing still reads
   `style.frame.*` directly for rendering.
5. The background image is copied not referenced, and reaches all three
   `drawFrame` call sites through `bundleAssetUrl`; export and shoot preload
   the decode, preview does not need to.
6. `normalizeProject` handles both old shapes — pre-A (no `style.cursor`) and
   pre-B (loose frame fields, `kind: "solid"`, no `aspect`).
7. The parity harness runs three genuinely different configurations.

After the review: fix round, scoped re-review, then
`superpowers:finishing-a-development-branch`.

---

## The one human check this branch owed: done

**The image picker was driven by hand on 2026-09-05 and works.** It opens a
native dialog, so no headless path reaches it — `background:choose` in
`src/main/ipc.ts` was the only code on this branch with zero automated coverage
of its real path, and it is now confirmed working end to end by the user.

One sub-property was not separately reported and is worth a glance if it ever
matters: that **moving or deleting the original source file changes nothing**,
which is the entire reason spec §5 copies rather than references. The copy
itself is straightforward (`copyFileSync` into the bundle dir, timestamped
name), so this is a low-risk gap rather than an open question.

Nothing else on this branch needs a human. The remaining gaps are all
harness-shaped and listed under "What the guards still do not exercise" below.

---

## Open bug found while hand-testing this branch

**Export produced a truncated, unplayable mp4** — `mdat` with no `moov`. Full
diagnosis in `docs/superpowers/notes/2026-09-05-export-truncated-bug.md`.

Not caused by phase B as far as the evidence goes: the same take, with the same
image background, exports correctly through `libx264`. The real export button is
the only path using `h264_amf`, and nothing has ever tested it. Root cause is
**not** established — two candidates remain and the app persists nothing about
export failures, which is itself a defect.

**This does not block merging phase B** — the export path is untouched by this
branch — but it should be fixed before phase C, because phase C's whole purpose
is judged by watching exported footage.

---

## Where things stand

```
main                    65b1c26  Merge phase A: the cursor pipeline
feat/phase-b-compositor dfbd1ad  <- branch head, 10 of 10 tasks done, unreviewed
```

211 tests / 29 files (179 before this phase). Typecheck silent.
`verify:decode` 6/6. `verify:parity` **15/15** over three configurations.
`tune -- all` byte-identical to the pre-phase baseline. Working tree clean.

| Task | State |
| --- | --- |
| 1 data model + migration | complete — `1564968` |
| 2 gradient presets | complete — `3fa3089` |
| 3 mesh/solid/hidden shader | complete — `411c66d` |
| 4 background blur | complete — `411c66d`, **corrected** in `4406d44` |
| 5 custom image background | complete — `4406d44` |
| 6 frame border + presets | complete — `f661642` |
| 7 aspect + resolution | complete — `b600308` |
| 8 style UI | complete — `1e8f48a` |
| 9 extend the guards | folded into `b600308` |
| 10 handover | complete — `dfbd1ad` |

---

## What phase B actually built

Spec §3 called `StyleConfig` "unreachable style": the renderer honoured it and
`project.json` persisted it, but `Inspector.tsx` listed only `ZoomConfig`
fields, so none of it could be changed. That is now reachable, and wider.

- `src/shared/style/backgrounds.ts` — six mesh gradient presets as pure data,
  `gradientPreset()`, `BLUR_LOD`, `MESH_POINTS`.
- `src/shared/style/frame.ts` — `FRAME_PRESETS` and `resolveFrame`.
- `src/shared/style/aspect.ts` — `outputSizeFor`.
- `src/shared/project/migrate.ts` — extended for the new shape and both old ones.
- `src/renderer/gl/shaders.ts` — `BG_FRAG` rewritten; `SCREEN_FRAG` gained a
  border ring inside its existing SDF.
- `src/renderer/gl/backgroundTexture.ts` — decode, mipmaps, natural size.
- `src/renderer/ui/StylePanel.tsx` + `controls.ts` — the style UI and the four
  shared control styles both panels now import.
- `tools/verify-parity.ts` — three configurations instead of one.

---

## Two things I got wrong, and how they were caught

Both by rendering and measuring, not by reasoning. Worth knowing because the
same trap is available in phase C.

**The blur was ghosting, not blurring.** The plan specified a 3x3 kernel over
the sampled background. At `strong` the taps land 27px apart, so a grid image
rendered as three distinct copies rather than one soft one — nine taps cannot
represent a 27px radius. Replaced with `textureLod` against a mipmapped
texture: one hardware-filtered fetch, correct at any radius, and
resolution-independent because LOD is relative to the texture rather than to
output pixels. **Only opening the PNG showed this**; every automated check
passed both before and after.

**`verify:parity` runs the BUILT bundle.** A newly added 1:1 configuration
reported PSNRs *identical* to the default, which reads as passing. It was still
rendering 1920x1080 because `npm run build` had not been run since the aspect
change. Build before parity, and treat suspiciously-identical numbers as a
signal rather than a result.

**The plan also claimed** "a strongly blurred mesh does soften its control
points visibly at strong". That is false — the mesh is smooth by construction,
so there is nothing to soften. The measurement is what moved the blur control
to image-only.

---

## Things that will bite you

Beyond what `HANDOVER.md` already lists under "The compositor (phase B)":

- **A uniform name missing from a program's lookup list returns null and the
  value silently stays zero.** No error, no warning. This is the codebase's
  most common GL failure, and `BG_FRAG` now has eleven uniforms including two
  per-element arrays — `u_points[0]`, `u_colors[0]` and so on, because GLSL
  array uniforms are addressed per element and asking for `u_points` alone
  returns null.
- **`Background` is a flat record, not a discriminated union, deliberately.**
  The user toggles `kind` back and forth, and a union would discard the other
  kinds' settings on every switch. The renderer reads only the field its `kind`
  selects; the rest are remembered, not applied. Two phase-A migration tests
  encoded the union semantics and had to be updated rather than deleted.
- **Anyone adding a field to `Project` must add it to `normalizeProject`**, or
  existing projects silently lose it on load. `motionBlur` is in the spec's §6
  data model but was deliberately NOT added this phase — phase D should add the
  type and the migration entry together, so no persisted field exists that
  nothing reads.
- **Kind-specific UI controls are hidden for correctness, not tidiness.** Under
  a non-default frame preset `resolveFrame` ignores the individual fields
  entirely, so an editable radius there would silently do nothing.

---

## What the guards still do not exercise

Phase A shipped five broken cursor shapes because the fixture emitted no cursor
events, so only `arrow` had ever been rasterised. The equivalent question here:

- **No parity configuration uses `kind: "image"`**, because it needs a file on
  disk. The image branch, the cover-fit arithmetic and the LOD blur are guarded
  only by `ZOOMCAST_SHOOT` stills that a human has to open. The picker itself is
  now hand-verified, but a preview/export *divergence* in the image path would
  still pass silently — that is a different failure from the one a human sees.
- **No parity configuration uses `kind: "hidden"`**, which is the one branch
  that never binds the background program at all.
- **There is no React component test coverage anywhere.** The 211 tests are
  pure-node tests of `src/shared/`. Every control in `StylePanel.tsx` is
  unguarded by anything but a screenshot.
- **`outputSizeFor` is unit-tested but only `1:1` reaches parity.** `9:16` and
  `4:3` have never been through a real export.

The cheap fix for the first two is a parity configuration pointing at a
committed test image; the fixture generator already writes scratch files, so a
small PNG could be generated rather than vendored.

---

## After phase B

**Phase C is next and it is the one the user actually wants.** The zoom
complaint is measured, with a specific signature, in
`docs/superpowers/notes/2026-09-05-zoom-complaint-evidence.md` — read it before
touching a pacing dial. Summary: on the user's own 51s take, all 7 zooms sit
exactly on the 1.40s hold floor, only 34% of the take is zoomed, and the camera
crosses 1492px in one move on a 1920px source.

Three things phase C should know going in:

- **`addCut` never redraws the paused preview** — a live bug, and the third of
  three redraw idioms in `Editor.tsx`. Phase C owns the preview loop rewrite
  per spec §10, which is the right moment to have one answer instead of three.
- **Spec §8's claim that cursor and camera share one smoothed path does not
  hold.** `buildCursorPath`'s only damping input is a presentation control the
  user can zero, with a 90ms cursor-scale half-life; a follow camera wants
  several hundred ms. Let `PathOptions` take `halfLifeMs` directly and move the
  0–1 mapping to the Editor call site. This is a spec issue as much as a code
  one.
- **One question is still open with the user**, and it points at opposite
  fixes: they listed "smooth" among the zoom complaints, and it is unresolved
  whether they mean the motion is not smooth or that it over-smooths and feels
  floaty. **Ask before tuning damping.**
