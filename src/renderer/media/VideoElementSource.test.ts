import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoElementSource } from "./VideoElementSource";

class MediaStub extends EventTarget {
  preload = ""; muted = false; playsInline = false; style = { display: "" };
  readyState = 4; duration = 5; videoWidth = 640; videoHeight = 360;
  error: { message: string } | null = null;
  failSeek = false;
  private time = 0;
  set src(_url: string) { queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata"))); }
  get currentTime(): number { return this.time; }
  set currentTime(value: number) {
    this.time = value;
    if (this.failSeek) {
      this.error = { message: "PIPELINE_ERROR_DECODE" };
      this.dispatchEvent(new Event("error"));
    } else this.dispatchEvent(new Event("seeked"));
  }
}

async function open(el: MediaStub): Promise<VideoElementSource> {
  vi.stubGlobal("document", { createElement: () => el });
  vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
  return VideoElementSource.open("zc://camera.mp4");
}

afterEach(() => vi.unstubAllGlobals());
describe("preview seek failures", () => {
  it("rejects a decode error instead of waiting forever for seeked", async () => {
    const el = new MediaStub();
    const source = await open(el);
    el.failSeek = true;
    await expect(source.frameAt(1000)).rejects.toThrow("PIPELINE_ERROR_DECODE");
  });
  it("rejects an already failed media element", async () => {
    const el = new MediaStub();
    const source = await open(el);
    el.error = { message: "decoder failed" };
    await expect(source.frameAt(1000)).rejects.toThrow("decoder failed");
  });
  it("observes seek completion even when it fires during currentTime assignment", async () => {
    const el = new MediaStub();
    const source = await open(el);
    expect((await source.frameAt(1000)).image).toBe(el);
  });
});
