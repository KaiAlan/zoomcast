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
  it("repaints the newest paused edit after an in-flight frame completes", async () => {
    let finish!: () => void;
    let style = "filled";
    const drawn: Array<{ ms: number; style: string }> = [];
    const player = new PreviewPlayer(async ms => {
      const snapshot = style;
      if (drawn.length === 0) await new Promise<void>(resolve => { finish = resolve; });
      drawn.push({ ms, style: snapshot });
    }, () => 10000, () => {}, () => {}, fakeClock());
    player.seek(0);
    style = "dot"; player.seek(100);
    style = "outline"; player.seek(200);
    finish();
    await Promise.resolve(); await Promise.resolve();
    expect(drawn).toEqual([{ ms: 0, style: "filled" }, { ms: 200, style: "outline" }]);
    expect(player.playheadMs).toBe(200);
    player.dispose();
  });
  it("cancels queued redraws when the editor closes", async () => {
    let finish!: () => void;
    const render = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const player = new PreviewPlayer(render, () => 10000, () => {}, () => {}, fakeClock());
    player.seek(0); player.seek(500); player.dispose(); finish();
    await Promise.resolve(); await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
  });
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

  it("loops and resets the playhead at the end of the take", async () => {
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

    expect(player.isPlaying).toBe(true);
    expect(player.playheadMs).toBe(0);
    expect(clock.start).toHaveBeenLastCalledWith(0);
    player.dispose();
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
