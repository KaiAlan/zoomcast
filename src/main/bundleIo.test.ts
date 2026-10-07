import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultProject } from "../shared/project/defaults";
import { openBundle, saveProject } from "./bundleIo";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "zoomcast-save-"));
  fs.cpSync(join(process.cwd(), "tests", "fixtures", "basic"), root, { recursive: true });
  fs.rmSync(join(root, "project.json"), { force: true });
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
describe("saved project persistence", () => {
  it("distinguishes a new take from a deliberately empty saved zoom timeline", () => {
    expect(openBundle(root).hasSavedPlan).toBe(false);
    const project = defaultProject("fixture-basic");
    project.audio.micGainDb = 6;
    project.style.cursor.sizePct = 140;
    saveProject(root, project);
    const reopened = openBundle(root);
    expect(reopened.hasSavedPlan).toBe(true);
    expect(reopened.project).toEqual(project);
  });
  it("plans legacy projects that have no saved segment list", () => {
    fs.writeFileSync(join(root, "project.json"), JSON.stringify({ audio: { micGainDb: 3 } }));
    expect(openBundle(root).hasSavedPlan).toBe(false);
    expect(openBundle(root).project.audio.micGainDb).toBe(3);
  });
  it("preserves the previous project and removes temporary files if replacement fails", () => {
    const project = defaultProject("fixture-basic");
    saveProject(root, project);
    const before = fs.readFileSync(join(root, "project.json"), "utf8");
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw Error("Access denied"); });
    expect(() => saveProject(root, { ...project, audio: { ...project.audio, micGainDb: 12 } })).toThrow("Access denied");
    expect(fs.readFileSync(join(root, "project.json"), "utf8")).toBe(before);
    expect(fs.readdirSync(root).filter(name => name.endsWith(".tmp"))).toEqual([]);
    saveProject(root, project);
    expect(openBundle(root).project).toEqual(project);
  });
  it("rejects a previous recording's project before overwriting another recording", () => {
    const project = defaultProject("fixture-basic");
    saveProject(root, project);
    const before = fs.readFileSync(join(root, "project.json"), "utf8");
    expect(() => saveProject(root, { ...project, bundleId: "another-recording" })).toThrow("different recording");
    expect(fs.readFileSync(join(root, "project.json"), "utf8")).toBe(before);
  });
});
