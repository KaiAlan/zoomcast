import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { releaseSummary } from "../src/shared/updates";

const { check, parseNotes } = createRequire(import.meta.url)("../tools/release-notes.cjs");
const valid = "# Zoomcast 0.1.4\n\n## Highlights\n\n- Useful changes for users.\n\n## Fixed\n\n- Detailed change with its visible effect.\n\n## Upgrade notes\n\nUse Update and Restart to update.\n";
describe("release publication gate", () => {
  it("validates checked-in notes and changelog, with matching updater summaries", () => {
    const notes = check();
    expect(releaseSummary(notes.version, notes.markdown)).toMatchObject({ version: notes.version, highlights: notes.highlights, url: notes.url });
    expect(readFileSync(resolve("CHANGELOG.md"), "utf8")).toContain(`## [Zoomcast ${notes.version}](${notes.url})`);
  });
  it.each([
    [valid.replace("# Zoomcast 0.1.4", "# Zoomcast 0.1.3"), "start"],
    [valid.replace("## Highlights", "## Summary"), "Highlights"],
    [valid.replace("Useful changes for users.", "TODO: finish the notes."), "placeholders"],
    [valid.replace("- Useful changes for users.", "- [An external link](https://test.test)"), "plain-text"],
    [valid.replace("## Fixed", "## Other"), "detailed"],
    [valid.replace("## Upgrade notes", "## Other"), "Upgrade notes"],
    [valid.replace("- Useful changes for users.", Array(6).fill("- Useful changes for users.").join("\n")), "1–5"],
  ])("blocks incomplete or mismatched release notes", (markdown, message) => {
    expect(() => parseNotes(markdown, "0.1.4")).toThrow(message);
  });
});
