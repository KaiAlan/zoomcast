import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
const state = vi.hoisted(() => ({ app: { isPackaged: false } }));
vi.mock("electron", () => ({ app: state.app }));
import { resolveFfmpeg, resolveFfprobe } from "./ffmpeg";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); state.app.isPackaged = false; });
describe("recording tools", () => {
  it("uses both packaged executables without depending on PATH", () => {
    state.app.isPackaged = true;
    vi.stubEnv("ZOOMCAST_FFMPEG", ""); vi.stubEnv("ZOOMCAST_FFPROBE", "");
    vi.stubGlobal("process", { ...process, resourcesPath: "C:/app/resources" });
    expect(resolveFfmpeg()).toBe(join("C:/app/resources", "ffmpeg", "ffmpeg.exe"));
    expect(resolveFfprobe()).toBe(join("C:/app/resources", "ffmpeg", "ffprobe.exe"));
  });
  it("retains explicit tool overrides", () => {
    state.app.isPackaged = true;
    vi.stubEnv("ZOOMCAST_FFMPEG", "C:/custom/ffmpeg.exe");
    vi.stubEnv("ZOOMCAST_FFPROBE", "C:/custom/ffprobe.exe");
    expect(resolveFfmpeg()).toBe("C:/custom/ffmpeg.exe");
    expect(resolveFfprobe()).toBe("C:/custom/ffprobe.exe");
  });
  it("uses PATH during development", () => {
    vi.stubEnv("ZOOMCAST_FFMPEG", ""); vi.stubEnv("ZOOMCAST_FFPROBE", "");
    expect(resolveFfmpeg()).toBe("ffmpeg"); expect(resolveFfprobe()).toBe("ffprobe");
  });
});
