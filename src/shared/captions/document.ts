import type { CaptionCue, CaptionDocument } from "./types";

export function defaultCaptions(): CaptionDocument {
  return { cues: [], language: "auto", style: { visible: false, font: "Segoe UI", sizePct: 4, position: "bottom", color: "#ffffff", background: true } };
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Persisted text is bounded and plain text, never HTML or subtitle markup. */
export function captionText(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control characters from persisted subtitle text
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
}

export function normalizeCaptions(raw: unknown): CaptionDocument {
  const base = defaultCaptions();
  if (!record(raw)) return base;
  const style = record(raw.style) ? raw.style : {};
  const taken = new Set<string>();
  const cues: CaptionCue[] = [];
  if (Array.isArray(raw.cues)) for (const [i, cue] of raw.cues.slice(0, 50000).entries()) {
    if (!record(cue) || typeof cue.startMs !== "number" || !Number.isFinite(cue.startMs) || typeof cue.endMs !== "number" || !Number.isFinite(cue.endMs) || typeof cue.text !== "string") continue;
    const startMs = Math.max(0, Math.round(cue.startMs));
    const endMs = Math.round(cue.endMs);
    const text = captionText(cue.text);
    if (endMs <= startMs || !text) continue;
    let id = typeof cue.id === "string" && cue.id.length < 100 ? cue.id : `caption-${i}`;
    while (taken.has(id)) id += "-copy";
    taken.add(id);
    cues.push({ id, startMs, endMs, text });
  }
  return {
    cues: cues.sort((a, b) => a.startMs - b.startMs),
    language: typeof raw.language === "string" && /^[a-z]{2,3}$|^auto$/.test(raw.language) ? raw.language : "auto",
    style: {
      visible: typeof style.visible === "boolean" ? style.visible : base.style.visible,
      font: style.font === "Arial" ? "Arial" : "Segoe UI",
      sizePct: typeof style.sizePct === "number" && Number.isFinite(style.sizePct) ? Math.min(8, Math.max(2, style.sizePct)) : base.style.sizePct,
      position: style.position === "top" ? "top" : "bottom",
      color: typeof style.color === "string" && /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : base.style.color,
      background: typeof style.background === "boolean" ? style.background : true,
    },
  };
}
