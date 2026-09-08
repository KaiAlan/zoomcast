import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Resolve the ffmpeg binary.
 *
 * REVERSED on 2026-09-08. This used to read "ffmpeg is deliberately NOT
 * vendored: the target machine already has it on PATH". That was true of the
 * one machine it was written on and false of every other: the installer
 * succeeded on a clean machine and then failed at record time, with no signal
 * until someone pressed the hotkey.
 *
 * The blocker was never size, it was `ddagrab`. Capture needs it (see
 * `probeFilters` below) and a generic ffmpeg build may not carry it, so
 * bundling the wrong binary would have broken a working install rather than
 * fixing a broken one. Probed before committing to it: ffmpeg-static ships
 * gyan.dev's 6.1.1 essentials build, which has ddagrab, h264_amf, h264_nvenc
 * and libx264 — everything this app asks for.
 *
 * Order: the ZOOMCAST_FFMPEG override, then the bundled binary, then PATH.
 * The override stays first so a newer or differently-built ffmpeg can still be
 * pointed at without a rebuild, and PATH stays last so a dev checkout without
 * node_modules still works.
 */
function bundledFfmpeg(): string | null {
  // Packaged: electron-builder's extraResources puts it beside the asar rather
  // than inside it — an 80MB binary has no business in the archive, and an
  // executable cannot be spawned from within one anyway.
  //
  // Guarded because `process.resourcesPath` is an Electron addition and is
  // undefined under plain Node. exportRunner is reached by the e2e suite
  // directly, outside Electron, where an unguarded join() throws
  // "The path argument must be of type string".
  const resources: string | undefined = process.resourcesPath;
  if (typeof resources === "string" && resources !== "") {
    const packaged = join(resources, "ffmpeg.exe");
    if (existsSync(packaged)) return packaged;
  }

  // Dev and the verify tools, which all run from the project root.
  const dev = join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe");
  if (existsSync(dev)) return dev;

  return null;
}

export function resolveFfmpeg(): string {
  return process.env.ZOOMCAST_FFMPEG ?? bundledFfmpeg() ?? "ffmpeg";
}

export async function probeEncoders(bin = resolveFfmpeg()): Promise<string[]> {
  const { stdout } = await run(bin, ["-hide_banner", "-encoders"], {
    maxBuffer: 8 * 1024 * 1024,
  });

  return [...stdout.matchAll(/^\s*\S+\s+(\S+)/gm)].map((m) => m[1] ?? "");
}

export async function probeFilters(bin = resolveFfmpeg()): Promise<string[]> {
  const { stdout } = await run(bin, ["-hide_banner", "-filters"], {
    maxBuffer: 8 * 1024 * 1024,
  });

  return [...stdout.matchAll(/^\s*\S+\s+(\S+)/gm)].map((m) => m[1] ?? "");
}

/**
 * Pick the best available capture encoder.
 *
 * h264_amf leads because ddagrab produces D3D11 frames on the AMD adapter that
 * drives the display — encoding on the same adapter means frames never leave
 * the GPU. NVENC would need a cross-adapter round trip through system RAM for
 * quality the export re-encodes away.
 */
export async function pickEncoder(bin = resolveFfmpeg()): Promise<string> {
  const available = new Set(await probeEncoders(bin));

  for (const candidate of ["h264_amf", "h264_nvenc", "libx264"]) {
    if (available.has(candidate)) return candidate;
  }

  throw new Error(`no usable H.264 encoder in ${bin}`);
}

/** Refuse to record rather than fail obscurely later. */
export async function assertCapable(bin = resolveFfmpeg()): Promise<void> {
  const filters = new Set(await probeFilters(bin));
  if (!filters.has("ddagrab")) {
    throw new Error(
      `ffmpeg at "${bin}" has no ddagrab filter — screen capture needs ffmpeg 6.0+ built with it`,
    );
  }
}
