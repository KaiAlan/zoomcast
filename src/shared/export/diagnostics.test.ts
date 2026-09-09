import { describe, expect, it } from "vitest";
import { formatExportFailure, formatExportStart } from "./diagnostics";
import type { ExportArgsOptions } from "./ffmpegArgs";

const OPTS: ExportArgsOptions = {
  width: 1920,
  height: 1080,
  fps: 60,
  bitrateMbps: 12,
  encoder: "h264_amf",
  durationMs: 26767,
  cuts: [{ id: "c1", startMs: 1000, endMs: 2000 }],
  audio: [
    { file: "C:/x/mic.webm", gainDb: 0, startOffsetMs: -6587 },
    { file: "C:/x/system.webm", gainDb: -6, startOffsetMs: -938 },
  ],
  syncNudgeMs: 0,
  outFile: "C:/Users/x/Downloads/take.mp4",
};

describe("formatExportStart", () => {
  it("records every setting needed to reproduce the export", () => {
    const line = formatExportStart(OPTS);

    // The encoder is the whole reason this log exists: the button and the test
    // hook use different ones, and only one of them was ever exercised.
    expect(line).toContain("encoder=h264_amf");
    expect(line).toContain("1920x1080@60");
    expect(line).toContain("bitrate=12M");
    expect(line).toContain("durationMs=26767");
    expect(line).toContain("cuts=1");
    expect(line).toContain("audio=2");
    expect(line).toContain("offsets=-6587,-938");
  });

  it("says cuts=0 rather than omitting the field", () => {
    expect(formatExportStart({ ...OPTS, cuts: [] })).toContain("cuts=0");
  });

  it("does not log the output path, which can carry a real name", () => {
    expect(formatExportStart(OPTS)).not.toContain("Users");
  });
});

describe("formatExportFailure", () => {
  it("keeps the reason and the tail of ffmpeg's stderr", () => {
    const line = formatExportFailure("frame 812: source.frameAt threw", "x264: bad\nlast line");
    expect(line).toContain("frame 812");
    expect(line).toContain("last line");
  });

  it("truncates a long stderr from the FRONT, keeping the end", () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const line = formatExportFailure("cancelled", long);

    // ffmpeg's real error is always its last output, never its first.
    expect(line).toContain("line 399");
    expect(line).not.toContain("line 0\n");
    expect(line.length).toBeLessThan(2500);
  });

  it("survives an empty stderr", () => {
    expect(formatExportFailure("cancelled", "")).toBe("cancelled");
  });
});
