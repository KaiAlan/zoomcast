import { describe, expect, it } from "vitest";
import { feedbackLaunch, feedbackSchema } from "./feedback";

const environment = { version: "0.1.3", platform: "win32", release: "10.0.26100", arch: "x64" };
describe("feedback report drafts", () => {
  it("encodes report text without allowing a caller to redirect the destination", () => {
    const launch = feedbackLaunch({ kind: "bug", title: " Save & reopen? #1 ", details: "Steps:\n1. Edit\n2. Save\nExpected: ✓" }, environment);
    const url = new URL(launch.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/KaiAlan/zoomcast/issues/new");
    expect(url.searchParams.get("title")).toBe("[Bug report] Save & reopen? #1");
    expect(url.searchParams.get("body")).toContain("Steps:\n1. Edit\n2. Save\nExpected: ✓");
    expect(url.searchParams.get("body")).toContain("Zoomcast 0.1.3\nwin32 10.0.26100 (x64)");
    expect(launch.clipboardText).toBeNull();
  });
  it("keeps long and Unicode reports intact within the Windows URL limit", () => {
    const details = "বাংলা feedback 🎥\n".repeat(180);
    const launch = feedbackLaunch({ kind: "feedback", title: "🎥".repeat(60), details }, environment);
    expect(launch.url.length).toBeLessThanOrEqual(2081);
    expect(new URL(launch.url).searchParams.has("body")).toBe(false);
    expect(launch.clipboardText).toContain(details.trim());
  });
  it.each(["feature", "feedback"] as const)("supports %s reports", kind => {
    const launch = feedbackLaunch({ kind, title: "Suggestion", details: "Please add this." }, environment);
    expect(new URL(launch.url).searchParams.get("title")).toContain(kind === "feature" ? "Feature request" : "Feedback");
  });
  it("rejects blank, oversized and malformed IPC requests", () => {
    const valid = { kind: "bug", title: "Save", details: "Reopen loses edits" };
    for (const request of [null, {}, { ...valid, kind: "other" }, { ...valid, title: " " }, { ...valid, details: " " },
      { ...valid, title: "x".repeat(121) }, { ...valid, details: "x".repeat(4001) }, { ...valid, url: "file:///C:/Windows" }]) {
      expect(feedbackSchema.safeParse(request).success).toBe(false);
    }
  });
});
