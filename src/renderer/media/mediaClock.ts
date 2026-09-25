import { normalizeCuts } from "../../shared/project/cuts";
import { outputDurationMs, outputToSource, sourceToOutput } from "../../shared/project/timeline";
import type { Cut } from "../../shared/project/types";
import type { PreviewClock } from "./PreviewPlayer";

/** What the clock touches on an HTMLVideoElement. Narrow, so a test can hand in a plain object. */
export type ClockElement = {
  /** Seconds, in SOURCE time — the element knows nothing about cuts. */
  currentTime: number;
  play(): unknown;
  pause(): void;
  requestVideoFrameCallback(cb: (now: number, meta: { mediaTime: number }) => void): number;
};

export type ClockTimeline = { durationMs: number; cuts: Cut[] };

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
 * element is skipped to the cut's end. A cut that runs to the end of the take
 * is reported as the end of the output, because rVFC never fires again once
 * the element ends and the player would otherwise never stop.
 *
 * Both callbacks read through getters because the player is constructed
 * before the source is opened, and the cuts change under it.
 */
export function createMediaClock(
  element: () => ClockElement | null,
  timeline: () => ClockTimeline,
): PreviewClock {
  return {
    start(fromOutputMs) {
      const el = element();
      if (el === null) return;
      const { durationMs, cuts } = timeline();
      el.currentTime = outputToSource(fromOutputMs, durationMs, cuts) / 1000;
      void el.play();
    },

    stop() {
      element()?.pause();
    },

    onFrame(cb) {
      const tick = (_now: number, meta: { mediaTime: number }): void => {
        const el = element();
        if (el === null) return;

        const { durationMs, cuts } = timeline();
        const tSource = meta.mediaTime * 1000;
        const tOutput = sourceToOutput(tSource, durationMs, cuts);

        if (tOutput !== null) {
          cb(tOutput);
        } else {
          const cut = normalizeCuts(cuts, durationMs).find(
            (c) => tSource >= c.startMs && tSource < c.endMs,
          );
          if (cut !== undefined && cut.endMs >= durationMs) {
            cb(outputDurationMs(durationMs, cuts));
          } else if (cut !== undefined) {
            el.currentTime = cut.endMs / 1000;
          }
        }

        el.requestVideoFrameCallback(tick);
      };
      element()?.requestVideoFrameCallback(tick);
    },
  };
}
