import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Resolve the ffmpeg binary. ffmpeg is deliberately NOT vendored: the target
 * machine already has it on PATH, and a ~100MB binary in a single-user repo
 * buys nothing.
 *
 * Order: the ZOOMCAST_FFMPEG override, then PATH.
 */
export function resolveFfmpeg(): string {
  return process.env.ZOOMCAST_FFMPEG ?? "ffmpeg";
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
