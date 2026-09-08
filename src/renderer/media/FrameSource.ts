/**
 * One frame, and how to let go of it.
 *
 * `VideoSource.frameAt` returns a cloned VideoFrame the caller MUST close: a
 * leaked frame stalls the decoder within seconds. A <video> element must not
 * be closed at all. `release()` is the single contract both satisfy, so the
 * two `drawFrame` call sites — preview and export — keep one shape.
 *
 * That they keep one shape matters more here than usual: a visual feature
 * wired into only one of them is this project's most repeated bug.
 */
export type FrameHandle = {
  readonly image: TexImageSource;
  release(): void;
};

/**
 * A source of frames to composite.
 *
 * Two implementations, deliberately: export needs frame-exact random access at
 * arbitrary output times, which only the decoder can give; preview needs
 * smooth forward playback, which the browser's own media pipeline does far
 * better than a hand-rolled one. Sharing one mechanism between them is what
 * held the preview at ~13fps.
 */
export interface FrameSource {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  /** The frame shown at `tMs`. Release it when the draw is done. */
  frameAt(tMs: number): Promise<FrameHandle>;
  /** Warm whatever cache the implementation has. May be a no-op. */
  prefetch(tMs: number): Promise<void>;
  close(): void;
}

/** Wrap a decoded VideoFrame. Idempotent: a double release must not double-close. */
export function videoFrameHandle(frame: VideoFrame): FrameHandle {
  let released = false;
  return {
    image: frame,
    release() {
      if (released) return;
      released = true;
      frame.close();
    },
  };
}

/** Wrap a <video>. Releasing is a no-op — the element outlives the draw. */
export function elementFrameHandle(el: HTMLVideoElement): FrameHandle {
  return { image: el, release() {} };
}
