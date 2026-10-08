import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { cpus } from "node:os";
import { unzipSync } from "fflate";
import type { CaptionCue, CaptionSource, CaptionState } from "../../shared/captions/types";
import { openBundle } from "../bundleIo";
import { resolveFfmpeg } from "../ffmpeg";
import { ENGINE, MODEL, MODEL_FILE, RUNTIME_FOLDER, SPEECH_NOTICES } from "./assets";
import { downloadAsset, fileDigest } from "./download";
import { parseRecognition, recognitionAudioArgs } from "./recognition";

type InstalledFiles = Record<string, { bytes: number; sha256: string }>;

export class CaptionService {
  private controller: AbortController | null = null;
  private current: Pick<CaptionState, "phase" | "progress" | "message"> = { phase: "idle", progress: null, message: "" };
  readonly runtimeDir: string;
  constructor(private readonly root: string, private readonly changed: (state: CaptionState) => void = () => undefined) {
    this.runtimeDir = join(root, RUNTIME_FOLDER);
  }

  private installedFiles(): InstalledFiles | null {
    try {
      const files = JSON.parse(readFileSync(join(this.runtimeDir, "installed.json"), "utf8")) as InstalledFiles;
      if (!files["whisper-cli.exe"] || !files[MODEL_FILE]) return null;
      for (const [file, value] of Object.entries(files)) {
        if (basename(file) !== file || !/^[\w.-]+$/.test(file) || !value || !/^[0-9a-f]{64}$/.test(value.sha256) || statSync(join(this.runtimeDir, file)).size !== value.bytes) return null;
      }
      return files;
    } catch { return null; }
  }

  state(): CaptionState {
    const files = this.installedFiles();
    return { ...this.current, installed: files !== null, busy: this.controller !== null, downloadBytes: ENGINE.bytes + MODEL.bytes, diskBytes: files ? Object.values(files).reduce((n, f) => n + f.bytes, 0) : 0 };
  }
  private report(phase: CaptionState["phase"], message: string, progress: number | null = null): void {
    this.current = { phase, message, progress };
    this.changed(this.state());
  }
  private begin(): AbortSignal {
    if (this.controller) throw new Error("Another caption task is running. Wait for it or cancel it first.");
    this.controller = new AbortController();
    return this.controller.signal;
  }
  cancel(): void { this.controller?.abort(); }
  private async cleanInterrupted(): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) if (entry.isDirectory() && /^\.(install|transcribe)-[0-9a-f-]{36}$/.test(entry.name)) {
      await rm(join(this.root, entry.name), { force: true, recursive: true });
    }
  }
  async remove(): Promise<void> {
    if (this.controller) throw new Error("Cancel the caption task before removing the download.");
    await rm(this.runtimeDir, { force: true, recursive: true });
    await this.cleanInterrupted();
    this.report("idle", "Speech download removed. Saved transcripts and captions are kept.");
  }

  async install(): Promise<void> {
    if (this.installedFiles()) return;
    const signal = this.begin();
    const temporary = join(this.root, `.install-${randomUUID()}`);
    try {
      await this.cleanInterrupted();
      signal.throwIfAborted();
      await mkdir(temporary, { recursive: true });
      this.report("downloading", "Downloading speech engine…", 0);
      const archive = join(temporary, "engine.zip");
      let lastReported = 0;
      const progress = (base: number, message: string) => (bytes: number) => {
        const now = Date.now();
        if (now - lastReported < 150) return;
        lastReported = now;
        this.report("downloading", message, (base + bytes) / (ENGINE.bytes + MODEL.bytes));
      };
      await downloadAsset(ENGINE, archive, signal, progress(0, "Downloading speech engine…"));
      // Only extract verified native tools. No archive paths are ever used as destinations.
      const runtimeNames = new Set(["whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll"]);
      const extracted = unzipSync(await readFile(archive), { filter: f => runtimeNames.has(basename(f.name.replace(/\\/g, "/"))) && f.originalSize <= 30 * 1024 * 1024 });
      const files: InstalledFiles = {};
      for (const [path, bytes] of Object.entries(extracted)) {
        const file = basename(path.replace(/\\/g, "/"));
        if (!/^[\w.-]+\.(exe|dll)$/i.test(file)) continue;
        // Keep the CLI and its libraries, not unrelated demo executables.
        if (/\.exe$/i.test(file) && file !== "whisper-cli.exe") continue;
        if (files[file]) throw new Error("The speech engine archive has duplicate files.");
        await writeFile(join(temporary, file), bytes, { flag: "wx" });
        files[file] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      }
      if (!files["whisper-cli.exe"]) throw new Error("The download is missing the speech engine.");
      await this.run(join(temporary, "whisper-cli.exe"), ["--help"], signal);
      this.report("downloading", "Downloading multilingual speech model…", ENGINE.bytes / (ENGINE.bytes + MODEL.bytes));
      await downloadAsset(MODEL, join(temporary, MODEL_FILE), signal, progress(ENGINE.bytes, "Downloading multilingual speech model…"));
      files[MODEL_FILE] = { bytes: MODEL.bytes, sha256: MODEL.sha256 };
      await writeFile(join(temporary, "THIRD-PARTY-NOTICES.txt"), SPEECH_NOTICES);
      await writeFile(join(temporary, "installed.json"), JSON.stringify(files));
      await rm(archive);
      signal.throwIfAborted();
      await rm(this.runtimeDir, { force: true, recursive: true });
      await rename(temporary, this.runtimeDir);
      this.current = { phase: "idle", progress: null, message: "Offline transcription is ready." };
    } catch (error) {
      this.current = { phase: "idle", progress: null, message: signal.aborted ? "Download cancelled." : error instanceof Error ? error.message : String(error) };
      throw new Error(this.current.message);
    } finally {
      try { await rm(temporary, { force: true, recursive: true }); } finally {
        this.controller = null;
        this.changed(this.state());
      }
    }
  }

  async generate(dir: string, source: CaptionSource, language: string): Promise<CaptionCue[]> {
    const files = this.installedFiles();
    if (!files) throw new Error("Download offline transcription first.");
    const signal = this.begin();
    const temporary = join(this.root, `.transcribe-${randomUUID()}`);
    try {
      const bundle = openBundle(dir);
      if (!bundle.manifest.audio.length || bundle.manifest.durationMs <= 0) throw new Error("This recording has no audio to transcribe.");
      this.report("preparing", "Checking speech download…");
      for (const [file, expected] of Object.entries(files)) {
        signal.throwIfAborted();
        if (await fileDigest(join(this.runtimeDir, file)) !== expected.sha256) throw new Error("The speech download is damaged. Remove it in Settings and download it again.");
      }
      await this.cleanInterrupted();
      signal.throwIfAborted();
      await mkdir(temporary, { recursive: true });
      const wav = join(temporary, "audio.wav");
      this.report("preparing", "Preparing recorded audio…");
      await this.run(resolveFfmpeg(), recognitionAudioArgs(bundle.dir, bundle.manifest, source, wav), signal);
      this.report("transcribing", "Transcribing on this computer…", 0);
      const output = join(temporary, "transcript");
      await this.run(join(this.runtimeDir, "whisper-cli.exe"), ["-m", join(this.runtimeDir, MODEL_FILE), "-f", wav, "-l", language, "-t", String(Math.min(4, Math.max(1, cpus().length - 1))), "-ng", "-oj", "-of", output, "-ml", "80", "-sow", "-np", "-pp"], signal, text => {
        const match = [...text.matchAll(/progress\s*=\s*(\d+)%/g)].at(-1);
        if (match) this.report("transcribing", "Transcribing on this computer…", Number(match[1]) / 100);
      });
      const cues = parseRecognition(JSON.parse(await readFile(`${output}.json`, "utf8")), bundle.manifest.durationMs);
      this.current = { phase: "idle", progress: null, message: cues.length ? "Transcript generated. Review the text for accuracy." : "No speech was recognized. Try another audio source or language." };
      return cues;
    } catch (error) {
      this.current = { phase: "idle", progress: null, message: signal.aborted ? "Transcription cancelled." : error instanceof Error ? error.message : String(error) };
      throw new Error(this.current.message);
    } finally {
      try { await rm(temporary, { force: true, recursive: true }); } finally {
        this.controller = null;
        this.changed(this.state());
      }
    }
  }

  private run(bin: string, args: string[], signal: AbortSignal, progress?: (text: string) => void): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let tail = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => { child.kill(); };
      const timer = setTimeout(() => { child.kill(); }, 2 * 60 * 60 * 1000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const chunk = (data: Buffer) => { const text = data.toString(); tail = (tail + text).slice(-4000); progress?.(tail); };
      child.stdout.on("data", chunk);
      child.stderr.on("data", chunk);
      child.once("error", e => finish(new Error(`Could not start offline speech processing: ${e.message}`)));
      child.once("close", code => finish(signal.aborted ? new Error("Transcription cancelled.") : code === 0 ? undefined : new Error(`Offline speech processing failed (${code}). ${tail.trim()}`)));
    });
  }
}
