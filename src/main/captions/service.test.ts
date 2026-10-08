import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
vi.mock("electron", () => ({ app: { isPackaged: false } }));
import { CaptionService } from "./service";

afterEach(() => { vi.unstubAllGlobals(); });
describe("offline speech lifecycle", () => {
  it("does no startup download and removes crash leftovers without touching unrelated files", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "caption-service-"));
    const root = join(temporary, "speech");
    const service = new CaptionService(root);
    try {
      expect(service.state().installed).toBe(false);
      await expect(stat(root)).rejects.toThrow();
      await mkdir(join(root, ".install-00000000-0000-0000-0000-000000000000"), { recursive: true });
      await mkdir(join(root, ".transcribe-11111111-1111-1111-1111-111111111111"));
      await writeFile(join(root, "keep.txt"), "keep");
      vi.stubGlobal("fetch", async () => { throw new Error("Test connection failure"); });
      await expect(service.install()).rejects.toThrow("Test connection failure");
      expect(service.state().busy).toBe(false);
      expect(service.state().installed).toBe(false);
      await expect(stat(join(root, ".install-00000000-0000-0000-0000-000000000000"))).rejects.toThrow();
      await expect(stat(join(root, ".transcribe-11111111-1111-1111-1111-111111111111"))).rejects.toThrow();
      expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("keep");
      await expect(service.generate("recording", "mic", "auto")).rejects.toThrow("Download offline transcription first");
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
  it("blocks concurrent work, cancels cleanly, and allows retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "caption-service-"));
    let requested = false;
    vi.stubGlobal("fetch", (_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      requested = true;
      if (options.signal.aborted) reject(new Error("Aborted"));
      else options.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
    }));
    const service = new CaptionService(root);
    try {
      const installation = service.install();
      // Observe the rejection immediately while the cancellation is triggered.
      const rejected = expect(installation).rejects.toThrow("cancelled");
      await vi.waitFor(() => expect(requested).toBe(true));
      expect(service.state().busy).toBe(true);
      await expect(service.install()).rejects.toThrow("Another caption task");
      await expect(service.remove()).rejects.toThrow("Cancel the caption task");
      service.cancel();
      await rejected;
      expect(service.state().busy).toBe(false);
      vi.stubGlobal("fetch", async () => { throw new Error("Retry attempted"); });
      await expect(service.install()).rejects.toThrow("Retry attempted");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
