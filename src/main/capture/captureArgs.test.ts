import { describe, expect, it } from "vitest";
import { buildCaptureArgs, progressReportsFrame, type ScreenCaptureOptions } from "./ScreenSource";

const opts: ScreenCaptureOptions = {
  outFile: "C:\\out\\screen.mp4",
  fps: 60,
  gop: 30,
  encoder: "h264_amf",
  drawMouse: false,
  adapterIndex: 0,
  outputIndex: 0,
};

const filterChain = (args: string[]): string =>
  args[args.indexOf("-filter_complex") + 1] ?? "";

describe("buildCaptureArgs — ddagrab", () => {
  it("downloads and converts to nv12 in the filtergraph", () => {
    expect(filterChain(buildCaptureArgs("ddagrab", opts))).toBe(
      "ddagrab=output_idx=0:draw_mouse=0:framerate=60,hwdownload,format=bgra,format=nv12",
    );
  });

  /**
   * scale_d3d11 fails on this AMD iGPU with E_INVALIDARG when its NV12 texture
   * array is allocated, and h264_amf will not take the BGRA D3D11 surfaces
   * directly either. Both were measured on 2026-09-08.
   */
  it("does not use scale_d3d11", () => {
    expect(buildCaptureArgs("ddagrab", opts).join(" ")).not.toContain("scale_d3d11");
  });

  /**
   * -pix_fmt after a hardware filter chain inserts an auto_scale that D3D11
   * frames cannot pass through: "Impossible to convert between the formats
   * supported by the filter 'Parsed_scale_d3d11_1' and the filter
   * 'auto_scale_0'". The chain has already committed to nv12.
   */
  it("sets no -pix_fmt, which would insert an auto_scale", () => {
    expect(buildCaptureArgs("ddagrab", opts)).not.toContain("-pix_fmt");
  });

  /**
   * Without an explicit nv12, ffmpeg picks yuvj420p and writes a full-range
   * file — the same take would grade differently depending on which backend
   * recorded it.
   */
  it("pins nv12 so both backends agree on colour range", () => {
    expect(filterChain(buildCaptureArgs("ddagrab", opts))).toContain("format=nv12");
    expect(buildCaptureArgs("gdigrab", opts)).toContain("yuv420p");
  });

  it("uses the swept adapter and output rather than assuming zero", () => {
    const args = buildCaptureArgs("ddagrab", { ...opts, adapterIndex: 1, outputIndex: 2 });

    expect(args).toContain("d3d11va=dx:1");
    expect(filterChain(args)).toContain("output_idx=2");
  });

  it("carries draw_mouse through", () => {
    expect(filterChain(buildCaptureArgs("ddagrab", { ...opts, drawMouse: true }))).toContain(
      "draw_mouse=1",
    );
  });
});

describe("buildCaptureArgs — gdigrab", () => {
  it("still asks for yuv420p, because its input is BGRA", () => {
    const args = buildCaptureArgs("gdigrab", opts);

    expect(args).toContain("-pix_fmt");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");
  });

  it("ignores the adapter and output indices", () => {
    const args = buildCaptureArgs("gdigrab", { ...opts, adapterIndex: 3, outputIndex: 4 });

    expect(args.join(" ")).not.toContain("dx:3");
    expect(args.join(" ")).not.toContain("output_idx");
  });

  it("keeps the fragmented-mp4 flags so an abnormal exit still plays", () => {
    for (const backend of ["ddagrab", "gdigrab"] as const) {
      expect(buildCaptureArgs(backend, opts)).toContain("+frag_keyframe+empty_moov");
    }
  });
});

describe("buildCaptureArgs — clock anchor", () => {
  /**
   * start() stamps t=0 for telemetry and audio when the first -progress block
   * arrives. At ffmpeg's default 0.5s report period that anchor landed up to
   * 500ms after the real first frame, and every event inherited the bias.
   */
  it.each(["ddagrab", "gdigrab"] as const)(
    "asks for progress every 20ms on %s, so the first frame is stamped within a frame or two",
    (backend) => {
      const args = buildCaptureArgs(backend, opts);
      expect(args[args.indexOf("-stats_period") + 1]).toBe("0.02");
    },
  );
});

describe("progressReportsFrame", () => {
  it("is false while every block still says frame=0", () => {
    expect(progressReportsFrame("frame=0\nfps=0.0\nprogress=continue\n")).toBe(false);
  });

  /**
   * At a 20ms report period the first block routinely says frame=0, and a
   * first-match scan of the accumulated output found that block forever:
   * verify:capture timed out with "capture produced no frame within 10s".
   */
  it("is true once any later block reports a frame", () => {
    const text = "frame=0\nfps=0.0\nprogress=continue\nframe=1\nfps=48.2\nprogress=continue\n";
    expect(progressReportsFrame(text)).toBe(true);
  });

  it("copes with a block split across chunks", () => {
    expect(progressReportsFrame("fra")).toBe(false);
    expect(progressReportsFrame("frame=2")).toBe(true);
  });
});
