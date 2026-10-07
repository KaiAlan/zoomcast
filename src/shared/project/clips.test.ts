import { describe, expect, it } from "vitest";
import { defaultProject } from "./defaults";
import { addZoomAt, deleteClip, reorderClip, splitClip, splitZoom } from "./clips";
import { clipsFor, outputDurationMs, outputToSource, sourceSpansToOutput, sourceToOutput } from "./timeline";
import { deriveKeyframes, resetShotToAuto } from "../zoom/derive";
import { deleteSegment, segmentDragToSource, segmentResizeToSource, setSegmentCamera, setSegmentDepth } from "./edits";
import { normalizeProject } from "./migrate";
import { planExportFrames } from "../export/exportPlan";
import { buildExportArgs } from "../export/ffmpegArgs";
import type { Project } from "./types";

const ctx = { telemetry: [], cameraPath: null, source: { w: 1920, h: 1080 }, durationMs: 10000 };
const derive = (p: Project): Project => ({ ...p, zoom: { ...p.zoom, ...deriveKeyframes(p.zoom.config, p, ctx) } });
const shot = () => derive(addZoomAt(defaultProject("test"), 1000, 10000, "zoom"));

describe("editable base clips", () => {
  it("converts old ripple cuts to surviving clips without changing frames", () => {
    const cuts = [{ id: "removed", startMs: 2000, endMs: 3500 }];
    const clips = clipsFor(10000, cuts);
    expect(clips).toEqual([{ id: "clip-0", startMs: 0, endMs: 2000 }, { id: "clip-1", startMs: 3500, endMs: 10000 }]);
    expect(planExportFrames(10000, cuts, 60, clips)).toEqual(planExportFrames(10000, cuts, 60));
  });
  it("splits the selected clip at output time with no footage removed", () => {
    const p = splitClip(defaultProject("test"), "clip-0", 4000, 10000, "right");
    expect(p.clips).toEqual([{ id: "clip-0", startMs: 0, endMs: 4000 }, { id: "right", startMs: 4000, endMs: 10000 }]);
    expect(outputDurationMs(10000, [], p.clips)).toBe(10000);
    expect(planExportFrames(10000, [], 30, p.clips)).toEqual(planExportFrames(10000, [], 30));
  });
  it("maps boundaries, deletes a piece and preserves clip order through save and load", () => {
    let p = splitClip(defaultProject("test"), null, 4000, 10000, "right");
    p = reorderClip(p, "right", "clip-0", 10000);
    expect(outputToSource(0, 10000, [], p.clips)).toBe(4000);
    expect(outputToSource(6000, 10000, [], p.clips)).toBe(0);
    expect(sourceToOutput(1000, 10000, [], p.clips)).toBe(7000);
    expect(sourceSpansToOutput(3000, 5000, 10000, [], p.clips)).toEqual([{ startMs: 0, endMs: 1000 }, { startMs: 9000, endMs: 10000 }]);
    expect(normalizeProject(JSON.parse(JSON.stringify(p)), "test").clips).toEqual(p.clips);
    p = deleteClip(p, "right", 10000);
    expect(outputDurationMs(10000, [], p.clips)).toBe(4000);
    expect(sourceToOutput(5000, 10000, [], p.clips)).toBeNull();
    p = deleteClip(p, "clip-0", 10000);
    expect(p.clips).toEqual([]);
    expect(planExportFrames(10000, [], 60, p.clips)).toEqual([]);
  });
  it("does not split at boundaries, outside the selected clip or into invisible slivers", () => {
    const p = defaultProject("test");
    for (const time of [0, 50, 9950, 10000]) expect(splitClip(p, null, time, 10000, "new")).toBe(p);
    expect(splitClip(p, "missing", 1000, 10000, "new")).toBe(p);
  });
  it("splits attached zooms at clip boundaries and removes only deleted footage's zooms", () => {
    let p = splitClip(shot(), null, 2500, 10000, "right");
    expect(p.zoom.segments.map(s => [s.startMs, s.endMs])).toEqual([[1000, 2500], [2500, 4000]]);
    p = reorderClip(p, "right", "clip-0", 10000);
    expect(p.zoom.segments.map(s => s.startMs)).toEqual([1000, 2500]);
    expect(planExportFrames(10000, [], 30, p.clips)[0]?.tSourceMs).toBe(2500);
    p = deleteClip(p, "clip-0", 10000);
    expect(p.zoom.segments.map(s => [s.startMs, s.endMs])).toEqual([[2500, 4000]]);
  });
  it("builds audio trims in the same order as video, including a single surviving clip", () => {
    const options = { width: 1920, height: 1080, fps: 30, bitrateMbps: 12, encoder: "libx264", durationMs: 10000, cuts: [], audio: [{ file: "audio.wav", gainDb: 0, startOffsetMs: 300 }], syncNudgeMs: 0, outFile: "out.mp4" };
    const clips = [{ id: "b", startMs: 4000, endMs: 7000 }, { id: "a", startMs: 0, endMs: 2000 }];
    const args = buildExportArgs({ ...options, clips });
    const graph = args[args.indexOf("-filter_complex") + 1] ?? "";
    expect(graph).toContain("aresample=async=1:first_pts=0,apad=whole_dur=10");
    expect(graph.indexOf("atrim=start=4:end=7")).toBeLessThan(graph.indexOf("atrim=start=0:end=2"));
    expect(args[args.indexOf("-t") + 1]).toBe("5");
    expect(buildExportArgs({ ...options, clips: clips.slice(0, 1) }).join(" ")).toContain("atrim=start=4:end=7");
  });
});

describe("zoom editing stays live", () => {
  it("rebuilds claimed keyframes on every successive depth change", () => {
    let p = shot();
    for (const depth of [0.25, 1, 0.4, 0.7, 0.55]) {
      p = derive(setSegmentDepth(p, "zoom", depth));
      expect(Math.max(...p.zoom.keyframes.map(k => k.scale))).toBeCloseTo(1 + depth * (p.zoom.config.maxZoom - 1));
    }
    expect(derive(deleteSegment(p, "zoom")).zoom.keyframes).toEqual([]);
  });
  it("switches fixed/follow repeatedly without retaining obsolete follow samples", () => {
    let p = shot();
    for (const position of ["follow", "fixed", "follow", "fixed"] as const) {
      p = derive(setSegmentCamera(p, "zoom", position));
      expect(p.zoom.segments[0]?.position).toBe(position);
    }
  });
  it("resets a manual shot's depth and camera without resurrecting deleted shots", () => {
    const p = derive(resetShotToAuto(derive(setSegmentDepth(shot(), "zoom", 1)), "zoom", ctx));
    expect(p.zoom.segments[0]?.position).toBe("follow");
    expect(p.zoom.segments[0]?.waypoints[0]?.depth).toBe(p.zoom.config.depthClick);
    expect(Math.max(...p.zoom.keyframes.map(k => k.scale))).toBeCloseTo(1 + p.zoom.config.depthClick * (p.zoom.config.maxZoom - 1));
  });
  it("splits zooms into independent rendered shots even when short", () => {
    let p = splitZoom(shot(), "zoom", 1500, 10000, "zoom-right");
    p = derive(p);
    expect(p.zoom.segments).toHaveLength(2);
    expect(p.zoom.keyframes.some(k => k.tSourceMs < 1500 && k.scale > 1)).toBe(true);
    const firstDepth = p.zoom.segments[0]?.waypoints[0]?.depth;
    p = derive(setSegmentDepth(p, "zoom-right", 1));
    expect(p.zoom.segments[0]?.waypoints[0]?.depth).toBe(firstDepth);
  });
  it("adds exactly at the playhead inside an existing shot", () => {
    const p = addZoomAt(shot(), 2000, 10000, "inserted");
    expect(p.zoom.segments.find(s => s.id === "inserted")?.startMs).toBe(2000);
    expect(p.zoom.segments.every((s, i, a) => i === 0 || (a[i - 1]?.endMs ?? 0) <= s.startMs)).toBe(true);
  });
  it("keeps zoom drag and resize inside their reordered host clip", () => {
    let p = splitClip(shot(), null, 5000, 10000, "right");
    p = reorderClip(p, "right", "clip-0", 10000);
    p = segmentDragToSource(p, "zoom", 5500, 10000);
    expect(p.zoom.segments[0]?.startMs).toBe(500);
    p = segmentResizeToSource(p, "zoom", "end", 9900, 10000);
    expect(p.zoom.segments[0]?.endMs).toBe(4900);
  });
});
