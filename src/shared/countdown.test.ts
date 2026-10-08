import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { COUNTDOWN_CUES, countdownCueHtml, countdownOverlayBounds } from "./countdown";

function renderer() {
  const tones: Array<{ frequency: number; start: number; end?: number }> = [];
  const gains: number[] = [];
  const digit = { textContent: "", offsetWidth: 100, classList: { remove() {}, add() {} } };
  class AudioContext {
    currentTime = 1;
    state = "running";
    destination = {};
    createOscillator() {
      let entry: typeof tones[number];
      return { type: "", frequency: { value: 0 }, onended: () => {}, connect() {}, disconnect() {},
        start(at: number) { entry = { frequency: this.frequency.value, start: at }; tones.push(entry); },
        stop(at: number) { entry.end = at; },
      };
    }
    createGain() {
      return { gain: { setValueAtTime(value: number) { gains.push(value); }, linearRampToValueAtTime(value: number) { gains.push(value); } }, connect() {}, disconnect() {} };
    }
  }
  const window = {} as { countdownCue: { tick: (n: number) => Promise<void>; started: () => Promise<void> } };
  const script = countdownCueHtml().match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw Error("Missing cue script");
  runInNewContext(script, { window, AudioContext, document: { querySelector: () => digit }, console });
  return { cue: window.countdownCue, digit, tones, gains };
}

describe("recording countdown", () => {
  it("centers on the selected monitor, including scaled and negative-position layouts", () => {
    expect(countdownOverlayBounds({ x: 0, y: 0, width: 1920, height: 1080 })).toEqual({ x: 810, y: 390, width: 300, height: 300 });
    expect(countdownOverlayBounds({ x: -1280, y: 100, width: 1280, height: 720 })).toEqual({ x: -790, y: 310, width: 300, height: 300 });
    expect(countdownOverlayBounds({ x: 0, y: 0, width: 200, height: 200 })).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });
  it("updates every number with one quiet beep and a distinct start chime", async () => {
    const { cue, digit, tones, gains } = renderer();
    for (const n of [3, 2, 1]) { await cue.tick(n); expect(digit.textContent).toBe(String(n)); }
    expect(tones.map(tone => tone.frequency)).toEqual([660, 660, 660]);
    await cue.started();
    expect(tones.map(tone => tone.frequency)).toEqual([660, 660, 660, 784, 1047]);
    expect(Math.max(...gains)).toBeLessThanOrEqual(0.045);
    expect(gains.filter(gain => gain === 0)).toHaveLength(10);
    expect(tones[0]!.end! - tones[0]!.start).toBeCloseTo(COUNTDOWN_CUES.tick.durationMs / 1000);
    expect(tones[4]!.end! - tones[3]!.start).toBeCloseTo(COUNTDOWN_CUES.started.durationMs / 1000);
  });
  it("ignores repeated states and invalid numbers instead of repeating beeps", async () => {
    const { cue, tones } = renderer();
    for (const n of [3, 3, 0, -1, 11, 2.5]) await cue.tick(n);
    await cue.started(); await cue.started();
    expect(tones).toHaveLength(3);
  });
});
