import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import { SemanticTargetReader } from "./SemanticTargetReader";

const capture = { x: 100, y: 200, w: 1920, h: 1080 };
function worker() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  vi.stubGlobal("process", { ...process, platform: "win32" });
  vi.useFakeTimers();
  return child;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("isolated accessibility worker", () => {
  it("converts bounds to capture pixels and correlates asynchronous replies", async () => {
    const child = worker(); const reader = SemanticTargetReader.start();
    const query = reader?.query(150, 250, false, capture);
    child.stdout.write('{"ready":true}\n');
    const request = JSON.parse(child.stdin.read().toString());
    child.stdout.write(`${JSON.stringify({ id: request.id, candidates: [{ role: "Edit", rect: { x: 130, y: 230, w: 700, h: 200 } }] })}\n`);
    expect(await query).toEqual({ role: "Edit", rect: { x: 30, y: 30, w: 700, h: 200 } });
    reader?.stop(); expect(child.kill).toHaveBeenCalledOnce();
  });
  it("kills a hung provider and resolves both active and queued requests", async () => {
    const child = worker(); const reader = SemanticTargetReader.start();
    child.stdout.write('{"ready":true}\n');
    const active = reader?.query(150, 250, false, capture);
    const queued = reader?.query(160, 250, false, capture);
    await vi.advanceTimersByTimeAsync(701);
    expect(await active).toBeNull(); expect(await queued).toBeNull();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(await reader?.query(150, 250, false, capture)).toBeNull();
  });
  it("bounds the backlog during rapid clicks while waiting for startup", async () => {
    const child = worker(); const reader = SemanticTargetReader.start();
    const pending = Array.from({ length: 30 }, () => reader?.query(150, 250, false, capture));
    expect(await pending[0]).toBeNull();
    reader?.stop(); expect((await Promise.all(pending)).every(value => value === null)).toBe(true);
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it("falls back when Windows assemblies cannot initialize or the worker exits", async () => {
    const child = worker(); const reader = SemanticTargetReader.start();
    const pending = reader?.query(150, 250, false, capture);
    child.emit("exit", 1);
    expect(await pending).toBeNull();
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
