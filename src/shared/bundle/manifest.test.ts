import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";

const valid = {
  version: 1,
  id: "2026-09-03T14-40-12",
  createdAt: "2026-09-03T14:40:12.331Z",
  clockBaseUnixMs: 1772806812331,
  status: "clean",
  durationMs: 5000,
  display: {
    adapter: "AMD Radeon(TM) Graphics",
    outputIdx: 0,
    width: 1920,
    height: 1080,
    refreshHz: 144,
    scale: 1,
  },
  video: {
    file: "screen.mp4",
    codec: "h264",
    encoder: "h264_amf",
    width: 1920,
    height: 1080,
    fps: 60,
    gop: 30,
    drawMouse: false,
    startOffsetMs: 0,
  },
  audio: [{ role: "mic", file: "mic.webm", codec: "opus", startOffsetMs: 142 }],
  telemetry: { file: "input.jsonl", hasCursorShapes: false },
};

describe("parseManifest", () => {
  it("accepts a valid manifest", () => {
    const m = parseManifest(valid);
    expect(m.video.fps).toBe(60);
    expect(m.audio[0]?.startOffsetMs).toBe(142);
  });

  it("defaults audio to an empty array", () => {
    const { audio, ...rest } = valid;
    void audio;
    expect(parseManifest(rest).audio).toEqual([]);
  });

  it("rejects an unknown schema version", () => {
    expect(() => parseManifest({ ...valid, version: 2 })).toThrow();
  });

  it("rejects a negative duration", () => {
    expect(() => parseManifest({ ...valid, durationMs: -1 })).toThrow();
  });

  it("rejects an unknown status", () => {
    expect(() => parseManifest({ ...valid, status: "partial" })).toThrow();
  });
});
