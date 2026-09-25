import { describe, expect, it, vi } from "vitest";
import { type ClockElement, createMediaClock } from "./mediaClock";

type Fake = ClockElement & { present(tSourceMs: number): void };

/** A video element reduced to what the clock touches. `present` fires rVFC. */
function fakeElement(): Fake {
  let pending: ((now: number, meta: { mediaTime: number }) => void) | null = null;
  return {
    currentTime: 0,
    play: vi.fn(),
    pause: vi.fn(),
    requestVideoFrameCallback(cb) {
      pending = cb;
      return 1;
    },
    present(tSourceMs) {
      const cb = pending;
      pending = null;
      cb?.(0, { mediaTime: tSourceMs / 1000 });
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
