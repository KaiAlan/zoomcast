import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadAsset } from "./download";

describe("verified optional downloads", () => {
  it("streams verified content, rejects altered content and cleans up failed or cancelled downloads", async () => {
    const bytes = Buffer.from("verified optional download");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const server = createServer((req, res) => {
      if (req.url === "/slow") { res.writeHead(200); res.write(bytes.subarray(0, 1)); return; }
      if (req.url === "/missing") { res.writeHead(404); res.end(); return; }
      res.end(bytes);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");
    const url = `http://127.0.0.1:${address.port}`;
    const dir = await mkdtemp(join(tmpdir(), "zoomcast-speech-"));
    const file = join(dir, "model.bin");
    try {
      const received: number[] = [];
      await downloadAsset({ url, bytes: bytes.length, sha256: hash }, file, new AbortController().signal, n => received.push(n));
      expect(await readFile(file)).toEqual(bytes);
      expect(received.at(-1)).toBe(bytes.length);
      await expect(downloadAsset({ url, bytes: bytes.length, sha256: hash }, file, new AbortController().signal, () => undefined)).rejects.toThrow();
      expect(await readFile(file)).toEqual(bytes);
      await rm(file);
      await expect(downloadAsset({ url, bytes: bytes.length, sha256: "0".repeat(64) }, file, new AbortController().signal, () => undefined)).rejects.toThrow("verified");
      await expect(stat(file)).rejects.toThrow();
      await expect(downloadAsset({ url, bytes: 1, sha256: hash }, file, new AbortController().signal, () => undefined)).rejects.toThrow("larger");
      await expect(stat(file)).rejects.toThrow();
      await expect(downloadAsset({ url: `${url}/missing`, bytes: 1, sha256: hash }, file, new AbortController().signal, () => undefined)).rejects.toThrow("404");
      const controller = new AbortController();
      const download = downloadAsset({ url: `${url}/slow`, bytes: bytes.length, sha256: hash }, file, controller.signal, () => controller.abort());
      await expect(download).rejects.toThrow("cancelled");
      await expect(stat(file)).rejects.toThrow();
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(dir, { force: true, recursive: true });
    }
  });
});
