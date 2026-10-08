import { describe, expect, it } from "vitest";
import { releaseSummary, releaseUrl } from "./updates";

describe("release summaries from update metadata", () => {
  it("shows only short highlights and links to the matching GitHub release", () => {
    const summary = releaseSummary("0.1.4", "# Zoomcast 0.1.4\r\n\r\n## Highlights\r\n\r\n- New clip editing controls.\r\n- Working cursor styles.\r\n\r\n## Fixed\r\n\r\n- Long technical details stay on GitHub.");
    expect(summary.highlights).toEqual(["New clip editing controls.", "Working cursor styles."]);
    expect(summary.url).toBe("https://github.com/KaiAlan/zoomcast/releases/tag/v0.1.4");
  });
  it("uses the matching release when the provider returns a list", () => {
    expect(releaseSummary("0.1.4", [{ version: "0.1.3", note: "## Highlights\n- Older changes." }, { version: "0.1.4", note: "## Highlights\n- New changes." }]).highlights).toEqual(["New changes."]);
  });
  it("handles legacy or missing notes without inventing a summary", () => {
    for (const notes of [undefined, null, "<h1>Old HTML notes</h1>", []]) expect(releaseSummary("0.1.4", notes).highlights).toEqual([]);
  });
  it("bounds remote summaries and rejects arbitrary release URLs", () => {
    expect(releaseSummary("0.1.4", `## Highlights\n- ${"a".repeat(10000)}\n${Array.from({ length: 10 }, (_, i) => `- Item ${i}`).join("\n")}`).highlights).toHaveLength(5);
    expect(() => releaseUrl("../../other?x=y")).toThrow();
    expect(() => releaseUrl("https://other.test")).toThrow();
  });
});
