import { describe, expect, it } from "vitest";
import { gpuPreferenceArgs, parseGpuPreference, POWER_SAVING } from "./gpuPreference";

const FFMPEG = "C:\\Users\\x\\ffmpeg-9.0.1-full_build\\bin\\ffmpeg.exe";

describe("gpuPreferenceArgs", () => {
  it("writes power saving under the value name Windows keys on", () => {
    expect(gpuPreferenceArgs(FFMPEG)).toEqual([
      "add",
      "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences",
      "/v",
      FFMPEG,
      "/t",
      "REG_SZ",
      "/d",
      "GpuPreference=1;",
      "/f",
    ]);
  });

  it("pins to power saving, not high performance", () => {
    // GpuPreference=2 measured identical to no pin at all on 2026-09-08.
    expect(POWER_SAVING).toBe("GpuPreference=1;");
  });
});

describe("parseGpuPreference", () => {
  // reg.exe's real output. The value name is a path with spaces in it, which is
  // why this cannot just split on whitespace.
  const output = [
    "",
    "HKEY_CURRENT_USER\\Software\\Microsoft\\DirectX\\UserGpuPreferences",
    "    C:\\Program Files\\Blender Foundation\\blender.exe    REG_SZ    GpuPreference=2;",
    `    ${FFMPEG}    REG_SZ    GpuPreference=1;`,
    "",
  ].join("\n");

  it("finds the entry for the binary we asked about", () => {
    expect(parseGpuPreference(FFMPEG, output)).toBe("GpuPreference=1;");
  });

  it("does not confuse it with another application's entry", () => {
    expect(
      parseGpuPreference("C:\\Program Files\\Blender Foundation\\blender.exe", output),
    ).toBe("GpuPreference=2;");
  });

  it("matches case-insensitively, because Windows paths are", () => {
    expect(parseGpuPreference(FFMPEG.toUpperCase(), output)).toBe("GpuPreference=1;");
  });

  it("reports nothing for a binary with no entry", () => {
    expect(parseGpuPreference("C:\\nowhere\\ffmpeg.exe", output)).toBeNull();
  });
});
