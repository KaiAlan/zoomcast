import { type ChildProcess, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolveFfmpeg, resolveFfmpegExePath } from "../ffmpeg";
import { classifyProbe, type DuplicationPair, sweepDuplication } from "./duplicationSweep";
import { pinToIntegratedGpu } from "./gpuPreference";

const run = promisify(execFile);

export type CaptureBackend = "ddagrab" | "gdigrab";

export type ScreenCaptureOptions = {
  outFile: string;
  fps: number;
  gop: number;
  encoder: string;
  drawMouse: boolean;
  /** D3D11 adapter index for ddagrab; ignored by gdigrab. */
  adapterIndex: number;
  /** DXGI output index on that adapter; ignored by gdigrab. */
  outputIndex: number;
};

export type RecordedVideoInfo = {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
};

/**
 * ddagrab is preferred — it is GPU-side Desktop Duplication and can hand frames
 * straight to a hardware encoder on the same adapter.
 *
 * gdigrab is the fallback and is genuinely worse: GDI readback is CPU-bound
 * and cannot capture protected or some hardware-composited surfaces.
 *
 * Measured at 1080p on 2026-09-06, counting real frames rather than trusting
 * avg_frame_rate (which reports a nominal container rate and is how a bogus
 * "44fps" figure got into these notes once): bare ffmpeg reaches 21.9fps when
 * asked for 30 and 28.6fps when asked for 60. Inside the app, where ffmpeg
 * competes with Electron, audio capture and telemetry, it lands at 27-30fps
 * whichever is requested.
 *
 * So asking for more than you expect is worth something, but ~28fps is the
 * ceiling here. Anything better needs ddagrab, which reaches ~58fps of a
 * requested 60 on the same machine.
 *
 * **The chain does not use `scale_d3d11`, and must not.** It was the obvious
 * filter for this — BGRA to NV12 without leaving the GPU — and it fails on this
 * AMD iGPU with `Could not create the texture (80070057)`, E_INVALIDARG, when
 * the frames context allocates its NV12 texture array. Feeding the BGRA D3D11
 * frames straight to `h264_amf` instead fails too: AMF takes the surfaces and
 * then errors on the first frame.
 *
 * `hwdownload,format=bgra,format=nv12` is what actually works, and it costs
 * nothing measurable — 58.3fps against the 58fps ddagrab manages on its own
 * with no encoder attached at all. The download is free because the capturing
 * GPU is the integrated one and its memory is system memory.
 *
 * `format=nv12` is not optional. Left to itself ffmpeg picks `yuvj420p` and
 * writes a full-range file, which would disagree with the limited-range
 * `yuv420p` the gdigrab path produces — the same take would grade differently
 * depending on which backend recorded it.
 */
export function buildCaptureArgs(
  backend: CaptureBackend,
  opts: ScreenCaptureOptions,
): string[] {
  const common = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    // The first progress block is what timestamps t=0 for telemetry and
    // audio (see start()). At the default 0.5s period that anchor landed up
    // to 500ms late; 20ms keeps it within a frame or two of the real first
    // frame. The match in start() stays `frame >= 1` because at 30fps the
    // first block can still say frame=0.
    "-stats_period",
    "0.02",
    "-nostats",
  ];

  // gdigrab hands over BGRA and needs telling what to encode to. The ddagrab
  // chain has already settled on nv12 in the filtergraph, and repeating it as
  // -pix_fmt inserts an auto_scale the D3D11 frames cannot pass through:
  // "Impossible to convert between the formats supported by the filter
  // 'Parsed_scale_d3d11_1' and the filter 'auto_scale_0'".
  const encode = (pixFmt: string | null): string[] => [
    "-c:v",
    opts.encoder,
    "-g",
    String(opts.gop),
    "-keyint_min",
    String(opts.gop),
    "-sc_threshold",
    "0",
    ...(pixFmt === null ? [] : ["-pix_fmt", pixFmt]),
    // Fragmented, so an abnormal exit still leaves a playable file
    "-movflags",
    "+frag_keyframe+empty_moov",
    opts.outFile,
  ];

  if (backend === "ddagrab") {
    const mouse = opts.drawMouse ? 1 : 0;
    return [
      ...common,
      "-init_hw_device",
      `d3d11va=dx:${opts.adapterIndex}`,
      "-filter_complex",
      `ddagrab=output_idx=${opts.outputIndex}:draw_mouse=${mouse}:framerate=${opts.fps},` +
        `hwdownload,format=bgra,format=nv12`,
      ...encode(null),
    ];
  }

  return [
    ...common,
    "-f",
    "gdigrab",
    "-framerate",
    String(opts.fps),
    "-draw_mouse",
    opts.drawMouse ? "1" : "0",
    "-i",
    "desktop",
    ...encode("yuv420p"),
  ];
}

export type CaptureTarget = DuplicationPair & { backend: CaptureBackend };

export type DiagLog = (where: string, detail: unknown) => void;

/** One ddagrab open, classified. Never throws; the stderr is the answer. */
async function probeDuplication(
  adapterIndex: number,
  outputIndex: number,
): Promise<ReturnType<typeof classifyProbe>> {
  try {
    await run(
      resolveFfmpeg(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-init_hw_device",
        `d3d11va=dx:${adapterIndex}`,
        "-filter_complex",
        `ddagrab=output_idx=${outputIndex}:framerate=30`,
        "-t",
        "0.3",
        "-f",
        "null",
        "-",
      ],
      { timeout: 15_000 },
    );
    return classifyProbe(0, "");
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return classifyProbe(e.code ?? 1, e.stderr ?? "");
  }
}

/**
 * Find a usable Desktop Duplication target, or settle for GDI.
 *
 * Three things here are deliberate, and all three are the 2026-09-08 bug:
 *
 * 1. It sweeps. The old probe took one hardcoded adapter and `output_idx=0`,
 *    which is only ever right by luck.
 * 2. It logs. The old probe was `catch { return "gdigrab" }`, so a machine
 *    silently capturing at half rate looked exactly like a machine without
 *    Desktop Duplication, and the reason had to be rediscovered by hand.
 * 3. If nothing duplicates, it pins ffmpeg to the integrated GPU and sweeps
 *    once more. On a hybrid laptop that is the whole difference — see
 *    gpuPreference.ts. Machines whose first sweep succeeds are never touched.
 */
export async function probeCapture(log: DiagLog): Promise<CaptureTarget> {
  const first = await sweepDuplication(probeDuplication);
  if (first.pair !== null) {
    log("capture:probe", `ddagrab on dx:${first.pair.adapterIndex} output ${first.pair.outputIndex}`);
    return { backend: "ddagrab", ...first.pair };
  }

  log("capture:probe", `no output duplicated: ${first.refusals.join("; ") || "none offered"}`);

  let exePath: string;
  try {
    exePath = await resolveFfmpegExePath();
  } catch (err) {
    log("capture:probe", err);
    return { backend: "gdigrab", adapterIndex: 0, outputIndex: 0 };
  }

  let pinned: boolean;
  try {
    pinned = await pinToIntegratedGpu(exePath);
  } catch (err) {
    log("capture:probe", err);
    return { backend: "gdigrab", adapterIndex: 0, outputIndex: 0 };
  }

  if (!pinned) {
    log("capture:probe", `${exePath} was already on the integrated GPU; falling back to gdigrab`);
    return { backend: "gdigrab", adapterIndex: 0, outputIndex: 0 };
  }

  log("capture:probe", `pinned ${exePath} to the integrated GPU; re-sweeping`);

  const second = await sweepDuplication(probeDuplication);
  if (second.pair !== null) {
    log(
      "capture:probe",
      `ddagrab on dx:${second.pair.adapterIndex} output ${second.pair.outputIndex} after GPU pin`,
    );
    return { backend: "ddagrab", ...second.pair };
  }

  log("capture:probe", `still nothing after GPU pin: ${second.refusals.join("; ") || "none offered"}`);
  return { backend: "gdigrab", adapterIndex: 0, outputIndex: 0 };
}

/** Read back what was actually recorded, rather than trusting what was asked for. */
export async function probeRecording(file: string): Promise<RecordedVideoInfo> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,avg_frame_rate:format=duration",
    "-of",
    "default=nw=1",
    file,
  ]);

  const field = (name: string): string =>
    new RegExp(`^${name}=(.+)$`, "m").exec(stdout)?.[1]?.trim() ?? "";

  const [num, den] = field("avg_frame_rate").split("/");
  const fps =
    num !== undefined && den !== undefined && Number(den) !== 0
      ? Number(num) / Number(den)
      : 0;

  return {
    width: Number(field("width")),
    height: Number(field("height")),
    fps: Number.isFinite(fps) && fps > 0 ? fps : 0,
    durationMs: Math.round(Number(field("duration")) * 1000),
  };
}

/**
 * A running screen capture.
 *
 * `start` does not resolve until ffmpeg reports its first frame, so the caller
 * can treat that instant as the recording's t=0 and stamp telemetry against it.
 * That is what makes `video.startOffsetMs` zero by construction instead of
 * something to measure and correct later.
 */
export class ScreenSource {
  private stderr = "";
  private exited = false;
  private exitCode: number | null = null;
  private readonly closed: Promise<void>;

  private constructor(
    private readonly child: ChildProcess,
    readonly backend: CaptureBackend,
    readonly startedAtUnixMs: number,
  ) {
    this.closed = new Promise<void>((resolve) => {
      child.on("close", (code) => {
        this.exited = true;
        this.exitCode = code;
        resolve();
      });
    });
  }

  static async start(
    backend: CaptureBackend,
    opts: ScreenCaptureOptions,
  ): Promise<ScreenSource> {
    const child = spawn(resolveFfmpeg(), buildCaptureArgs(backend, opts), {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    // Wall-clock time of the first captured frame, as near as ffmpeg lets us
    // observe it: the first -progress block reporting frame >= 1. With
    // -stats_period 0.02 that is within ~20ms plus one frame.
    const firstFrame = new Promise<number>((resolve, reject) => {
      let buffer = "";

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        buffer += chunk;
        const match = /frame=\s*(\d+)/.exec(buffer);
        if (match !== null && Number(match[1]) >= 1) resolve(Date.now());
      });

      child.on("close", (code) => {
        reject(
          new Error(
            `capture exited ${code} before producing a frame\n${stderr.trim()}`,
          ),
        );
      });

      setTimeout(() => reject(new Error("capture produced no frame within 10s")), 10_000);
    });

    const startedAt = await firstFrame;
    const source = new ScreenSource(child, backend, startedAt);
    source.stderr = stderr;
    return source;
  }

  /** Ask ffmpeg to finish cleanly so the file gets a proper moov atom. */
  async stop(): Promise<void> {
    if (this.exited) return;

    this.child.stdin?.write("q");
    this.child.stdin?.end();

    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([this.closed, timeout]);

    if (!this.exited) this.child.kill();
  }

  get unclean(): boolean {
    return this.exitCode !== 0 && this.exitCode !== 255;
  }

  get diagnostics(): string {
    return this.stderr.trim();
  }
}
