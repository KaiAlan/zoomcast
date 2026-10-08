import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export type DownloadAsset = { url: string; bytes: number; sha256: string };

/** Stream to disk with bounded size, cancellation and a pinned content digest. */
export async function downloadAsset(asset: DownloadAsset, file: string, signal: AbortSignal, progress: (bytes: number) => void): Promise<void> {
  const timeout = AbortSignal.timeout(15 * 60 * 1000);
  const combined = AbortSignal.any([signal, timeout]);
  let created = false;
  try {
    const response = await fetch(asset.url, { signal: combined });
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}). Check your connection and try again.`);
    const hash = createHash("sha256");
    let received = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > asset.bytes) { callback(new Error("The download was larger than expected.")); return; }
      hash.update(chunk);
      progress(received);
      callback(null, chunk);
    } });
    const output = createWriteStream(file, { flags: "wx" });
    output.once("open", () => { created = true; });
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), meter, output, { signal: combined });
    if (received !== asset.bytes || hash.digest("hex") !== asset.sha256) throw new Error("The download could not be verified. Try downloading again.");
  } catch (error) {
    if (created) await rm(file, { force: true });
    if (signal.aborted) throw new Error("Download cancelled.");
    throw error;
  }
}

export async function fileDigest(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
