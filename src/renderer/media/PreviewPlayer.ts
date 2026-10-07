export type RenderAt = (tOutputMs: number) => Promise<void>;

/**
 * Where the playhead comes from during playback.
 *
 * The wall-clock loop advances the playhead by elapsed real time, so a slow
 * draw jumps it by ~60 frames at 60fps -- past the next keyframe -- and no
 * incremental decode path can engage during playback even when it works.
 * A media clock reports the presentation time of the frame actually about to
 * be drawn, which removes that loop rather than mitigating it.
 */
export type PreviewClock = {
  start(fromMs: number): void;
  stop(): void;
  /** Register for the next frame; `cb` receives that frame's presentation time. */
  onFrame(cb: (tMs: number) => void): void;
};

/**
 * Drives rendering on requestAnimationFrame.
 *
 * Rendering a frame is asynchronous (it may decode), so ticks that arrive while
 * a render is still in flight are dropped rather than queued. Queueing them
 * would build an ever-growing backlog and make the playhead lag behind the
 * audio-free clock it is supposed to track.
 */
export class PreviewPlayer {
  private raf = 0;
  private busy = false;
  private playing = false;
  private disposed = false;
  private pendingSeek: number | null = null;
  private wallAtStart = 0;
  private outputAtStart = 0;

  playheadMs = 0;

  /** Test hook: called after each completed draw. See __zc.benchPreview. */
  onDrawn?: () => void;

  constructor(
    private readonly render: RenderAt,
    private readonly durationMs: () => number,
    private readonly onTick: (tOutputMs: number, playing: boolean) => void,
    /**
     * Called after a frame is drawn, with the time the next one will want.
     * Runs in the gap a dropped tick would otherwise waste, so the decode for
     * the next source frame is already done when the draw asks for it.
     */
    private readonly prefetch: (tOutputMs: number) => void = () => undefined,
    /**
     * Absent, the wall-clock loop runs exactly as it always has -- which is
     * what keeps export, verify:decode and shoot.ts untouched by this.
     */
    private readonly clock?: PreviewClock,
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.outputAtStart = this.playheadMs >= this.durationMs() ? 0 : this.playheadMs;

    if (this.clock !== undefined) {
      this.clock.onFrame(this.onMediaFrame);
      this.clock.start(this.outputAtStart);
      return;
    }

    this.wallAtStart = performance.now();
    this.loop();
  }

  pause(): void {
    this.playing = false;

    if (this.clock !== undefined) {
      // The media-clock path never schedules a rAF, so there is nothing to
      // cancel -- and reaching for it would be the only DOM dependency in an
      // otherwise plain state machine.
      this.clock.stop();
    } else {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    this.onTick(this.playheadMs, false);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(tOutputMs: number): void {
    if (this.disposed) return;
    const clamped = Math.max(0, Math.min(tOutputMs, this.durationMs()));
    this.playheadMs = clamped;
    this.outputAtStart = clamped;
    this.wallAtStart = performance.now();
    this.onTick(clamped, this.playing);
    // Edits and scrubs must survive an in-flight decode. Playback ticks can
    // be dropped, but dropping a paused redraw leaves the last edit invisible.
    if (this.busy) { this.pendingSeek = clamped; return; }
    void this.draw(clamped);
  }

  private async draw(tOutputMs: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.render(tOutputMs);
      this.onDrawn?.();
      if (this.playing) this.prefetch(tOutputMs);
    } finally {
      this.busy = false;
      const pending = this.pendingSeek;
      this.pendingSeek = null;
      if (pending !== null && !this.disposed) void this.draw(pending);
    }
  }

  /**
   * A frame is about to be presented at `tMs`. Composing against this rather
   * than against a requested time aligns the draw to the frame actually on
   * screen.
   */
  private onMediaFrame = (tMs: number): void => {
    if (!this.playing) return;

    const end = this.durationMs();
    if (tMs >= end) {
      this.playheadMs = end;
      this.onTick(end, false);
      void this.draw(end);
      this.pause();
      return;
    }

    this.playheadMs = tMs;
    this.onTick(tMs, true);
    void this.draw(tMs);
  };

  private loop = (): void => {
    if (!this.playing) return;

    const elapsed = performance.now() - this.wallAtStart;
    const t = this.outputAtStart + elapsed;
    const end = this.durationMs();

    if (t >= end) {
      this.playheadMs = end;
      this.onTick(end, false);
      void this.draw(end);
      this.pause();
      return;
    }

    this.playheadMs = t;
    this.onTick(t, true);
    void this.draw(t);

    this.raf = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    this.disposed = true;
    this.pendingSeek = null;
    this.playing = false;
    this.clock?.stop();
    if (this.clock === undefined) cancelAnimationFrame(this.raf);
  }
}
