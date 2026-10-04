import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoSource } from "./VideoSource";
let decoded = 0;
let liveFrames = 0;
class Frame {
  closed = false;
  constructor(readonly timestamp: number) { liveFrames++; }
  clone(): Frame { return new Frame(this.timestamp); }
  close(): void { if (!this.closed) { this.closed = true; liveFrames--; } }
}
class Decoder extends EventTarget {
  state = "configured"; decodeQueueSize = 0;
  constructor(private readonly callbacks: { output: (frame: Frame) => void }) { super(); }
  configure(): void {}
  decode(chunk: { timestamp: number }): void {
    decoded++; this.decodeQueueSize++;
    queueMicrotask(() => { this.callbacks.output(new Frame(chunk.timestamp)); this.decodeQueueSize--; this.dispatchEvent(new Event("dequeue")); });
  }
  async flush(): Promise<void> { await Promise.resolve(); }
  close(): void { this.state = "closed"; }
}
function source(order = [0, 1, 2, 3]): VideoSource {
  decoded = 0; liveFrames = 0;
  vi.stubGlobal("VideoDecoder", Decoder);
  vi.stubGlobal("EncodedVideoChunk", class { timestamp: number; constructor(value: { timestamp: number }) { this.timestamp = value.timestamp; } });
  const index = order.map((timestamp, decodeIndex) => ({ decodeIndex, ctsTicks: timestamp, timestampUs: timestamp * 1000, durationUs: 1000, isSync: decodeIndex === 0, data: new Uint8Array() }));
  return Reflect.construct(VideoSource, [index, [...index].sort((a, b) => a.ctsTicks - b.ctsTicks), {}, 1000, 4, 32, 32, true]) as VideoSource;
}
afterEach(() => vi.unstubAllGlobals());
describe("forward export decoding", () => {
  it("decodes each packet once and releases all frames", async () => {
    const video = source();
    for (let time = 0; time < 4; time++) {
      const frame = await video.frameAt(time);
      expect((frame.image as unknown as Frame).timestamp).toBe(time * 1000);
      frame.release();
    }
    expect(decoded).toBe(4);
    video.close(); expect(liveFrames).toBe(0);
  });
  it("keeps future presentation frames when decode order differs", async () => {
    const video = source([0, 3, 1, 2]);
    for (let time = 0; time < 4; time++) {
      const frame = await video.frameAt(time);
      expect((frame.image as unknown as Frame).timestamp).toBe(time * 1000);
      frame.release();
    }
    expect(decoded).toBe(4);
    video.close(); expect(liveFrames).toBe(0);
  });
  it("restarts at a keyframe for a backward seek", async () => {
    const video = source();
    (await video.frameAt(3)).release();
    const frame = await video.frameAt(1);
    expect((frame.image as unknown as Frame).timestamp).toBe(1000);
    frame.release(); video.close(); expect(liveFrames).toBe(0);
  });
});
