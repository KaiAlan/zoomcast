import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Resolve the ffmpeg binary. ffmpeg is deliberately NOT vendored.
 *
 * This was reversed on 2026-09-08 and reverted the same day, so the reason is
 * worth recording properly rather than being rediscovered a third time.
 *
 * The tempting fix for "a clean machine installs fine and then fails at record
 * time" is to bundle ffmpeg-static. It does not work. Capture runs
 * `ddagrab=...,scale_d3d11=format=nv12`, and while ffmpeg-static's 6.1.1
 * ESSENTIALS build has `ddagrab`, it does NOT have `scale_d3d11` — that filter
 * is only in the FULL builds. Bundling it therefore breaks capture on a
 * machine where capture previously worked, which is strictly worse than the
 * problem it set out to solve.
 *
 * Checking only `ddagrab` is not enough to clear a candidate binary. The whole
 * filter chain has to be there. `assertCaptureCapable` below is what actually
 * answers the question.
 *
 * Order: the ZOOMCAST_FFMPEG override, then PATH.
 */
export function resolveFfmpeg(): string {
  return process.env.ZOOMCAST_FFMPEG ?? "ffmpeg";
}

/** Every filter the capture chain needs, not just the headline one. */
export const REQUIRED_CAPTURE_FILTERS = ["ddagrab", "scale_d3d11"] as const;

/**
 * Fail loudly, at startup, with a message that says what to do.
 *
 * The failure this replaces was silent until the moment someone pressed the
 * hotkey, and then surfaced as "capture produced no frame within 10s" — which
 * names a symptom and not a cause.
 */
export async function captureCapabilityError(bin = resolveFfmpeg()): Promise<string | null> {
  let filters: string[];
  try {
    filters = await probeFilters(bin);
  } catch {
    return (
      `ffmpeg was not found. Install a FULL ffmpeg build (gyan.dev "full" or ` +
      `BtbN's, 6.0+) and put it on PATH, or point ZOOMCAST_FFMPEG at one. ` +
      `Screen capture needs the ddagrab and scale_d3d11 filters, which the ` +
      `"essentials" builds do not carry.`
    );
  }

  const have = new Set(filters);
  const missing = REQUIRED_CAPTURE_FILTERS.filter((f) => !have.has(f));
  if (missing.length === 0) return null;

  return (
    `ffmpeg at "${bin}" is missing ${missing.join(" and ")}, which screen ` +
    `capture needs. This is usually an "essentials" build; install a FULL ` +
    `ffmpeg 6.0+ build and put it on PATH, or point ZOOMCAST_FFMPEG at one.`
  );
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
