import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UpdateHistory } from "./updateHistory";

const directories: string[] = [];
function file() { const dir = mkdtempSync(join(tmpdir(), "zoomcast-update-history-")); directories.push(dir); return join(dir, "history.json"); }
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("release notice history", () => {
  it("remembers dismissal across restart but shows the next installed version", () => {
    const path = file();
    const history = new UpdateHistory(path);
    expect(history.hasSeen("0.1.3")).toBe(false);
    history.markSeen("0.1.3");
    const restarted = new UpdateHistory(path);
    expect(restarted.hasSeen("0.1.3")).toBe(true);
    expect(restarted.hasSeen("0.1.4")).toBe(false);
  });
  it("retains summary history from versions that stored notification history", () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ seenVersion: "0.1.3", notifiedVersion: "0.1.4" }));
    const history = new UpdateHistory(path);
    expect(history.hasSeen("0.1.3")).toBe(true);
    history.markSeen("0.1.4");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ seenVersion: "0.1.4" });
  });
  it("recovers from corrupt history and rejects a dismissal that cannot be saved", () => {
    const path = file(); writeFileSync(path, "{broken");
    const history = new UpdateHistory(path);
    expect(history.hasSeen("0.1.3")).toBe(false);
    rmSync(path.slice(0, path.lastIndexOf("history.json")), { recursive: true, force: true });
    expect(() => history.markSeen("0.1.3")).toThrow();
    expect(history.hasSeen("0.1.3")).toBe(false);
  });
});
