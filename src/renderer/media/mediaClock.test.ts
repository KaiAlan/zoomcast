import { describe, expect, it, vi } from "vitest";
import { type ClockElement, createMediaClock } from "./mediaClock";

type Fake = ClockElement & {
  /** Fire rVFC for every registered callback with this presentation time. */
  present(tSourceMs: number): void;
  /** How many times `currentTime` was assigned. */
  seeks: number;
  end(): void;
};

/** A video element reduced to what the clock touches. */
function fakeElement(): Fake {
  const pending = new Map<number, (now: number, meta: { mediaTime: number }) => void>();
  let nextHandle = 1;
  let time = 0;
  let ended: (() => void) | undefined;
  return {
    get currentTime() {
      return time;
    },
    set currentTime(v: number) {
      time = v;
      this.seeks++;
    },
    seeks: 0,
    addEventListener(_type, cb) { ended = cb; },
    removeEventListener(_type, cb) { if (ended === cb) ended = undefined; },
    end() { ended?.(); },
    play: vi.fn(),
    pause: vi.fn(),
    requestVideoFrameCallback(cb) {
      const handle = nextHandle++;
      pending.set(handle, cb);
      return handle;
    },
    cancelVideoFrameCallback(handle) {
      pending.delete(handle);
    },
    present(tSourceMs) {
      const cbs = [...pending.values()];
      pending.clear();
      for (const cb of cbs) cb(0, { mediaTime: tSourceMs / 1000 });
    },
  };
}

const CUT = [{ id: "c1", startMs: 1000, endMs: 2000 }];
const DURATION = 5000;

function clockOver(el: Fake, cuts = CUT) {
  return createMediaClock(
    () => el,
    () => ({ durationMs: DURATION, cuts }),
  );
}

describe("createMediaClock", () => {
  it("is the identity when there are no cuts", () => {
    const el = fakeElement();
    const clock = clockOver(el, []);
    const seen: number[] = [];

    clock.start(700);
    clock.onFrame((t) => seen.push(t));
    el.present(700);

    expect(el.currentTime).toBe(0.7);
    expect(el.play).toHaveBeenCalled();
    expect(seen).toEqual([700]);
  });

  it("starts the element at the SOURCE time behind an output time", () => {
    const el = fakeElement();
    clockOver(el).start(1500);

    // 1500 output = 1500 + the 1000ms cut before it.
    expect(el.currentTime).toBe(2.5);
  });

  /**
   * Regression. The clock used to hand the element's source time to the
   * player as output time; renderAt mapped it output→source again and sought
   * the element forward by the cut length on every frame — playback with a
   * cut ran away from the playhead.
   */
  it("reports OUTPUT time for a frame after a cut, not the element's source time", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el).onFrame((t) => seen.push(t));

    el.present(2500);

    expect(seen).toEqual([1500]);
  });

  it("skips the element to the cut's end when it plays into one, and reports nothing", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el).onFrame((t) => seen.push(t));

    el.present(1200);

    expect(seen).toEqual([]);
    expect(el.currentTime).toBe(2);
  });

  it("treats the cut's start as inside the cut", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el).onFrame((t) => seen.push(t));

    el.present(1000);

    expect(seen).toEqual([]);
    expect(el.currentTime).toBe(2);
  });

  it("treats the cut's end as the first frame after it", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el).onFrame((t) => seen.push(t));

    el.present(2000);

    expect(seen).toEqual([1000]);
  });

  /**
   * rVFC stops when the element ends, so a cut that runs to the end of the
   * take would otherwise leave the player "playing" with no frame ever
   * reaching the end.
   */
  it("reports the end of the output when the element plays into a cut that runs to the end", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el, [{ id: "tail", startMs: 4000, endMs: DURATION }]).onFrame((t) => seen.push(t));

    el.present(4100);

    expect(seen).toEqual([4000]);
    expect(el.pause).not.toHaveBeenCalled();
  });

  /**
   * The browser cannot present "the cut's end" exactly: it presents the frame
   * CONTAINING that time, whose timestamp is a little before it, and reports
   * that timestamp. Seeking again on that frame re-presented the same frame —
   * playback stalled at every cut whose end was not on a frame boundary,
   * which is every cut made by dragging.
   */
  it("reports the seam instead of seeking again when the element lands on the frame containing the cut's end", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el).onFrame((t) => seen.push(t));

    el.present(1200);
    expect(el.seeks).toBe(1);
    expect(el.currentTime).toBe(2);

    // The frame containing 2000ms at 60fps starts at 1983.3ms.
    el.present(1983.3);
    expect(el.seeks).toBe(1);
    expect(seen).toEqual([1000]);

    // Then playback carries on past the cut.
    el.present(2016.7);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeCloseTo(1016.7, 6);
  });

  it("seeks once per cut, not once per in-cut frame", () => {
    const el = fakeElement();
    clockOver(el).onFrame(() => undefined);

    el.present(1200);
    el.present(1250);
    el.present(1300);

    expect(el.seeks).toBe(1);
  });

  it("seeks again for a different cut", () => {
    const el = fakeElement();
    const cuts = [
      { id: "a", startMs: 1000, endMs: 2000 },
      { id: "b", startMs: 3000, endMs: 3500 },
    ];
    clockOver(el, cuts).onFrame(() => undefined);

    el.present(1200);
    el.present(2500);
    el.present(3100);

    expect(el.seeks).toBe(2);
    expect(el.currentTime).toBe(3.5);
  });

  it("stops reporting frames after stop()", () => {
    const el = fakeElement();
    const seen: number[] = [];
    const clock = clockOver(el, []);
    clock.onFrame((t) => seen.push(t));
    clock.stop();

    el.present(100);

    expect(seen).toEqual([]);
  });

  /**
   * Every play() registers the frame callback again. Without cancelling the
   * previous chain, N play/pause cycles meant N callbacks per frame.
   */
  it("reports each frame once after play, stop, play", () => {
    const el = fakeElement();
    const seen: number[] = [];
    const clock = clockOver(el, []);
    clock.onFrame((t) => seen.push(t));
    clock.stop();
    clock.onFrame((t) => seen.push(t));

    el.present(100);

    expect(seen).toEqual([100]);
  });

  it("re-arms for the next frame after each one", () => {
    const el = fakeElement();
    const seen: number[] = [];
    clockOver(el, []).onFrame((t) => seen.push(t));

    el.present(100);
    el.present(200);

    expect(seen).toEqual([100, 200]);
  });

  it("does nothing before the element exists", () => {
    const clock = createMediaClock(
      () => null,
      () => ({ durationMs: DURATION, cuts: [] }),
    );

    expect(() => {
      clock.start(0);
      clock.onFrame(() => undefined);
      clock.stop();
    }).not.toThrow();
  });

  it("pauses the element on stop", () => {
    const el = fakeElement();
    clockOver(el).stop();

    expect(el.pause).toHaveBeenCalled();
  });
});

describe("ordered clip media clock", () => {
  const clips = [{ id: "last-first", startMs: 3000, endMs: 5000 }, { id: "intro-last", startMs: 0, endMs: 1000 }];
  it("continues from source EOF to a reordered earlier clip and reports the output end", () => {
    const el = fakeElement();
    const seen: number[] = [];
    const clock = createMediaClock(() => el, () => ({ durationMs: 5000, cuts: [], clips }));
    clock.onFrame(t => seen.push(t)); clock.start(0);
    expect(el.currentTime).toBe(3);
    el.present(3500); expect(seen).toEqual([500]);
    el.end(); expect(el.currentTime).toBe(0);
    el.present(100); expect(seen).toEqual([500, 2100]);
    el.present(1000); expect(seen.at(-1)).toBe(3000);
    clock.stop();
  });
  it("does not advance twice on the decoded frame just before a clip boundary", () => {
    const el = fakeElement(); const seen: number[] = [];
    const clock = createMediaClock(() => el, () => ({ durationMs: 5000, cuts: [], clips: [...clips].reverse() }));
    clock.onFrame(t => seen.push(t)); clock.start(0);
    el.present(1000); expect(el.currentTime).toBe(3);
    el.present(2983.3); expect(seen.at(-1)).toBe(1000);
    el.present(3016.7); expect(seen.at(-1)).toBeCloseTo(1016.7);
    expect(el.seeks).toBe(2); clock.stop();
  });
  it("handles native ended even without a final frame callback, and detaches on stop", () => {
    const el = fakeElement(); const seen: number[] = [];
    const clock = clockOver(el, []); clock.onFrame(t => seen.push(t)); clock.start(0);
    el.end(); expect(seen).toEqual([5000]);
    clock.stop(); el.end(); expect(seen).toEqual([5000]);
  });
  it("seeks while playing to the correct ordered clip", () => {
    const el = fakeElement(); const seen: number[] = [];
    const clock = createMediaClock(() => el, () => ({ durationMs: 5000, cuts: [], clips }));
    clock.onFrame(t => seen.push(t)); clock.start(2400);
    expect(el.currentTime).toBe(0.4);
    el.present(450); expect(seen).toEqual([2450]); clock.stop();
  });
});
