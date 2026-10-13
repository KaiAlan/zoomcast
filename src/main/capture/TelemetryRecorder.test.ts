import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  screen: { getCursorScreenPoint: () => ({ x: 10, y: 20 }), dipToScreenPoint: () => ({ x: 20, y: 40 }) },
}));
vi.mock("uiohook-napi", () => ({ uIOhook: { on: vi.fn(), start: vi.fn(), stop: vi.fn(), removeAllListeners: vi.fn() } }));
vi.mock("./CursorShapeReader", () => ({ CursorShapeReader: { start: () => null } }));
import { TelemetryRecorder } from "./TelemetryRecorder";

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("stationary cursor at recording start", () => {
  it("records an initial physical position even when the pointer never moves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zoomcast-telemetry-")); directories.push(dir);
    const file = join(dir, "input.jsonl");
    const recorder = TelemetryRecorder.start(file, Date.now());
    await recorder.stop();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ t: 0, k: "move", x: 20, y: 40 });
  });
  it("maps the initial position into the selected capture region", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zoomcast-telemetry-")); directories.push(dir);
    const file = join(dir, "input.jsonl");
    const recorder = TelemetryRecorder.start(file, Date.now(), () => ({ x: 15, y: 20, width: 100, height: 100 }));
    await recorder.stop();
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ t: 0, k: "move", x: 5, y: 20 });
  });
  it("does not record an initial position outside the selected region", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zoomcast-telemetry-")); directories.push(dir);
    const file = join(dir, "input.jsonl");
    const recorder = TelemetryRecorder.start(file, Date.now(), () => ({ x: 100, y: 100, width: 100, height: 100 }));
    await recorder.stop();
    expect(readFileSync(file, "utf8")).toBe("");
  });
});
