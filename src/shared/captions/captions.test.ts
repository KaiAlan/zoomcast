import { describe, expect, it } from "vitest";
import { defaultProject } from "../project/defaults";
import { normalizeProject } from "../project/migrate";
import { captionAt, outputCaptions, subtitles } from "./timing";
import { normalizeCaptions } from "./document";

function project() {
  const p = defaultProject("recording");
  p.captions = normalizeCaptions({ cues: [
    { id: "first", startMs: 500, endMs: 2500, text: "First sentence." },
    { id: "second", startMs: 3500, endMs: 4500, text: "Second sentence." },
  ], style: { visible: true } });
  return p;
}

describe("caption timing", () => {
  it("splits a crossing cue at a cut and omits deleted speech", () => {
    const p = project();
    p.cuts = [{ id: "cut", startMs: 1000, endMs: 2000 }];
    expect(outputCaptions(p, 5000).map(c => [c.startMs, c.endMs, c.text])).toEqual([
      [500, 1000, "First sentence."], [1000, 1500, "First sentence."], [2500, 3500, "Second sentence."],
    ]);
    p.cuts = [{ id: "cut", startMs: 0, endMs: 3000 }];
    expect(outputCaptions(p, 5000)).toEqual([{ id: "clip-0:second", startMs: 500, endMs: 1500, text: "Second sentence." }]);
  });
  it("uses explicit reordered and repeated clips", () => {
    const p = project();
    p.clips = [{ id: "b", startMs: 3000, endMs: 5000 }, { id: "a", startMs: 0, endMs: 1000 }, { id: "copy", startMs: 3000, endMs: 5000 }];
    expect(outputCaptions(p, 5000).map(c => [c.startMs, c.endMs, c.text])).toEqual([
      [500, 1500, "Second sentence."], [2500, 3000, "First sentence."], [3500, 4500, "Second sentence."],
    ]);
    p.clips = [];
    expect(outputCaptions(p, 5000)).toEqual([]);
  });
  it("applies audio sync before the cut mapping without changing the source transcript", () => {
    const p = project();
    p.audio.syncNudgeMs = 200;
    const cues = outputCaptions(p, 5000);
    expect(cues[0]?.startMs).toBe(300);
    expect(p.captions?.cues[0]?.startMs).toBe(500);
    expect(captionAt(cues, 299)).toBeUndefined();
    expect(captionAt(cues, 300)).toBe("First sentence.");
    expect(captionAt(cues, 2300)).toBeUndefined();
  });
  it("sorts edited timings for binary lookup and clips at source duration", () => {
    const p = project();
    p.captions?.cues.reverse();
    expect(captionAt(outputCaptions(p, 4000), 3800)).toBe("Second sentence.");
    expect(outputCaptions(p, 4000).at(-1)?.endMs).toBe(4000);
  });
});

describe("caption persistence and subtitle serialization", () => {
  it("reopens corrected text, styling and language and keeps legacy projects usable", () => {
    const p = project();
    if (p.captions) { p.captions.cues[0]!.text = "Corrected Zoomcast name."; p.captions.language = "hi"; p.captions.style.position = "top"; }
    expect(normalizeProject(JSON.parse(JSON.stringify(p)), "recording").captions).toEqual(p.captions);
    expect(normalizeProject({ version: 1 }, "legacy").captions?.cues).toEqual([]);
    expect(normalizeProject({}, "legacy").captions?.style.visible).toBe(false);
  });
  it("rejects invalid intervals, bounds styles and gives duplicate IDs unique fallbacks", () => {
    const c = normalizeCaptions({ cues: [
      { id: "a", startMs: 0, endMs: 500, text: "Hello\nworld" },
      { id: "a", startMs: 500, endMs: 1000, text: "Second" },
      { startMs: NaN, endMs: 1000, text: "bad" },
      { startMs: 10, endMs: 5, text: "bad" },
    ], style: { sizePct: 100, color: "url(bad)", font: "bad" } });
    expect(c.cues.map(cue => cue.id)).toEqual(["a", "a-copy"]);
    expect(c.cues[0]?.text).toBe("Hello world");
    expect(c.style.sizePct).toBe(8);
    expect(c.style.color).toBe("#ffffff");
    expect(c.style.font).toBe("Segoe UI");
  });
  it("writes millisecond timestamps and literal user text in SRT and WebVTT", () => {
    const cues = [{ id: "a", startMs: 3723456, endMs: 3724567, text: "Use <tag> & arrows --> here" }];
    expect(subtitles(cues, "srt")).toBe("1\n01:02:03,456 --> 01:02:04,567\nUse &lt;tag&gt; &amp; arrows --&gt; here\n");
    expect(subtitles(cues, "vtt")).toBe("WEBVTT\n\n1\n01:02:03.456 --> 01:02:04.567\nUse &lt;tag&gt; &amp; arrows --&gt; here\n");
  });
});
