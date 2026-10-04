import { type FrameHandle, type FrameSource, elementFrameHandle } from "./FrameSource";

/** One frame at 60fps is 16.7ms; 20ms is just over a frame. */
const SEEK_TOLERANCE_MS = 20;

/**
 * True when `wantMs` is far enough from `currentMs` to be worth a seek.
 *
 * During playback `currentTime` advances on its own. Seeking on every
 * sub-frame difference would stall the pipeline continuously — which is the
 * failure mode this whole source exists to avoid.
 */
export function needsSeek(
  currentMs: number,
  wantMs: number,
  toleranceMs = SEEK_TOLERANCE_MS,
): boolean {
  return Math.abs(wantMs - currentMs) > toleranceMs;
}

/**
 * A frame source backed by an HTMLVideoElement.
 *
 * Preview only. The browser owns demux, buffering and frame timing, which is
 * the entire point: the decoder-backed path builds a fresh VideoDecoder per
 * frame and decodes from the nearest keyframe, so against a GOP of 30 it pays
 * ~15 decoded frames for every one displayed.
 *
 * NOT suitable for export. Seeks here are asynchronous and land on the nearest
 * decodable frame, so "give me exactly frame N" is not a question this can
 * answer. Export keeps DecodedFrameSource.
 *
 * Requires the serving URL to honour HTTP Range: Chromium seeks by issuing
 * range requests, and without them the element buffers the whole recording
 * before seeking behaves. See src/main/byteRange.ts.
 */
export class VideoElementSource implements FrameSource {
  private constructor(
    readonly el: HTMLVideoElement,
    readonly durationMs: number,
    readonly width: number,
    readonly height: number,
  ) {}

  static async open(url: string): Promise<VideoElementSource> {
    const el = document.createElement("video");
    el.preload = "auto";
    el.muted = true;
    el.playsInline = true;
    // Never added to the document: this is a texture source, not UI.
    el.style.display = "none";
    el.src = url;

    await new Promise<void>((resolve, reject) => {
      el.addEventListener("loadedmetadata", () => resolve(), { once: true });
      el.addEventListener(
        "error",
        () => reject(new Error(`video load failed: ${url} (${el.error?.message ?? "no detail"})`)),
        { once: true },
      );
    });

    // Metadata can arrive before there are pixels to paint. Waiting for
    // HAVE_CURRENT_DATA means the first draw is the real frame rather than
    // black — the editor draws once on open, before anything plays.
    if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => {
        el.addEventListener("loadeddata", () => resolve(), { once: true });
      });
    }

    return new VideoElementSource(
      el,
      Number.isFinite(el.duration) ? el.duration * 1000 : 0,
      el.videoWidth,
      el.videoHeight,
    );
  }

  async frameAt(tMs: number): Promise<FrameHandle> {
    if (needsSeek(this.el.currentTime * 1000, tMs)) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          this.el.removeEventListener("seeked", onSeeked);
          this.el.removeEventListener("error", onError);
        };
        const onSeeked = (): void => { cleanup(); resolve(); };
        const onError = (): void => {
          cleanup();
          reject(new Error(`video seek failed: ${this.el.error?.message ?? "decode error"}`));
        };
        this.el.addEventListener("seeked", onSeeked, { once: true });
        this.el.addEventListener("error", onError, { once: true });
        if (this.el.error !== null) { onError(); return; }
        try { this.el.currentTime = tMs / 1000; }
        catch (err) { cleanup(); reject(err); }
      });
    }

    return elementFrameHandle(this.el);
  }

  /** The browser's own buffering replaces this. */
  async prefetch(_tMs: number): Promise<void> {}

  close(): void {
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
  }
}
