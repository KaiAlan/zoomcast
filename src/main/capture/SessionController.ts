import { app, screen } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "../../shared/bundle/manifest";
import { pickEncoder } from "../ffmpeg";
import {
  type CaptureBackend,
  probeBackend,
  probeRecording,
  ScreenSource,
} from "./ScreenSource";
import { TelemetryRecorder } from "./TelemetryRecorder";

const DDAGRAB_FPS = 60;
const GDIGRAB_FPS = 30;
const GOP_SECONDS = 0.5;

export type RecordingResult = {
  dir: string;
  backend: CaptureBackend;
  durationMs: number;
  unclean: boolean;
};

export function recordingsRoot(): string {
  const local = process.env.LOCALAPPDATA;
  return local === undefined
    ? join(app.getPath("userData"), "recordings")
    : join(local, "zoomcast", "recordings");
}

function newBundleId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

type Active = {
  id: string;
  dir: string;
  screenSource: ScreenSource;
  telemetry: TelemetryRecorder;
  clockBaseMs: number;
  backend: CaptureBackend;
  requestedFps: number;
};

let active: Active | null = null;
let cachedBackend: CaptureBackend | null = null;
let cachedEncoder: string | null = null;

export function isRecording(): boolean {
  return active !== null;
}

/**
 * Begin recording.
 *
 * Order matters: the screen capture is started first and awaited until it
 * reports a frame, and only then does telemetry begin, with that instant as the
 * clock base. That makes `video.startOffsetMs` zero by construction rather than
 * something to measure and compensate for later. The cost is losing telemetry
 * from the first few hundred milliseconds, which is countdown time anyway.
 */
export async function startRecording(): Promise<void> {
  if (active !== null) throw new Error("already recording");

  const id = newBundleId();
  const dir = join(recordingsRoot(), id);
  mkdirSync(dir, { recursive: true });

  const display = screen.getPrimaryDisplay();

  cachedEncoder ??= await pickEncoder();
  cachedBackend ??= await probeBackend(1);

  const backend = cachedBackend;
  const requestedFps = backend === "ddagrab" ? DDAGRAB_FPS : GDIGRAB_FPS;

  const screenSource = await ScreenSource.start(backend, {
    outFile: join(dir, "screen.mp4"),
    fps: requestedFps,
    gop: Math.round(requestedFps * GOP_SECONDS),
    encoder: cachedEncoder,
    drawMouse: false,
    adapterIndex: 1,
  });

  const clockBaseMs = screenSource.startedAtUnixMs;
  const telemetry = TelemetryRecorder.start(join(dir, "input.jsonl"), clockBaseMs);

  active = { id, dir, screenSource, telemetry, clockBaseMs, backend, requestedFps };
  void display;
}

export async function stopRecording(): Promise<RecordingResult> {
  const session = active;
  if (session === null) throw new Error("not recording");
  active = null;

  await session.telemetry.stop();
  await session.screenSource.stop();

  const display = screen.getPrimaryDisplay();
  const recorded = await probeRecording(join(session.dir, "screen.mp4"));

  const fps = recorded.fps > 0 ? recorded.fps : session.requestedFps;

  // The manifest describes what was actually captured, not what was requested.
  // gdigrab in particular rarely sustains the frame rate it is asked for, and
  // the editor's frame mapping trusts these numbers.
  const manifest: Manifest = {
    version: 1,
    id: session.id,
    createdAt: new Date(session.clockBaseMs).toISOString(),
    clockBaseUnixMs: session.clockBaseMs,
    status: session.screenSource.unclean ? "unclean" : "clean",
    durationMs: recorded.durationMs,
    display: {
      adapter: session.backend,
      outputIdx: 0,
      width: recorded.width,
      height: recorded.height,
      refreshHz: display.displayFrequency > 0 ? display.displayFrequency : 60,
      scale: display.scaleFactor,
    },
    video: {
      file: "screen.mp4",
      codec: "h264",
      encoder: cachedEncoder ?? "unknown",
      width: recorded.width,
      height: recorded.height,
      fps,
      gop: Math.round(fps * GOP_SECONDS),
      drawMouse: false,
      startOffsetMs: 0,
    },
    audio: [],
    telemetry: { file: "input.jsonl", hasCursorShapes: false },
  };

  writeFileSync(
    join(session.dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return {
    dir: session.dir,
    backend: session.backend,
    durationMs: recorded.durationMs,
    unclean: session.screenSource.unclean,
  };
}

/** Best-effort teardown for app quit. */
export async function abortRecording(): Promise<void> {
  if (active === null) return;
  try {
    await stopRecording();
  } catch {
    active = null;
  }
}
