import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManifest } from "../../src/shared/bundle/manifest";
import { parseTelemetry } from "../../src/shared/bundle/telemetry";

const DIR = join(process.cwd(), "tests", "fixtures", "basic");

describe("basic fixture", () => {
  it("has a valid manifest", () => {
    const m = parseManifest(
      JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")),
    );
    expect(m.durationMs).toBe(5000);
    expect(m.video.fps).toBe(60);
    expect(m.audio).toHaveLength(2);
  });

  it("has parseable telemetry containing clicks and keystrokes", () => {
    const events = parseTelemetry(readFileSync(join(DIR, "input.jsonl"), "utf8"));
    expect(events.filter((e) => e.k === "down")).toHaveLength(3);
    expect(events.filter((e) => e.k === "key")).toHaveLength(12);
  });
});
