import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/fixtures/basic/manifest.json";
import { ManifestSchema } from "../../shared/bundle/manifest";
import { defaultProject } from "../../shared/project/defaults";
import type { Renderer } from "../gl/Renderer";
import type { VideoSource } from "./VideoSource";
import { openExportFrameWriter, type ExportFrameWriter } from "./ExportFrameWriter";
import { exportClip } from "./exportClip";

vi.mock("./ExportFrameWriter", () => ({ openExportFrameWriter: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const manifest = ManifestSchema.parse({ ...fixture, durationMs: 300, audio: [] });
  const project = defaultProject(manifest.id);
  project.output = { ...project.output, fps: 10, width: 32, height: 32 };
  const api = { exportStart: vi.fn(async () => "session"), exportFinish: vi.fn(async () => {}), exportCancel: vi.fn(async () => {}) };
  vi.stubGlobal("window", { zoomcast: api });
  const writer = { write: vi.fn(async (_frame: Uint8Array) => {}), close: vi.fn() };
  vi.mocked(openExportFrameWriter).mockResolvedValue(writer as unknown as ExportFrameWriter);
  const handles = Array.from({ length: 3 }, () => ({ image: {} as TexImageSource, release: vi.fn() }));
  let sample = 0;
  let pixel = 0;
  const source = { frameAt: vi.fn(async () => handles[sample++]!) };
  const renderer = { drawFrame: vi.fn(), readPixels: vi.fn(() => new Uint8Array([pixel++, 0, 0, 255])) };
  const signal = { cancelled: false };
  const onProgress = vi.fn();
  const onTimings = vi.fn();
  return { api, writer, handles, source, renderer, signal, onProgress, onTimings, opts: {
    manifest, project, cursorPath: null, clicks: [], mediaDir: "bundle", outFile: "out.mp4", encoder: "libx264",
    source: source as unknown as VideoSource, renderer: renderer as unknown as Renderer, signal, onProgress, onTimings,
  } };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("pipelined export", () => {
  it("prepares only one next frame and drains the last write before finishing", async () => {
    const { opts, api, writer, renderer, handles, onProgress, onTimings } = setup();
    const first = deferred<void>();
    const last = deferred<void>();
    writer.write.mockImplementationOnce(() => first.promise).mockImplementationOnce(async () => {}).mockImplementationOnce(() => last.promise);
    const exportResult = exportClip(opts);
    await vi.waitFor(() => expect(renderer.readPixels).toHaveBeenCalledTimes(2));
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(api.exportFinish).not.toHaveBeenCalled();
    first.resolve();
    await vi.waitFor(() => expect(writer.write).toHaveBeenCalledTimes(3));
    expect(api.exportFinish).not.toHaveBeenCalled();
    expect(onProgress.mock.calls.some(([progress]) => progress.phase === "done")).toBe(false);
    last.resolve();
    expect(await exportResult).toBe(true);
    expect(api.exportFinish).toHaveBeenCalledOnce();
    expect(api.exportCancel).not.toHaveBeenCalled();
    expect(writer.write.mock.calls.map(([pixels]) => pixels[0])).toEqual([0, 1, 2]);
    for (const handle of handles) expect(handle.release).toHaveBeenCalledOnce();
    expect(onTimings).toHaveBeenCalledWith(expect.objectContaining({ frames: 3, pipelined: true }));
    expect(writer.close).toHaveBeenCalledOnce();
  });

  it("observes encoder failure while the next decode is pending and cancels", async () => {
    const { opts, api, writer, source, handles } = setup();
    const firstWrite = deferred<void>();
    const nextDecode = deferred<(typeof handles)[number]>();
    writer.write.mockImplementationOnce(() => firstWrite.promise);
    source.frameAt.mockImplementationOnce(async () => handles[0]!).mockImplementationOnce(() => nextDecode.promise);
    const failed = expect(exportClip(opts)).rejects.toThrow("encoder failed");
    await vi.waitFor(() => expect(source.frameAt).toHaveBeenCalledTimes(2));
    firstWrite.reject(new Error("encoder failed"));
    await Promise.resolve();
    nextDecode.resolve(handles[1]!);
    await failed;
    expect(api.exportCancel).toHaveBeenCalledWith("session", expect.stringContaining("encoder failed"));
    expect(writer.write).toHaveBeenCalledOnce();
    expect(api.exportFinish).not.toHaveBeenCalled();
    expect(handles[0]!.release).toHaveBeenCalledOnce();
    expect(handles[1]!.release).toHaveBeenCalledOnce();
    expect(writer.close).toHaveBeenCalledOnce();
  });

  it("cancels after waiting for a write without submitting the prepared frame", async () => {
    const { opts, api, writer, renderer, signal, onProgress } = setup();
    const first = deferred<void>();
    writer.write.mockImplementationOnce(() => first.promise);
    const exportResult = exportClip(opts);
    await vi.waitFor(() => expect(renderer.readPixels).toHaveBeenCalledTimes(2));
    signal.cancelled = true;
    first.resolve();
    expect(await exportResult).toBe(false);
    expect(writer.write).toHaveBeenCalledOnce();
    expect(api.exportCancel).toHaveBeenCalledOnce();
    expect(api.exportFinish).not.toHaveBeenCalled();
    expect(onProgress.mock.calls.some(([progress]) => progress.phase === "done")).toBe(false);
    expect(writer.close).toHaveBeenCalledOnce();
  });

  it("does not finish successfully if cancellation arrives during the last write", async () => {
    const { opts, api, writer, signal } = setup();
    writer.write.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {}).mockImplementationOnce(async () => { signal.cancelled = true; });
    expect(await exportClip(opts)).toBe(false);
    expect(api.exportCancel).toHaveBeenCalledWith("session", "cancelled before finishing");
    expect(api.exportFinish).not.toHaveBeenCalled();
  });

  it("cancels the encoder when channel setup fails", async () => {
    const { opts, api, source } = setup();
    vi.mocked(openExportFrameWriter).mockRejectedValueOnce(new Error("channel unavailable"));
    await expect(exportClip(opts)).rejects.toThrow("channel unavailable");
    expect(api.exportCancel).toHaveBeenCalledWith("session", expect.stringContaining("channel unavailable"));
    expect(source.frameAt).not.toHaveBeenCalled();
  });
});
