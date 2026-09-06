import { type ChildProcess, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolveFfmpeg } from "../ffmpeg";

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
 * ceiling here. Anything better needs ddagrab. It exists because DDA is not always
 * available — on this machine's hybrid AMD/NVIDIA setup, neither adapter
 * enumerates a DXGI output at all ("Failed to enumerate DXGI output 0"), even
 * though GDI capture of the same desktop works fine.
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
    "-nostats",
  ];

  const encode = [
    "-c:v",
    opts.encoder,
    "-g",
    String(opts.gop),
    "-keyint_min",
    String(opts.gop),
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
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
      `ddagrab=output_idx=0:draw_mouse=${mouse}:framerate=${opts.fps},scale_d3d11=format=nv12`,
      ...encode,
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
    ...encode,
  ];
}

/** Does this machine actually have a usable Desktop Duplication output? */
export async function probeBackend(adapterIndex: number): Promise<CaptureBackend> {
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
        "ddagrab=output_idx=0:framerate=30",
        "-t",
        "0.3",
        "-f",
        "null",
        "-",
      ],
      { timeout: 15_000 },
    );
    return "ddagrab";
  } catch {
    return "gdigrab";
  }
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
