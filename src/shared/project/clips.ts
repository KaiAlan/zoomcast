import type { Project, SourceClip } from "./types";
import type { ZoomSegment, ZoomWaypoint } from "../zoom/types";
import { clipsFor, outputToSource } from "./timeline";

export const MIN_CLIP_MS = 100;

function focusIn(s: ZoomSegment, startMs: number, endMs: number): ZoomWaypoint[] {
  const points = s.waypoints.filter(w => w.tMs >= startMs && w.tMs < endMs);
  const first = [...s.waypoints].reverse().find(w => w.tMs <= startMs) ?? s.waypoints[0];
  if (first && !points.some(w => w.tMs === startMs)) points.unshift({ ...first, id: `${first.id}-at-${startMs}`, tMs: startMs });
  return points;
}

export function segmentPart(s: ZoomSegment, startMs: number, endMs: number, id = s.id): ZoomSegment {
  return { ...s, id, startMs, endMs, waypoints: focusIn(s, startMs, endMs), pinned: true };
}

/** Zooms follow their source footage when a base clip is split, removed or reordered. */
export function alignSegmentsToClips(segments: ZoomSegment[], clips: SourceClip[]): ZoomSegment[] {
  return segments.flatMap(s => {
    const parts = clips.map(c => ({ start: Math.max(s.startMs, c.startMs), end: Math.min(s.endMs, c.endMs), clip: c }))
      .filter(r => r.end > r.start).sort((a, b) => a.start - b.start);
    if (parts.length === 1 && parts[0]?.start === s.startMs && parts[0]?.end === s.endMs) return [s];
    return parts.map((r, i) => segmentPart(s, r.start, r.end, i === 0 ? s.id : `${s.id}@${r.clip.id}`));
  }).sort((a, b) => a.startMs - b.startMs);
}

function withClips(p: Project, clips: SourceClip[]): Project {
  return { ...p, clips, zoom: { ...p.zoom, segments: alignSegmentsToClips(p.zoom.segments, clips), keyframes: [] } };
}

export function splitClip(p: Project, id: string | null, outputMs: number, durationMs: number, rightId: string): Project {
  const clips = clipsFor(durationMs, p.cuts, p.clips);
  let offset = 0;
  const index = clips.findIndex(c => {
    const contains = outputMs > offset && outputMs < offset + c.endMs - c.startMs && (id === null || c.id === id);
    offset += c.endMs - c.startMs;
    return contains;
  });
  const target = clips[index];
  if (!target) return p;
  const sourceMs = outputToSource(outputMs, durationMs, p.cuts, p.clips);
  if (sourceMs - target.startMs < MIN_CLIP_MS || target.endMs - sourceMs < MIN_CLIP_MS) return p;
  return withClips(p, [...clips.slice(0, index), { ...target, endMs: sourceMs }, { ...target, id: rightId, startMs: sourceMs }, ...clips.slice(index + 1)]);
}

export function deleteClip(p: Project, id: string, durationMs: number): Project {
  const clips = clipsFor(durationMs, p.cuts, p.clips);
  if (!clips.some(c => c.id === id)) return p;
  return withClips(p, clips.filter(c => c.id !== id));
}

/** Drop at an insertion boundary in the list with the dragged clip removed. */
export function reorderClip(p: Project, id: string, beforeId: string | null, durationMs: number): Project {
  const clips = clipsFor(durationMs, p.cuts, p.clips);
  const target = clips.find(c => c.id === id);
  if (!target || beforeId === id) return p;
  const rest = clips.filter(c => c.id !== id);
  const index = beforeId === null ? rest.length : rest.findIndex(c => c.id === beforeId);
  if (index < 0) return p;
  rest.splice(index, 0, target);
  if (rest.every((c, i) => c.id === clips[i]?.id)) return p;
  return withClips(p, rest);
}

export function splitZoom(p: Project, id: string, outputMs: number, durationMs: number, rightId: string): Project {
  const sourceMs = outputToSource(outputMs, durationMs, p.cuts, p.clips);
  const s = p.zoom.segments.find(s => s.id === id);
  if (!s || sourceMs - s.startMs < MIN_CLIP_MS || s.endMs - sourceMs < MIN_CLIP_MS) return p;
  return { ...p, zoom: { ...p.zoom, segments: p.zoom.segments.flatMap(item => item.id === id
    ? [segmentPart(s, s.startMs, sourceMs), segmentPart(s, sourceMs, s.endMs, rightId)] : [item]) } };
}

/** Insert at the playhead, replacing only the part of an existing zoom covered by the new shot. */
export function addZoomAt(p: Project, outputMs: number, durationMs: number, id: string): Project {
  const startMs = outputToSource(outputMs, durationMs, p.cuts, p.clips);
  const clip = clipsFor(durationMs, p.cuts, p.clips).find(c => startMs >= c.startMs && startMs < c.endMs);
  if (!clip) return p;
  const nextStart = p.zoom.segments.find(s => s.startMs > startMs)?.startMs ?? clip.endMs;
  const endMs = Math.min(clip.endMs, nextStart, startMs + 3000);
  if (endMs - startMs < MIN_CLIP_MS) return p;
  const segments = p.zoom.segments.flatMap(s => {
    if (s.endMs <= startMs || s.startMs >= endMs) return [s];
    const parts: ZoomSegment[] = [];
    if (s.startMs < startMs) parts.push(segmentPart(s, s.startMs, startMs));
    if (s.endMs > endMs) parts.push(segmentPart(s, endMs, s.endMs, parts.length ? `${s.id}@${id}` : s.id));
    return parts;
  });
  segments.push({ id, startMs, endMs, position: "fixed", origin: "manual", pinned: true,
    waypoints: [{ id: `${id}-focus`, tMs: startMs, depth: 0.5, cx: 0.5, cy: 0.5 }] });
  return { ...p, zoom: { ...p.zoom, segments: segments.sort((a, b) => a.startMs - b.startMs) } };
}
