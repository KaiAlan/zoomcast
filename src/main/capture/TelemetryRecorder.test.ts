import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  screen: { getCursorScreenPoint: () => ({ x: 10, y: 20 }), dipToScreenPoint: () => ({ x: 20, y: 40 }) },
}));
vi.mock("uiohook-napi", () => ({ uIOhook: { on: vi.fn(), start: vi.fn(), stop: vi.fn(), removeAllListeners: vi.fn() } }));
vi.mock("./SemanticTargetReader", () => ({ SemanticTargetReader: { start: () => null } }));
vi.mock("./CursorShapeReader", () => ({ CursorShapeReader: { start: () => null } }));
import { uIOhook } from "uiohook-napi";
import { TelemetryRecorder } from "./TelemetryRecorder";

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
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


describe("fast input telemetry", () => {
  it("keeps the trailing movement and every unthrottled click on stop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zoomcast-telemetry-")); directories.push(dir);
    const file = join(dir, "input.jsonl");
    const clock = vi.spyOn(Date, "now").mockReturnValue(10000);
    const recorder = TelemetryRecorder.start(file, 10000);
    const listeners = (vi.mocked(uIOhook.on).mock.calls as unknown as [string, (e: { x: number; y: number; button?: number }) => void][]).slice().reverse();
    const move = listeners.find(call => call[0] === "mousemove")?.[1];
    const click = listeners.find(call => call[0] === "mousedown")?.[1];
    expect(move).toBeTypeOf("function"); expect(click).toBeTypeOf("function");
    clock.mockReturnValue(10001); move?.({ x: 100, y: 100 } as never);
    clock.mockReturnValue(10002); move?.({ x: 1500, y: 500 } as never);
    clock.mockReturnValue(10003); click?.({ x: 1500, y: 500, button: 1 } as never);
    clock.mockReturnValue(10004); click?.({ x: 100, y: 900, button: 1 } as never);
    clock.mockReturnValue(10005); move?.({ x: 1800, y: 950 } as never);
    await recorder.stop(); clock.mockRestore();
    const events = readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(events.filter(e => e.k === "down").map(e => [e.t, e.x, e.y])).toEqual([[3, 1500, 500], [4, 100, 900]]);
    expect(events.at(-1)).toEqual({ t: 5, k: "move", x: 1800, y: 950 });
  });
});
