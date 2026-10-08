import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESKTOP_BACKGROUND_FILE } from "../shared/style/desktopBackground";
import { prepareRecordingBackground, snapshotDesktopBackground } from "./desktopBackground";
import { DEFAULT_IMAGE_PRESET } from "../shared/style/imagePresets";

const mocks = vi.hoisted(() => ({ getWallpaper: vi.fn(), decode: vi.fn(), appPath: vi.fn(), log: vi.fn(), copyPreset: vi.fn() }));
vi.mock("electron", () => ({ app: { getPath: mocks.appPath }, nativeImage: { createFromBuffer: mocks.decode } }));
vi.mock("koffi", () => ({ default: { load: () => ({ func: () => mocks.getWallpaper }) } }));
vi.mock("./log", () => ({ logDiag: mocks.log }));
vi.mock("./backgroundImages", () => ({ copyBackgroundPreset: mocks.copyPreset }));

let root: string;
let source: string;
let cached: string;
beforeEach(() => {
  vi.resetAllMocks();
  root = mkdtempSync(join(tmpdir(), "zoomcast-wallpaper-"));
  source = join(root, "applied-wallpaper");
  cached = join(root, "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
  mocks.appPath.mockReturnValue(root);
  mocks.getWallpaper.mockImplementation((action: number, capacity: number, buffer: Buffer, flags: number) => {
    expect(action).toBe(0x0073); expect(capacity).toBe(buffer.length / 2); expect(flags).toBe(0);
    buffer.write(`${source}\0`, "utf16le");
    return 1;
  });
  mocks.decode.mockImplementation((bytes: Buffer) => ({ isEmpty: () => false, toPNG: () => Buffer.concat([Buffer.from("PNG:"), bytes]) }));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "win32")("desktop wallpaper snapshots", () => {
  it("takes a fresh recording-local copy of the applied, extensionless image", () => {
    writeFileSync(source, "first");
    snapshotDesktopBackground(root);
    expect(readFileSync(join(root, DESKTOP_BACKGROUND_FILE), "utf8")).toBe("PNG:first");
    writeFileSync(source, "second");
    const next = join(root, "next-take"); mkdirSync(next);
    snapshotDesktopBackground(next);
    expect(readFileSync(join(next, DESKTOP_BACKGROUND_FILE), "utf8")).toBe("PNG:second");
    expect(readFileSync(join(root, DESKTOP_BACKGROUND_FILE), "utf8")).toBe("PNG:first");
  });
  it("does not use a stale cached wallpaper on a Windows solid-color desktop", () => {
    mkdirSync(join(root, "Microsoft", "Windows", "Themes"), { recursive: true });
    writeFileSync(cached, "old image");
    source = "";
    snapshotDesktopBackground(root);
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(existsSync(join(root, DESKTOP_BACKGROUND_FILE))).toBe(false);
  });
  it("decodes the Windows transcoded copy if the original source cannot be decoded", () => {
    writeFileSync(source, "unsupported");
    mkdirSync(join(root, "Microsoft", "Windows", "Themes"), { recursive: true });
    writeFileSync(cached, "cached JPEG");
    mocks.decode.mockReturnValueOnce({ isEmpty: () => true });
    snapshotDesktopBackground(root);
    expect(readFileSync(join(root, DESKTOP_BACKGROUND_FILE), "utf8")).toBe("PNG:cached JPEG");
  });
  it("falls back without throwing when the wallpaper file is missing", () => {
    expect(() => snapshotDesktopBackground(root)).not.toThrow();
    expect(existsSync(join(root, DESKTOP_BACKGROUND_FILE))).toBe(false);
    expect(mocks.log).toHaveBeenCalled();
  });
  it("does not abort recording or replace a previous snapshot on a write failure", () => {
    writeFileSync(source, "current");
    writeFileSync(join(root, DESKTOP_BACKGROUND_FILE), "previous");
    expect(() => snapshotDesktopBackground(root)).not.toThrow();
    expect(readFileSync(join(root, DESKTOP_BACKGROUND_FILE), "utf8")).toBe("previous");
    expect(mocks.log).toHaveBeenCalled();
  });
  it("handles a failed Windows query without trying to load cached imagery", () => {
    mocks.getWallpaper.mockReturnValue(0);
    snapshotDesktopBackground(root);
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(existsSync(join(root, DESKTOP_BACKGROUND_FILE))).toBe(false);
  });
  it("uses a bundled image for a desktop with no wallpaper", () => {
    source = "";
    prepareRecordingBackground(root);
    expect(mocks.copyPreset).toHaveBeenCalledWith(root, DEFAULT_IMAGE_PRESET);
  });
  it("uses a bundled image when the applied wallpaper is unreadable", () => {
    prepareRecordingBackground(root);
    expect(mocks.copyPreset).toHaveBeenCalledWith(root, DEFAULT_IMAGE_PRESET);
  });
  it("prefers the applied wallpaper over a bundled image", () => {
    writeFileSync(source, "current");
    prepareRecordingBackground(root);
    expect(mocks.copyPreset).not.toHaveBeenCalled();
  });
  it("keeps recording possible even if the bundled image cannot be copied", () => {
    source = "";
    mocks.copyPreset.mockImplementation(() => { throw Error("Disk full"); });
    expect(() => prepareRecordingBackground(root)).not.toThrow();
    expect(mocks.log).toHaveBeenCalledWith("background:default-image", expect.any(Error));
  });
});
