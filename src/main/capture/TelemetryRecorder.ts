import { createWriteStream, type WriteStream } from "node:fs";
import { uIOhook } from "uiohook-napi";
import type { TelemetryEvent } from "../../shared/bundle/types";
import { CursorShapeReader } from "./CursorShapeReader";

const MOVE_INTERVAL_MS = 1000 / 60;
const FLUSH_INTERVAL_MS = 250;

/**
 * Records global mouse and keyboard activity to `input.jsonl`.
 *
 * Timestamps are relative to `clockBaseMs`, which the session sets to the
 * instant the screen capture produced its first frame — so telemetry and video
 * share an origin without anything needing to be corrected afterwards.
 *
 * Note keystrokes carry no coordinates. That is a hard limitation of the
 * underlying hook and it is why the zoom planner anchors typing on the most
 * recent click rather than on the caret.
 */
export class TelemetryRecorder {
  private readonly stream: WriteStream;
  private pending: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private shapes: CursorShapeReader | null = null;

  /**
   * Whether the shape stream was actually written for this recording.
   *
   * The reader degrades to null rather than throwing, so the manifest must
   * report what happened rather than what was intended - a take claiming
   * shapes it does not have renders as a permanent arrow with no clue why.
   *
   * Latched at start rather than derived from `shapes`, because stop() nulls
   * that field and the manifest is written after stop() - so a getter reading
   * it reported false on every recording, including the ones that did capture
   * shapes. Caught by the packaged record test, not by any unit test.
   */
  hasCursorShapes = false;
  private lastMoveAt = 0;
  private stopped = false;

  private constructor(
    file: string,
    private readonly clockBaseMs: number,
  ) {
    this.stream = createWriteStream(file, { encoding: "utf8", flags: "a" });
  }

  static start(file: string, clockBaseMs: number): TelemetryRecorder {
    const recorder = new TelemetryRecorder(file, clockBaseMs);
    recorder.attach();
    return recorder;
  }

  private now(): number {
    return Date.now() - this.clockBaseMs;
  }

  private push(event: TelemetryEvent): void {
    if (this.stopped) return;
    this.pending.push(JSON.stringify(event));
  }

  private attach(): void {
    uIOhook.on("mousemove", (e) => {
      const t = this.now();
      // Throttled to the capture frame rate; the planner resamples anyway and
      // an unthrottled hook writes far more than it can ever use.
      if (t - this.lastMoveAt < MOVE_INTERVAL_MS) return;
      this.lastMoveAt = t;
      this.push({ t, k: "move", x: e.x, y: e.y });
    });

    uIOhook.on("mousedown", (e) => {
      this.push({ t: this.now(), k: "down", x: e.x, y: e.y, b: e.button as number });
    });

    uIOhook.on("mouseup", (e) => {
      this.push({ t: this.now(), k: "up", x: e.x, y: e.y, b: e.button as number });
    });

    uIOhook.on("wheel", (e) => {
      this.push({ t: this.now(), k: "wheel", x: e.x, y: e.y, dy: e.rotation });
    });

    uIOhook.on("keydown", (e) => {
      this.push({ t: this.now(), k: "key", d: "down", c: String(e.keycode) });
    });

    uIOhook.on("keyup", (e) => {
      this.push({ t: this.now(), k: "key", d: "up", c: String(e.keycode) });
    });

    uIOhook.start();
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    this.shapes = CursorShapeReader.start(
      (event) => this.push(event),
      () => this.now(),
    );
    this.hasCursorShapes = this.shapes !== null;
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    const chunk = `${this.pending.join("\n")}\n`;
    this.pending = [];
    this.stream.write(chunk);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    if (this.flushTimer !== null) clearInterval(this.flushTimer);
    this.shapes?.stop();
    this.shapes = null;
    uIOhook.removeAllListeners();

    try {
      uIOhook.stop();
    } catch {
      // Already stopped; nothing useful to do about it.
    }

    this.flush();
    await new Promise<void>((resolve) => this.stream.end(resolve));
  }
}
