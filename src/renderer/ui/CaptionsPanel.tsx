import { useEffect, useMemo, useRef, useState } from "react";
import type { OpenedBundle } from "../../shared/api";
import { defaultCaptions } from "../../shared/captions/document";
import type { CaptionDocument, CaptionSource, CaptionStyle } from "../../shared/captions/types";
import { outputCaptions } from "../../shared/captions/timing";
import type { Project } from "../../shared/project/types";
import { SpeechDownload, useSpeechState } from "./SpeechDownload";
import { SliderField } from "./SliderField";
import { fieldLabel, row, selectInput } from "./controls";
import "./captions.css";

const LANGUAGES = [["auto", "Detect language"], ["en", "English"], ["hi", "Hindi"], ["bn", "Bengali"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"], ["ja", "Japanese"], ["zh", "Chinese"], ["ko", "Korean"], ["ar", "Arabic"], ["ru", "Russian"]] as const;
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${(ms / 1000 % 60).toFixed(1).padStart(4, "0")}`;

export function CaptionsPanel({ active, bundle, project, onChange, onTransient, onCommit, onSeek }: {
  active: boolean;
  bundle: OpenedBundle;
  project: Project;
  onChange: (captions: CaptionDocument) => void;
  onTransient: (captions: CaptionDocument) => void;
  onCommit: () => void;
  onSeek: (ms: number) => void;
}) {
  const captions = project.captions ?? defaultCaptions();
  const { state, error: stateError } = useSpeechState();
  const [source, setSource] = useState<CaptionSource>(bundle.manifest.audio.some(t => t.role === "mic") ? "mic" : "system");
  const [language, setLanguage] = useState(captions.language);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const alive = useRef(true);
  const generating = useRef(false);
  const latest = useRef(captions);
  latest.current = captions;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (generating.current) void window.zoomcast.captions.cancel().catch(() => undefined); };
  }, []);
  const output = useMemo(() => outputCaptions(project, bundle.manifest.durationMs), [project, bundle.manifest.durationMs]);
  const selected = captions.cues.find(c => c.id === selectedId) ?? captions.cues[0];
  const filtered = useMemo(() => captions.cues.filter(c => c.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [captions.cues, query]);
  const setStyle = (patch: Partial<CaptionStyle>) => onChange({ ...captions, style: { ...captions.style, ...patch } });
  const generate = async () => {
    setPending(true); setMessage(""); generating.current = true;
    try {
      const cues = await window.zoomcast.captions.generate({ dir: bundle.dir, source, language });
      if (!alive.current) return;
      if (cues.length) {
        onChange({ ...latest.current, cues, language, style: { ...latest.current.style, visible: true } });
        setSelectedId(cues[0]?.id ?? null);
        setQuery(""); setLimit(100);
        setMessage("Transcript ready. Review the text, then save your project.");
      } else setMessage("No speech recognized. Try another audio source or language.");
    } catch (e) { if (alive.current) setMessage(e instanceof Error ? e.message : String(e)); }
    finally { generating.current = false; if (alive.current) setPending(false); }
  };
  const exportText = async (format: "srt" | "vtt") => {
    setMessage("");
    try { if (await window.zoomcast.captions.exportSubtitles({ dir: bundle.dir, project, format })) setMessage(`${format.toUpperCase()} subtitles exported.`); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
  };
  return <section hidden={!active} className="captions-panel" aria-label="Captions controls">
    <div className="caption-heading">Transcript & captions</div>
    <SpeechDownload state={state} />
    {!bundle.manifest.audio.length ? <p className="control-help">This recording has no audio. Record with a microphone or system audio to generate a transcript.</p> : <>
      <label style={row}><span style={fieldLabel}>Speech source</span><select aria-label="Speech source" style={selectInput} value={source} disabled={pending || state?.busy} onChange={e => setSource(e.target.value as CaptionSource)}>
        {bundle.manifest.audio.some(t => t.role === "mic") && <option value="mic">Microphone</option>}
        {bundle.manifest.audio.some(t => t.role === "system") && <option value="system">System audio</option>}
        {bundle.manifest.audio.length > 1 && <option value="mix">Both tracks</option>}
      </select></label>
      <label style={row}><span style={fieldLabel}>Language</span><select aria-label="Transcript language" style={selectInput} value={language} disabled={pending || state?.busy} onChange={e => setLanguage(e.target.value)}>{LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}{!LANGUAGES.some(([code]) => code === language) && <option value={language}>{language}</option>}</select></label>
      <button type="button" className="primary-action" disabled={!state?.installed || state.busy || pending} onClick={() => void generate()}>{pending ? "Generating transcript…" : captions.cues.length ? "Regenerate transcript" : "Generate transcript"}</button>
      {captions.cues.length > 0 && <p className="control-help">Regenerating replaces the text. Undo restores your previous transcript.</p>}
    </>}
    {(message || stateError) && <p role="status" className="caption-message">{message || stateError}</p>}
    {captions.cues.length > 0 && <>
      <div className="subsection-label">Caption appearance</div>
      <label style={row}><span style={fieldLabel}>Show in video</span><input aria-label="Show captions" type="checkbox" checked={captions.style.visible} onChange={e => setStyle({ visible: e.target.checked })} /></label>
      <label style={row}><span style={fieldLabel}>Font</span><select aria-label="Caption font" style={selectInput} value={captions.style.font} onChange={e => setStyle({ font: e.target.value as CaptionStyle["font"] })}><option>Segoe UI</option><option>Arial</option></select></label>
      <SliderField label="Caption size" min={2} max={8} step={0.25} unit="%" value={captions.style.sizePct} onChange={sizePct => setStyle({ sizePct })} />
      <label style={row}><span style={fieldLabel}>Position</span><select aria-label="Caption position" style={selectInput} value={captions.style.position} onChange={e => setStyle({ position: e.target.value as CaptionStyle["position"] })}><option value="bottom">Bottom</option><option value="top">Top</option></select></label>
      <label style={row}><span style={fieldLabel}>Text color</span><input aria-label="Caption color" type="color" value={captions.style.color} onChange={e => setStyle({ color: e.target.value })} /></label>
      <label style={row}><span style={fieldLabel}>Background</span><input aria-label="Caption background" type="checkbox" checked={captions.style.background} onChange={e => setStyle({ background: e.target.checked })} /></label>
      <p className="control-help">Visible captions are included in your MP4. Subtitle files use the current cuts, clip order, and audio sync offset.</p>
      <div className="caption-actions"><button type="button" className="quiet-action" disabled={!output.length} onClick={() => void exportText("srt")}>Export SRT</button><button type="button" className="quiet-action" disabled={!output.length} onClick={() => void exportText("vtt")}>Export VTT</button></div>
      <div className="subsection-label">Transcript · {captions.cues.length} segments</div>
      <input className="caption-search" type="search" aria-label="Search transcript" placeholder="Search transcript" value={query} onChange={e => { setQuery(e.target.value); setLimit(100); }} />
      <section className="caption-list" aria-label="Transcript segments">
        {filtered.slice(0, limit).map(cue => {
          const span = output.find(c => c.id.endsWith(`:${cue.id}`));
          return <button type="button" key={cue.id} className={`caption-cue ${selected?.id === cue.id ? "selected" : ""}`} aria-pressed={selected?.id === cue.id} onClick={() => { setSelectedId(cue.id); if (span) onSeek(span.startMs); }}><span className="caption-time">{clock(cue.startMs)}{!span && " · cut"}</span><span>{cue.text || "Empty caption"}</span></button>;
        })}
        {!filtered.length && <p className="control-help">No matching text.</p>}
      </section>
      {filtered.length > limit && <button type="button" className="quiet-action" onClick={() => setLimit(limit + 100)}>Show more segments</button>}
      {selected && <div className="caption-edit">
        <label htmlFor="caption-text">Edit selected text</label>
        <textarea id="caption-text" aria-label="Caption text" maxLength={2000} rows={4} value={selected.text} onChange={e => onTransient({ ...captions, cues: captions.cues.map(c => c.id === selected.id ? { ...c, text: e.target.value } : c) })} onBlur={onCommit} />
        <div className="caption-timing">
          <label>Start (seconds)<input type="number" aria-label="Caption start" min={0} max={(selected.endMs - 1) / 1000} step={0.1} value={selected.startMs / 1000} onChange={e => { const value = e.target.valueAsNumber; if (Number.isFinite(value)) onChange({ ...captions, cues: captions.cues.map(c => c.id === selected.id ? { ...c, startMs: Math.max(0, Math.min(c.endMs - 1, Math.round(value * 1000))) } : c) }); }} /></label>
          <label>End (seconds)<input type="number" aria-label="Caption end" min={(selected.startMs + 1) / 1000} max={bundle.manifest.durationMs / 1000} step={0.1} value={selected.endMs / 1000} onChange={e => { const value = e.target.valueAsNumber; if (Number.isFinite(value)) onChange({ ...captions, cues: captions.cues.map(c => c.id === selected.id ? { ...c, endMs: Math.max(c.startMs + 1, Math.min(bundle.manifest.durationMs, Math.round(value * 1000))) } : c) }); }} /></label>
        </div>
        <button type="button" className="quiet-action" onClick={() => onChange({ ...captions, cues: captions.cues.filter(c => c.id !== selected.id) })}>Delete caption</button>
      </div>}
    </>}
  </section>;
}
