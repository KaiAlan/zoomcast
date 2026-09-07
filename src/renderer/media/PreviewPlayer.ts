export type RenderAt = (tOutputMs: number) => Promise<void>;

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
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.wallAtStart = performance.now();
    this.outputAtStart = this.playheadMs >= this.durationMs() ? 0 : this.playheadMs;
    this.loop();
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onTick(this.playheadMs, false);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(tOutputMs: number): void {
    const clamped = Math.max(0, Math.min(tOutputMs, this.durationMs()));
    this.playheadMs = clamped;
    this.outputAtStart = clamped;
    this.wallAtStart = performance.now();
    this.onTick(clamped, this.playing);
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
    }
  }

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
    this.playing = false;
    cancelAnimationFrame(this.raf);
  }
}
