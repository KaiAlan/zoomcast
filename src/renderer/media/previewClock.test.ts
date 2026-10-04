import { describe, expect, it, vi } from "vitest";
import { PreviewPlayer, type PreviewClock } from "./PreviewPlayer";

function fakeClock(): PreviewClock & { emit(tMs: number): void } {
  let cb: ((tMs: number) => void) | null = null;
  return {
    start: vi.fn(),
    stop: vi.fn(),
    onFrame(next) {
      cb = next;
    },
    emit(tMs) {
      cb?.(tMs);
    },
  };
}

describe("PreviewPlayer with a media clock", () => {
  it("takes the playhead from the frame's presentation time, not the wall clock", async () => {
    const clock = fakeClock();
    const ticks: number[] = [];
    const player = new PreviewPlayer(
      async () => {},
      () => 10_000,
      (t) => ticks.push(t),
      () => {},
      clock,
    );

    player.play();
    clock.emit(1234);
    await Promise.resolve();

    expect(player.playheadMs).toBe(1234);
    expect(ticks).toContain(1234);
  });

  it("starts and stops the clock with playback", () => {
    const clock = fakeClock();
    const player = new PreviewPlayer(
      async () => {},
      () => 10_000,
      () => {},
      () => {},
      clock,
    );

    player.play();
    expect(clock.start).toHaveBeenCalled();
    player.pause();
    expect(clock.stop).toHaveBeenCalled();
  });

  it("stops at the end of the take", async () => {
    const clock = fakeClock();
    const player = new PreviewPlayer(
      async () => {},
      () => 5_000,
      () => {},
      () => {},
      clock,
    );

    player.play();
    clock.emit(5_000);
    await Promise.resolve();

    expect(player.isPlaying).toBe(false);
  });

  it("ignores frames that arrive after a pause", async () => {
    const clock = fakeClock();
    const ticks: number[] = [];
    const player = new PreviewPlayer(
      async () => {},
      () => 10_000,
      (t) => ticks.push(t),
      () => {},
      clock,
    );

    player.play();
    player.pause();
    ticks.length = 0;
    clock.emit(2000);
    await Promise.resolve();

    expect(ticks).toEqual([]);
  });

  it("still runs on the wall clock when no media clock is given", () => {
    // The node env has no rAF. Stubbing it is the point of the test: without
    // a clock the player must reach for the wall-clock loop, not sit idle.
    const raf = vi.fn().mockReturnValue(1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const player = new PreviewPlayer(
      async () => {},
      () => 5_000,
      () => {},
      () => {},
    );
    player.play();
    expect(player.isPlaying).toBe(true);
    expect(raf).toHaveBeenCalled();
    player.pause();

    vi.unstubAllGlobals();
  });
});
