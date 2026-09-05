# Zoom complaint — measured evidence, for phase C

Recorded 2026-09-05, from the user's own words plus `npm run tune -- all`.
Phase C is the fix; this file exists so C opens with data instead of a
re-derivation.

## The complaint, verbatim

> "i want to zooming to be fixed, its all wierd zooming hapening and smooth,
> glitchy, cutting in between and so on"

## What `tune` shows

The user recorded `2026-09-05T11-15-23` (51.1s, 592 events) while testing the
phase A cursor controls. It is the most representative sample of the complaint,
because it is a real session rather than a tuning take.

| Take | len | zooms | /min | % zoomed | hold med | hold min | max jump |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-05T11-15-23 | 51.1s | 7 | 8.2 | **34%** | **1.40s** | **1.40s** | **1492px** |
| 2026-09-04T09-45-53 | 61.4s | 7 | 6.8 | 76% | 2.15s | 1.40s | 557px |
| 2026-09-03T21-24-08 | 35.1s | 6 | 10.3 | 62% | 1.71s | 1.40s | 806px |

The 35s take is the one the planner was tuned against.

Three things stand out, and they line up with the three words in the complaint:

- **"cutting in between" — `max jump 1492px`.** On a 1920px-wide source the
  camera crosses 78% of the frame in one move. Spec §3 already names the cause:
  the camera is pinned to a static `cx, cy` per keyframe, so between shots it
  can only cut or slide in a straight line. This take is the worst instance
  measured — nearly double the take the tuning was done against.
- **"glitchy" — every hold sits exactly on the floor.** `hold med 1.40s` and
  `hold min 1.40s` are the same number, meaning all 7 zooms are minimum-length.
  Nothing settles. The tuned take has median 1.71s against the same 1.40s floor,
  so it at least holds some shots longer than the minimum.
- **"weird" — 34% zoomed against 62-76%.** Less than half the take is zoomed, but
  it is zoomed 8.2 times a minute. That is the signature of zoom in / zoom out /
  zoom in elsewhere, rather than sustained shots.

## What this does NOT show

- Depth is not the problem and cannot be: `scale 1.176-1.176` on every take, the
  1080p-into-1080p clamp `HANDOVER.md` already documents. `marginPx` and
  `clusterRadiusPx` do nothing to depth here. This is purely timing and travel.
- Preview smoothness is a separate, already-diagnosed cause (spec §3 "laggy
  preview": per-rAF React re-render, no prefetch, gdigrab at 26-29fps).

## What "smooth" meant — answered 2026-09-05

The complaint listed "smooth" ambiguously and it has now been clarified by the
user, in their words:

> "by smooth i meant the zooms feel floaty and laggy and the motion isnt smooth
> too"

So it is **all three at once**, and they are three different causes:

| Word | What it points at | Fix lives in |
| --- | --- | --- |
| **floaty** | Transitions too slow / over-eased. `transitionMs` is 600 with `cubicBezier(0.33, 0, 0.1, 1)`, an aggressive decelerate that spends most of its motion in the first third and then crawls. | retuned transitions |
| **laggy** | Preview performance, spec §3: `onTick` fires `setPlayheadMs` on every rAF so React re-renders 60x/sec, and `PreviewPlayer.draw()` drops any frame arriving mid-decode with nothing prefetching. | preview performance |
| **not smooth** | There are simply fewer source frames than smooth motion needs. gdigrab measured 26-29fps against 30 requested, and the take that produced this complaint captured at **17.7fps**. No amount of easing hides that. | capture rate, or interpolation |

**The third is the one to be honest about.** The first two are tunable in phase
C. The third is a capture limitation: `ddagrab` does not work on this machine
(see `HANDOVER.md`), so 60fps GPU capture is unavailable and the source is
sometimes under 20fps. Phase C can make the camera motion smoother *between*
frames, but it cannot invent frames that were never captured. Say so rather
than tuning around it — and note that getting `ddagrab` working would improve
this more than any easing change.

## Also noticed, unrelated to the complaint

Five takes produce `impulses=0` from 115-209 telemetry events, so zero zooms:
`2026-09-03T20-40-39`, `20-44-01`, `2026-09-04T09-36-53`, `10-38-46`,
`10-39-49`, `10-40-52`. All are short (5.7-8.8s). Worth confirming this is
"no clicks in the take" and not an impulse-detection gap before phase C tuning
reads anything into the funnel.
