import { describe, expect, it, vi } from "vitest";
import { videoFrameHandle } from "./FrameSource";

describe("videoFrameHandle", () => {
  it("exposes the frame as the image", () => {
    const close = vi.fn();
    const fake = { close } as unknown as VideoFrame;
    expect(videoFrameHandle(fake).image).toBe(fake);
  });

  it("closes the frame exactly once on release", () => {
    const close = vi.fn();
    const handle = videoFrameHandle({ close } as unknown as VideoFrame);
    handle.release();
    handle.release();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
