import { clipsFor } from "../project/timeline";
import type { Project } from "../project/types";
import type { CaptionCue } from "./types";
import { captionText } from "./document";

/** Keep source timestamps on disk; derive each surviving piece in playback order. */
export function outputCaptions(project: Project, durationMs: number): CaptionCue[] {
  const result: CaptionCue[] = [];
  let offset = 0;
  for (const clip of clipsFor(durationMs, project.cuts, project.clips)) {
    for (const cue of project.captions?.cues ?? []) {
      const start = Math.max(clip.startMs, cue.startMs - project.audio.syncNudgeMs);
      const end = Math.min(clip.endMs, cue.endMs - project.audio.syncNudgeMs);
      if (end > start) result.push({ ...cue, id: `${clip.id}:${cue.id}`, startMs: offset + start - clip.startMs, endMs: offset + end - clip.startMs });
    }
    offset += clip.endMs - clip.startMs;
  }
  return result.sort((a, b) => a.startMs - b.startMs);
}

/** A cue crossing a cut is clipped, not stretched across the deleted footage. */
export function captionAt(cues: CaptionCue[], tMs: number): string | undefined {
  // Non-overlapping recognition segments are ordered; edits may overlap.
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if ((cues[mid]?.startMs ?? Infinity) <= tMs) lo = mid + 1; else hi = mid; }
  const cue = cues[lo - 1];
  return cue && tMs < cue.endMs ? cue.text : undefined;
}

function timestamp(ms: number, separator: string): string {
  const time = Math.max(0, Math.round(ms));
  return `${String(Math.floor(time / 3600000)).padStart(2, "0")}:${String(Math.floor(time / 60000) % 60).padStart(2, "0")}:${String(Math.floor(time / 1000) % 60).padStart(2, "0")}${separator}${String(time % 1000).padStart(3, "0")}`;
}

export function subtitles(cues: CaptionCue[], format: "srt" | "vtt"): string {
  const separator = format === "srt" ? "," : ".";
  const blocks = cues.filter(c => Math.round(c.endMs) > Math.round(c.startMs)).map((cue, i) => {
    // Escape markup and cue delimiters: user text must remain literal in players.
    const text = captionText(cue.text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `${i + 1}\n${timestamp(cue.startMs, separator)} --> ${timestamp(cue.endMs, separator)}\n${text}\n`;
  });
  return (format === "vtt" ? "WEBVTT\n\n" : "") + blocks.join("\n");
}
