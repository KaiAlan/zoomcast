import { normalizeCuts } from "../../shared/project/cuts";
import { clipsFor, outputDurationMs, outputToSource, sourceToOutput } from "../../shared/project/timeline";
import type { Cut, SourceClip } from "../../shared/project/types";
import type { PreviewClock } from "./PreviewPlayer";

/** What the clock touches on an HTMLVideoElement. Narrow, so a test can hand in a plain object. */
export type ClockElement = {
  /** Seconds, in SOURCE time — the element knows nothing about cuts. */
  currentTime: number;
  play(): unknown;
  pause(): void;
  requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number }) => void): number;
  cancelVideoFrameCallback(handle: number): void;
  addEventListener?(type: "ended", cb: () => void): void;
  removeEventListener?(type: "ended", cb: () => void): void;
};

export type ClockTimeline = { durationMs: number; cuts: Cut[]; clips?: SourceClip[] };

/**
 * A PreviewClock over a video element, in OUTPUT time.
 *
 * rVFC reports the presentation time of the frame about to be composited, so
 * the composition is aligned to the frame actually on screen rather than to a
 * time derived from the wall clock — that is what removed the old feedback
 * loop where a slow draw advanced the playhead by ~60 frames.
 *
 * The element plays SOURCE time and the player thinks in OUTPUT time. This is
 * the one place the two are converted: `start` maps output → source before
 * seeking, and every frame maps source → output before it reaches the player.
 * Doing neither handed source times to a player that mapped them again, and
 * playback across a cut ran away by the cut's length every frame.
 *
 * When the element plays into a cut, the frame is not reported and the
 * element is skipped to the cut's end — once. The browser cannot present
 * "the cut's end" exactly: it presents the frame CONTAINING that time, whose
 * timestamp is a little before it, and reports that timestamp — still inside
 * the cut. Seeking again on that frame re-presented the same frame, and
 * playback stalled at every cut whose end was not on a frame boundary, which
 * is every cut made by dragging. So after the one seek, an in-cut frame for
 * that same cut is reported as the seam and the element is left to play on.
 *
 * A cut that runs to the end of the take is reported as the end of the
 * output, because rVFC never fires again once the element ends and the
 * player would otherwise never stop.
 *
 * One frame callback chain at a time: every play() registers again, so
 * without cancelling the previous chain N play/pause cycles meant N callbacks
 * per presented frame.
 *
 * Both callbacks read through getters because the player is constructed
 * before the source is opened, and the cuts change under it.
 */
export function createMediaClock(
  element: () => ClockElement | null,
  timeline: () => ClockTimeline,
): PreviewClock {
  /** The pending rVFC registration, so stop() and a re-registration can cancel it. */
  let handle: number | null = null;
  /** The cut end (source ms) the element was last sent to, until a frame outside a cut arrives. */
  let skippingTo: number | null = null;

  let activeClip = 0;
  let onEnd: (() => void) | null = null;
  let generation = 0;

  const cancel = (el: ClockElement): void => {
    if (handle !== null) el.cancelVideoFrameCallback(handle);
    handle = null;
    if (onEnd) el.removeEventListener?.("ended", onEnd);
    onEnd = null;
    generation++;
  };

  return {
    start(fromOutputMs) {
      const el = element();
      if (el === null) return;
      const { durationMs, cuts, clips } = timeline();
      skippingTo = null;
      let offset = 0;
      const ranges = clipsFor(durationMs, cuts, clips);
      activeClip = Math.max(0, ranges.findIndex(c => {
        offset += c.endMs - c.startMs;
        return fromOutputMs < offset;
      }));
      el.currentTime = outputToSource(fromOutputMs, durationMs, cuts, clips) / 1000;
      void el.play();
    },

    stop() {
      const el = element();
      if (el === null) return;
      cancel(el);
      el.pause();
    },

    onFrame(cb) {
      const first = element();
      if (first === null) return;
      cancel(first);

      const chain = generation;
      const advanceClip = (el: ClockElement): void => {
        const { durationMs, cuts, clips } = timeline();
        const ranges = clipsFor(durationMs, cuts, clips);
        activeClip++;
        const next = ranges[activeClip];
        if (next) { el.currentTime = next.startMs / 1000; void el.play(); }
        else cb(outputDurationMs(durationMs, cuts, clips));
      };
      onEnd = () => {
        const el = element();
        if (!el || chain !== generation) return;
        const { durationMs, cuts, clips } = timeline();
        if (clips) advanceClip(el);
        else cb(outputDurationMs(durationMs, cuts));
      };
      first.addEventListener?.("ended", onEnd);

      const tick = (_now: number, meta: { mediaTime: number }): void => {
        const el = element();
        if (el === null) {
          handle = null;
          return;
        }

        const { durationMs, cuts, clips } = timeline();
        const tSource = meta.mediaTime * 1000;
        if (clips) {
          const ranges = clipsFor(durationMs, cuts, clips);
          const current = ranges[activeClip];
          if (!current) cb(outputDurationMs(durationMs, cuts, clips));
          else if (tSource >= current.endMs) advanceClip(el);
          else if (tSource >= current.startMs - 100) {
            const offset = ranges.slice(0, activeClip).reduce((sum, c) => sum + c.endMs - c.startMs, 0);
            cb(offset + Math.max(0, tSource - current.startMs));
          }
          if (chain === generation) handle = el.requestVideoFrameCallback(tick);
          return;
        }
        const tOutput = sourceToOutput(tSource, durationMs, cuts);

        if (tOutput !== null) {
          skippingTo = null;
          cb(tOutput);
        } else {
          const cut = normalizeCuts(cuts, durationMs).find(
            (c) => tSource >= c.startMs && tSource < c.endMs,
          );
          if (cut === undefined) {
            // sourceToOutput said "cut" but no cut contains it: nothing to do.
          } else if (cut.endMs >= durationMs) {
            cb(outputDurationMs(durationMs, cuts));
          } else if (skippingTo === cut.endMs) {
            // Already sent there: this is the frame containing the cut's end.
            const seam = sourceToOutput(cut.endMs, durationMs, cuts);
            if (seam !== null) cb(seam);
          } else {
            skippingTo = cut.endMs;
            el.currentTime = cut.endMs / 1000;
          }
        }

        if (chain === generation) handle = el.requestVideoFrameCallback(tick);
      };
      handle = first.requestVideoFrameCallback(tick);
    },
  };
}
