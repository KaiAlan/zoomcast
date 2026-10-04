import { execFile } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { app } from "electron";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Packaged builds always use their verified tools; development retains PATH. */
export function resolveFfmpeg(): string {
  return resolveMediaTool("ffmpeg");
}

export function resolveFfprobe(): string {
  return resolveMediaTool("ffprobe");
}

function resolveMediaTool(tool: "ffmpeg" | "ffprobe"): string {
  const override = process.env[tool === "ffmpeg" ? "ZOOMCAST_FFMPEG" : "ZOOMCAST_FFPROBE"];
  if (override !== undefined && override.trim() !== "") return override;
  return app?.isPackaged ? join(process.resourcesPath, "ffmpeg", `${tool}.exe`) : tool;
}

/**
 * The same binary, as an absolute path.
 *
 * Windows' per-application GPU preference is keyed on the full path of the
 * executable, so "ffmpeg" is not enough to pin it — see gpuPreference.ts.
 */
export async function resolveFfmpegExePath(): Promise<string> {
  const bin = resolveFfmpeg();
  if (isAbsolute(bin)) return bin;

  const { stdout } = await run("where.exe", [bin], { timeout: 10_000 });
  const first = stdout.split("\n")[0]?.trim();
  if (first === undefined || first === "") throw new Error(`could not locate "${bin}" on PATH`);
  return first;
}

/**
 * Every filter the capture chain needs, not just the headline one.
 *
 * `hwdownload` and `format` are core filters present in every build, so in
 * practice this gates on `ddagrab` alone today. They are listed anyway: the
 * lesson from bundling an essentials build was that the chain is the contract,
 * and a chain that is only half-checked is how that got missed.
 */
export const REQUIRED_CAPTURE_FILTERS = ["ddagrab", "hwdownload", "format"] as const;

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
      app?.isPackaged
        ? `The bundled recording tools are unavailable. Reinstall Zoomcast to restore them.`
        : `ffmpeg was not found. Install a FULL ffmpeg build (gyan.dev "full" or ` +
      `BtbN's, 6.0+) and put it on PATH, or point ZOOMCAST_FFMPEG at one. ` +
      `Screen capture needs the ddagrab filter, which the "essentials" ` +
      `builds do not carry.`
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
 * h264_amf leads because ddagrab captures on the AMD adapter that drives the
 * display, and encoding on the same adapter keeps the frames on one GPU. NVENC
 * would mean a cross-adapter round trip for quality the export re-encodes away.
 *
 * The frames do now land in system memory on the way — `hwdownload` is in the
 * chain because scale_d3d11 will not run here — but on an integrated GPU that
 * is a memcpy in shared memory and measured free. Encoding on the other adapter
 * would not be.
 */
export async function pickEncoder(bin = resolveFfmpeg()): Promise<string> {
  const available = new Set(await probeEncoders(bin));

  for (const candidate of ["h264_amf", "h264_nvenc", "libx264"]) {
    if (!available.has(candidate)) continue;
    try {
      await run(bin, ["-v", "error", "-f", "lavfi", "-i", "color=s=320x180:r=30", "-frames:v", "1", "-c:v", candidate, "-f", "null", "-"], { timeout: 10000 });
      return candidate;
    } catch { /* Compiled-in hardware support does not guarantee a working driver. */ }
  }

  throw new Error(`no usable H.264 encoder in ${bin}`);
}

