import { normalizeCaptions } from "../../shared/captions/document";
import type { CaptionCue } from "../../shared/captions/types";
import type { Manifest } from "../../shared/bundle/manifest";
import type { CaptionSource } from "../../shared/captions/types";
import { basename, isAbsolute, join } from "node:path";

export function parseRecognition(json: unknown, durationMs: number): CaptionCue[] {
  if (!json || typeof json !== "object" || !Array.isArray((json as { transcription?: unknown }).transcription)) throw new Error("The speech engine returned an invalid transcript. Try generating again.");
  const segments = (json as { transcription: Array<{ offsets?: { from?: number; to?: number }; text?: string }> }).transcription;
  return normalizeCaptions({ cues: segments.map((s, i) => ({ id: `caption-${i}`, startMs: s?.offsets?.from, endMs: Math.min(s?.offsets?.to ?? 0, durationMs), text: s?.text })) }).cues;
}

export function recognitionAudioArgs(dir: string, manifest: Manifest, source: CaptionSource, wav: string): string[] {
  const tracks = manifest.audio.filter(t => source === "mix" || t.role === source);
  if (!tracks.length) throw new Error("This recording has no audio for the selected source.");
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin"];
  for (const track of tracks) {
    if (isAbsolute(track.file) || basename(track.file) !== track.file || track.file.includes("\\") || track.file.includes("/")) throw new Error("The recording has an invalid audio path.");
    args.push("-itsoffset", String(track.startOffsetMs / 1000), "-i", join(dir, track.file));
  }
  const graph = tracks.map((_, i) => `[${i}:a]aresample=16000:async=1:first_pts=0,apad,atrim=duration=${manifest.durationMs / 1000}[a${i}]`);
  const inputs = tracks.map((_, i) => `[a${i}]`).join("");
  const mix = tracks.length > 1 ? `amix=inputs=${tracks.length}:duration=longest:normalize=1` : "anull";
  graph.push(`${inputs}${mix}[out]`);
  return [...args, "-filter_complex", graph.join(";"), "-map", "[out]", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-t", String(manifest.durationMs / 1000), wav];
}
