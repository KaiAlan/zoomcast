import { app, screen } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "../../shared/bundle/manifest";
import { pickEncoder } from "../ffmpeg";
import { logDiag } from "../log";
import { AudioRecorder, type AudioRole, type AudioTrackResult } from "./AudioRecorder";
import {
  type CaptureBackend,
  probeBackend,
  probeRecording,
  ScreenSource,
} from "./ScreenSource";
import { TelemetryRecorder } from "./TelemetryRecorder";
import { loadSettings } from "../settingsStore";

/**
 * ddagrab is GPU-side and delivers close to what it is asked for, so it is not
 * user-tunable — there is no trade-off to offer. gdigrab is CPU-bound readback
 * and gets whatever it manages, which is why the setting exists.
 */
const DDAGRAB_FPS = 60;
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
  audio: AudioRecorder | null;
  audioStarted: Array<{ role: AudioRole; startedAtUnixMs: number }>;
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
 * Order matters. Audio starts first, because device warm-up costs a few hundred
 * milliseconds and starting it later would clip the head of every take. Then
 * the screen capture starts and is awaited until it reports a frame, and that
 * instant becomes the clock base — which makes `video.startOffsetMs` zero by
 * construction rather than something to measure and correct later. Telemetry
 * starts last, against the same base.
 *
 * Audio therefore has negative offsets, which is the convention
 * `toStreamLocalMs` already uses and which ffmpeg's `-itsoffset` accepts.
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
  const requestedFps = backend === "ddagrab" ? DDAGRAB_FPS : loadSettings().captureFps;

  // Audio first: device warm-up costs a few hundred milliseconds, and starting
  // it after the screen would silently clip the head of every take. Starting it
  // earlier makes its offsets negative, which is the same convention
  // toStreamLocalMs uses and which -itsoffset accepts directly.
  let audio: AudioRecorder | null = null;
  let audioStarted: Array<{ role: AudioRole; startedAtUnixMs: number }> = [];

  try {
    audio = await AudioRecorder.open(dir);
    audioStarted = await audio.start(["mic", "system"]);
  } catch (err) {
    logDiag("audio:start", err);
    audio = null;
    audioStarted = [];
  }

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

  active = {
    id,
    dir,
    screenSource,
    telemetry,
    audio,
    audioStarted,
    clockBaseMs,
    backend,
    requestedFps,
  };
  void display;
}

export async function stopRecording(): Promise<RecordingResult> {
  const session = active;
  if (session === null) throw new Error("not recording");
  active = null;

  await session.telemetry.stop();
  await session.screenSource.stop();

  let audioTracks: AudioTrackResult[] = [];
  if (session.audio !== null) {
    try {
      audioTracks = await session.audio.stop(session.clockBaseMs, session.audioStarted);
    } catch (err) {
      logDiag("audio:stop", err);
    }
  }

  const display = screen.getPrimaryDisplay();
  const recorded = await probeRecording(join(session.dir, "screen.mp4"));

  const fps = recorded.fps > 0 ? recorded.fps : session.requestedFps;

  // Requested vs achieved, on every take. Capture had the same blind spot the
  // export path did: nothing recorded what was asked for, so a recording that
  // came out at half the requested rate left no way to tell whether the
  // request or the machine was at fault.
  logDiag(
    "capture:rate",
    `backend=${session.backend} requested=${session.requestedFps} achieved=${fps.toFixed(2)} ` +
      `size=${recorded.width}x${recorded.height} durationMs=${recorded.durationMs}`,
  );

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
    audio: audioTracks.map((track) => ({
      role: track.role,
      file: track.file,
      codec: "opus",
      startOffsetMs: track.startOffsetMs,
    })),
    telemetry: {
      file: "input.jsonl",
      hasCursorShapes: session.telemetry.hasCursorShapes,
    },
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
