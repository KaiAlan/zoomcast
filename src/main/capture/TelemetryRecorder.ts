import { BrowserWindow, screen } from "electron";
import { createWriteStream, type WriteStream } from "node:fs";
import { uIOhook } from "uiohook-napi";
import type { ControlContext } from "../../shared/zoom/context";
import type { TelemetryEvent } from "../../shared/bundle/types";
import { SemanticTargetReader } from "./SemanticTargetReader";
import { CursorShapeReader } from "./CursorShapeReader";

const MOVE_INTERVAL_MS = 1000 / 120;
const FLUSH_INTERVAL_MS = 250;

/**
 * Records global mouse and keyboard activity to `input.jsonl`.
 *
 * Timestamps are relative to `clockBaseMs`, which the session sets to the
 * instant the screen capture produced its first frame — so telemetry and video
 * share an origin without anything needing to be corrected afterwards.
 *
 * Keystrokes carry no coordinates. Optional Windows accessibility context
 * supplies focused-control bounds; raw click anchors remain the fallback.
 */
export class TelemetryRecorder {
  private readonly stream: WriteStream;
  private pending: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private shapes: CursorShapeReader | null = null;
  private semantic: SemanticTargetReader | null = null;
  private trailingMove: Extract<TelemetryEvent, { k: "move" }> | null = null;
  private moveTimer: NodeJS.Timeout | null = null;
  private lastKeyContext = -Infinity;
  private lastWheelContext = -Infinity;
  private hoverTimer: NodeJS.Timeout | null = null;
  private hoverContext: { target: ControlContext; region: { x: number; y: number }; at: number } | null = null;

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
    private readonly captureRegion?: () => { x: number; y: number; width: number; height: number },
    semantic?: SemanticTargetReader | null,
  ) {
    this.stream = createWriteStream(file, { encoding: "utf8", flags: "a" });
    this.semantic = semantic === undefined ? SemanticTargetReader.start() : semantic;
  }

  static start(file: string, clockBaseMs: number, captureRegion?: () => { x: number; y: number; width: number; height: number }, semantic?: SemanticTargetReader | null): TelemetryRecorder {
    const recorder = new TelemetryRecorder(file, clockBaseMs, captureRegion, semantic);
    try { recorder.attach(); } catch (error) { void recorder.stop(); throw error; }
    return recorder;
  }

  private now(): number {
    return Date.now() - this.clockBaseMs;
  }

  private push(event: TelemetryEvent): boolean {
    if (this.stopped) return false;
    if ("x" in event) {
      const widget = BrowserWindow.getAllWindows().find(w => w.isVisible() && w.webContents.getURL().endsWith("#recorder"));
      if (widget) {
        const b = screen.dipToScreenRect(widget, widget.getBounds());
        if (event.x >= b.x && event.y >= b.y && event.x < b.x + b.width && event.y < b.y + b.height) return false;
      }
    }
    if ("x" in event && this.captureRegion !== undefined) {
      try {
        const region = this.captureRegion();
        const x = event.x - region.x, y = event.y - region.y;
        if (x < 0 || y < 0 || x >= region.width || y >= region.height) return false;
        event = { ...event, x, y };
      } catch { return false; }
    }
    this.pending.push(JSON.stringify(event));
    return true;
  }

  private recordContext(t: number, trigger: "down" | "key" | "wheel", x = 0, y = 0): void {
    if (!this.semantic || !this.captureRegion) return;
    try {
      const region = this.captureRegion();
      const requested = Date.now();
      void this.semantic.query(x, y, trigger === "key", { x: region.x, y: region.y, w: region.width, h: region.height }).then(target => {
        if (target && Date.now() - requested < 1500) this.push({ t, k: "context", trigger, target });
      });
    } catch { /* A closed/moving window leaves raw input as the fallback. */ }
  }

  private rememberHover(x: number, y: number): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      if (!this.semantic || !this.captureRegion || this.stopped) return;
      try {
        const region = this.captureRegion();
        void this.semantic.query(x, y, false, { x: region.x, y: region.y, w: region.width, h: region.height }).then(target => {
          if (target && !this.stopped) this.hoverContext = { target, region, at: Date.now() };
        });
      } catch { /* Hover context is optional. */ }
    }, 120);
  }

  private writeTrailingMove(): void {
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.moveTimer = null;
    if (!this.trailingMove) return;
    this.lastMoveAt = this.trailingMove.t;
    this.push(this.trailingMove); this.trailingMove = null;
  }

  private attach(): void {
    // Hooks emit movement, not the stationary starting position. Record it
    // explicitly in physical pixels (the same coordinates uiohook reports).
    const initial = screen.dipToScreenPoint(screen.getCursorScreenPoint());
    this.push({ t: 0, k: "move", x: initial.x, y: initial.y });
    uIOhook.on("mousemove", (e) => {
      const t = this.now();
      this.rememberHover(e.x, e.y);
      this.trailingMove = { t, k: "move", x: e.x, y: e.y };
      if (t - this.lastMoveAt >= MOVE_INTERVAL_MS) this.writeTrailingMove();
      else if (!this.moveTimer) this.moveTimer = setTimeout(() => this.writeTrailingMove(), MOVE_INTERVAL_MS - (t - this.lastMoveAt));
    });

    uIOhook.on("mousedown", (e) => {
      this.writeTrailingMove();
      const t = this.now();
      if (this.push({ t, k: "down", x: e.x, y: e.y, b: e.button as number })) {
        const hover = this.hoverContext;
        let cached = false;
        if (hover && Date.now() - hover.at < 700 && this.captureRegion) {
          try {
            const region = this.captureRegion();
            const r = hover.target.rect, x = e.x - region.x, y = e.y - region.y;
            cached = region.x === hover.region.x && region.y === hover.region.y && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
            // Menus may disappear as soon as they are clicked. Preserve bounds
            // read while hovering rather than querying the newly exposed page.
            if (cached) this.push({ t, k: "context", trigger: "down", target: hover.target });
          } catch { /* Query fresh bounds below. */ }
        }
        if (!cached) this.recordContext(t, "down", e.x, e.y);
      }
    });

    uIOhook.on("mouseup", (e) => {
      this.push({ t: this.now(), k: "up", x: e.x, y: e.y, b: e.button as number });
    });

    uIOhook.on("wheel", (e) => {
      const t = this.now();
      if (this.push({ t, k: "wheel", x: e.x, y: e.y, dy: e.rotation }) && t - this.lastWheelContext >= 250) {
        this.lastWheelContext = t; this.recordContext(t, "wheel", e.x, e.y);
      }
    });

    uIOhook.on("keydown", (e) => {
      const t = this.now();
      this.push({ t, k: "key", d: "down", c: String(e.keycode) });
      if (e.keycode === 15 || e.keycode === 28 || t - this.lastKeyContext >= 250) { this.lastKeyContext = t; this.recordContext(t, "key"); }
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
    this.writeTrailingMove();
    this.stopped = true;
    this.semantic?.stop(); this.semantic = null;
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = null; this.hoverContext = null;

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
