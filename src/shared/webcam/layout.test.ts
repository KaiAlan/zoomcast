import { describe, expect, it } from "vitest";
import { defaultProject } from "../project/defaults";
import { normalizeProject } from "../project/migrate";
import { outputToSource } from "../project/timeline";
import { webcamLayout, webcamTime } from "./layout";
const config = defaultProject("camera").webcam;
const source = { w: 1280, h: 720 };
describe("webcam composition", () => {
  it.each(["top-left", "top-right", "bottom-left", "bottom-right"] as const)("anchors %s inside output", (position) => {
    const { quad, radiusPx } = webcamLayout({ w: 1920, h: 1080 }, source, { ...config, position });
    expect(quad.w).toBeCloseTo(194.4);
    expect(quad.h).toBe(quad.w);
    expect(radiusPx).toBe(quad.w / 2);
    expect(position.endsWith("right") ? 1920 - quad.x - quad.w : quad.x).toBeCloseTo(32);
    expect(position.startsWith("bottom") ? 1080 - quad.y - quad.h : quad.y).toBeCloseTo(32);
  });
  it("covers circles without stretching and mirrors horizontal sampling", () => {
    const normal = webcamLayout({ w: 1920, h: 1080 }, source, { ...config, mirror: false });
    const mirrored = webcamLayout({ w: 1920, h: 1080 }, source, config);
    expect(normal.region.h).toBe(1);
    expect(normal.region.w).toBeCloseTo(720 / 1280);
    expect(mirrored.quad).toEqual(normal.quad);
    expect(mirrored.region.x).toBeCloseTo(normal.region.x + normal.region.w);
    expect(mirrored.region.w).toBe(-normal.region.w);
  });
  it("preserves rectangle aspect in narrow portrait output", () => {
    const { quad } = webcamLayout({ w: 300, h: 900 }, source, { ...config, shape: "rounded", sizePct: 500, marginPx: 1000 });
    expect(quad.w / quad.h).toBeCloseTo(1280 / 720);
    expect(quad.x).toBeGreaterThanOrEqual(0);
    expect(quad.x + quad.w).toBeLessThanOrEqual(300);
    expect(quad.y + quad.h).toBeLessThanOrEqual(900);
  });
  it("hides unavailable frames and handles signed offsets", () => {
    expect(webcamTime(100, 200, 1000)).toBeNull();
    expect(webcamTime(200, 200, 1000)).toBe(0);
    expect(webcamTime(1200, 200, 1000)).toBeNull();
    expect(webcamTime(100, -200, 1000)).toBe(300);
  });
  it("jumps camera across the same cut", () => {
    const t = outputToSource(1000, 5000, [{ id: "cut", startMs: 500, endMs: 1500 }]);
    expect(t).toBe(2000);
    expect(webcamTime(t, -250, 6000)).toBe(2250);
  });
  it("migrates old settings and rejects malformed fields", () => {
    expect(normalizeProject({ webcam: { mirror: false, shape: "rounded", position: "top-left" } }, "b").webcam).toEqual({ ...config, mirror: false, shape: "rounded", position: "top-left" });
    expect(normalizeProject({ webcam: { mirror: "false", visible: 0, shape: "triangle", position: "middle", sizePct: "large" } }, "b").webcam).toEqual(config);
  });
});
