import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Per-application GPU preference — the thing that decides whether ddagrab works
 * at all on a hybrid-graphics laptop.
 *
 * Measured on 2026-09-08, on an AMD iGPU + NVIDIA RTX 3050 machine where the
 * AMD drives the only panel. With no preference set, Windows hands ffmpeg the
 * NVIDIA, and the Optimus driver then rewrites DXGI enumeration for that
 * process: the panel's output is presented on the dGPU, and the AMD reports no
 * outputs at all. Desktop Duplication refuses the dGPU's copy, because the
 * desktop is really composited on the AMD.
 *
 *   pin absent            dx:0 = NVIDIA   ddagrab FAIL
 *   GpuPreference=2       dx:0 = NVIDIA   ddagrab FAIL   (identical to absent)
 *   GpuPreference=1       dx:0 = AMD      ddagrab OK
 *
 * So this is not a tuning knob, it is the difference between 32fps and 60fps.
 * Loom's recorder ships the same entry on the same machine.
 *
 * We only write it when the sweep has already failed outright, so a machine
 * where Desktop Duplication works never has its registry touched.
 */
const KEY = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";

/** 1 is "power saving", which on a hybrid laptop means the integrated GPU. */
export const POWER_SAVING = "GpuPreference=1;";

export function gpuPreferenceArgs(exePath: string, value: string = POWER_SAVING): string[] {
  return ["add", KEY, "/v", exePath, "/t", "REG_SZ", "/d", value, "/f"];
}

export function parseGpuPreference(exePath: string, regQueryOutput: string): string | null {
  // reg.exe prints "    <name>    REG_SZ    <data>", and the name is a full
  // path containing spaces, so anchor on the type rather than splitting.
  for (const line of regQueryOutput.split("\n")) {
    const match = /^\s*(.+?)\s+REG_SZ\s+(.*?)\s*$/.exec(line);
    if (match === undefined || match === null) continue;
    if (match[1]?.toLowerCase() === exePath.toLowerCase()) return match[2] ?? "";
  }
  return null;
}

export async function readGpuPreference(exePath: string): Promise<string | null> {
  try {
    const { stdout } = await run("reg.exe", ["query", KEY, "/v", exePath], {
      timeout: 10_000,
    });
    return parseGpuPreference(exePath, stdout);
  } catch {
    // The key or the value does not exist. Either way, nothing is pinned.
    return null;
  }
}

/**
 * Pin `exePath` to the integrated GPU.
 *
 * Returns whether anything changed — a caller that just failed a duplication
 * sweep should only re-sweep if it did, and `false` is also how "already
 * pinned, so this is not the problem" gets reported.
 */
export async function pinToIntegratedGpu(exePath: string): Promise<boolean> {
  if ((await readGpuPreference(exePath)) === POWER_SAVING) return false;

  await run("reg.exe", gpuPreferenceArgs(exePath), { timeout: 10_000 });
  return true;
}
