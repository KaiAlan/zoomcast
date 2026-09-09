import { describe, expect, it } from "vitest";
import { buildExportArgs, type ExportArgsOptions } from "./ffmpegArgs";

const base: ExportArgsOptions = {
  width: 1920,
  height: 1080,
  fps: 60,
  bitrateMbps: 12,
  encoder: "h264_amf",
  durationMs: 5000,
  cuts: [],
  audio: [{ file: "mic.webm", gainDb: 0, startOffsetMs: 142 }],
  syncNudgeMs: 0,
  outFile: "out.mp4",
};

const joined = (o: ExportArgsOptions): string => buildExportArgs(o).join(" ");

describe("buildExportArgs", () => {
  it("declares the rawvideo pipe input first", () => {
    expect(buildExportArgs(base).slice(0, 12)).toEqual([
      "-y",
      "-hide_banner",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      "1920x1080",
      "-r",
      "60",
      "-i",
      "pipe:0",
    ]);
  });

  it("places each audio input on the source timeline with itsoffset", () => {
    expect(joined(base)).toContain("-itsoffset 0.142 -i mic.webm");
  });

  it("subtracts the sync nudge from the offset", () => {
    expect(joined({ ...base, syncNudgeMs: 42 })).toContain("-itsoffset 0.1 -i mic.webm");
  });

  it("uses no asplit or concat when there are no cuts", () => {
    const s = joined(base);
    expect(s).not.toContain("asplit");
    expect(s).not.toContain("concat");
    expect(s).toContain("volume=0dB");
  });

  it("splits and concatenates one segment per kept span", () => {
    const s = joined({ ...base, cuts: [{ id: "c1", startMs: 1000, endMs: 2000 }] });
    expect(s).toContain("asplit=2");
    expect(s).toContain("concat=n=2:v=0:a=1");
    expect(s).toContain("atrim=start=0:end=1");
    expect(s).toContain("atrim=start=2");
  });

  it("produces three segments for two cuts", () => {
    const s = joined({
      ...base,
      cuts: [
        { id: "c1", startMs: 1000, endMs: 2000 },
        { id: "c2", startMs: 3000, endMs: 3500 },
      ],
    });
    expect(s).toContain("asplit=3");
    expect(s).toContain("concat=n=3:v=0:a=1");
  });

  it("mixes two audio inputs", () => {
    const s = joined({
      ...base,
      audio: [
        { file: "mic.webm", gainDb: 0, startOffsetMs: 142 },
        { file: "system.webm", gainDb: -6, startOffsetMs: 138 },
      ],
    });
    expect(s).toContain("amix=inputs=2:duration=longest:normalize=0");
    expect(s).toContain("volume=-6dB");
  });

  it("omits audio entirely when there are no audio inputs", () => {
    const s = joined({ ...base, audio: [] });
    expect(s).not.toContain("-filter_complex");
    expect(s).not.toContain("-c:a");
  });

  it("sets the video encoder, bitrate and output pixel format", () => {
    const s = joined(base);
    expect(s).toContain("-c:v h264_amf");
    expect(s).toContain("-b:v 12M");
    expect(s).toContain("-pix_fmt yuv420p");
    expect(buildExportArgs(base).at(-1)).toBe("out.mp4");
  });

  it("gives every filter label a single consumer", () => {
    const args = buildExportArgs({
      ...base,
      cuts: [{ id: "c1", startMs: 1000, endMs: 2000 }],
      audio: [
        { file: "mic.webm", gainDb: 0, startOffsetMs: 142 },
        { file: "system.webm", gainDb: -6, startOffsetMs: 138 },
      ],
    });
    const graph = args[args.indexOf("-filter_complex") + 1] ?? "";

    // Every produced label must be consumed exactly once (except the final
    // [aout], which -map consumes). A label read twice is an ffmpeg error.
    const produced = [...graph.matchAll(/\[(\w+)\](?=[;,]|$)/g)].map((m) => m[1]);
    for (const label of produced) {
      if (label === "aout") continue;
      const reads = [...graph.matchAll(new RegExp(`\\[${label}\\]`, "g"))].length;
      expect(reads).toBe(2); // one produce, one consume
    }
  });
});
