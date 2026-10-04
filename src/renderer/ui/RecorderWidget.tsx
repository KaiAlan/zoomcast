import { useEffect, useRef, useState } from "react";
import type { RecorderAction, RecorderOptions, RecorderSource, RecorderState } from "../../shared/recorder";
import "./recorder.css";
import { UpdateNotice } from "./UpdateNotice";

const icons = {
  chevron: <path d="m6 9 6 6 6-6" />,
  window: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 8h18M7 5.5h.01M10 5.5h.01"/></>,
  screen: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>,
  mic: <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/></>,
  camera: <><rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 6-4v12l-6-4"/></>,
  sound: <><path d="M11 4 5 9H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  timer: <><circle cx="12" cy="14" r="8"/><path d="M12 10v4l3 2M9 2h6m-3 0v4m6 1 2-2"/></>,
  pause: <><path d="M8 5v14M16 5v14"/></>,
  play: <path d="m8 4 12 8-12 8Z"/>,
  cut: <><circle cx="5" cy="6" r="3"/><circle cx="5" cy="18" r="3"/><path d="m8 8 13 12M8 16 21 4"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  more: <><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></>,
};
function Icon({ name, off = false }: { name: keyof typeof icons; off?: boolean }) {
  return <svg role="img" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}{off && <path d="m3 3 18 18" strokeWidth="2"/>}</svg>;
}
function SourcePreview({ source }: { source?: RecorderSource }) {
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  return <span className="recorder-source-preview">{source?.thumbnail && source.thumbnail !== failedThumbnail
    ? <img src={source.thumbnail} alt="" onError={() => setFailedThumbnail(source.thumbnail)} />
    : <Icon name={source?.kind === "window" ? "window" : "screen"} />}</span>;
}
export function RecorderWidget() {
  const shell = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RecorderState>({ phase: "idle", paused: false, cutting: false, elapsedMs: 0, countdownLeft: 0, error: null });
  const [options, setOptions] = useState<RecorderOptions>({ sourceId: "", countdown: 3, mic: false, system: false, webcam: false, webcamDeviceId: "" });
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sources, setSources] = useState<RecorderSource[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [panel, setPanel] = useState<"source" | "timer" | "more" | null>(null);
  const [sourceQuery, setSourceQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.body.classList.add("recorder-window");
    void window.zoomcast.recorder.state().then(setState);
    void window.zoomcast.getSettings().then(s => setOptions(o => ({ ...o, webcam: s.webcamEnabled, webcamDeviceId: s.webcamDeviceId })));
    const unsubscribe = window.zoomcast.recorder.onState(setState);
    return () => { unsubscribe(); document.body.classList.remove("recorder-window"); };
  }, []);
  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    const observer = new ResizeObserver(() => void window.zoomcast.recorder.resize(el.scrollHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (panel === null) return;
    const close = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setPanel(null);
      const label = panel === "source" ? "Capture source" : panel === "timer" ? "Countdown" : "More options";
      shell.current?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.focus();
    };
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Element && !event.target.closest(".recorder-panel, button[aria-controls]")) setPanel(null);
    };
    const blur = (): void => setPanel(null);
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", close); window.removeEventListener("pointerdown", outside); window.removeEventListener("blur", blur); };
  }, [panel]);
  const idle = state.phase === "idle";
  const recording = state.phase === "recording";
  const act = (action: RecorderAction) => {
    setError(null);
    void window.zoomcast.recorder.action(action, options).catch(e => setError(String(e)));
    if (action === "start") setPanel(null);
  };
  const refreshSources = (): void => {
    setSourcesLoading(true);
    void window.zoomcast.recorder.sources().then(setSources).catch(e => setError(String(e))).finally(() => setSourcesLoading(false));
  };
  const togglePanel = (next: typeof panel) => {
    setPanel(panel === next ? null : next);
    if (next === "source") setSourceQuery("");
    if (next === "source") refreshSources();
    if (next === "more") void navigator.mediaDevices.enumerateDevices().then(d => setDevices(d.filter(x => x.kind === "videoinput"))).catch(e => setError(String(e)));
  };
  const minutes = Math.floor(state.elapsedMs / 60000).toString().padStart(2, "0");
  const seconds = Math.floor(state.elapsedMs / 1000 % 60).toString().padStart(2, "0");
  const selected = sources.find(s => s.id === options.sourceId);
  return <div className="recorder-shell" ref={shell}>
    <div className={`recorder-bar ${idle ? "" : "is-capturing"}`} role="toolbar" aria-label="Recording controls">
      <div className="recorder-grip" title="Drag to move">⠿</div>
      <button type="button" className="recorder-source" aria-label="Capture source" aria-expanded={panel === "source"} aria-controls="recorder-source-panel" disabled={!idle} onClick={() => togglePanel("source")} title={selected?.name ?? "Primary screen"}><Icon name="screen"/><span className="recorder-source-label">{selected?.kind === "window" ? "Window" : "Screen"}<small title="Recording destination">{state.folderName ?? "Library"}</small></span><span className="recorder-chevron"><Icon name="chevron" /></span></button>
      <span className="recorder-divider"/>
      {idle ? <>
        <button type="button" className={options.mic ? "recorder-icon enabled" : "recorder-icon"} title={options.mic ? "Microphone on — click to mute" : "Microphone off — click to enable"} aria-label="Microphone" aria-pressed={options.mic} onClick={() => setOptions(o => ({ ...o, mic: !o.mic }))}><Icon name="mic" off={!options.mic}/></button>
        <button type="button" className={options.system ? "recorder-icon enabled" : "recorder-icon"} title="System audio" aria-label="System audio" aria-pressed={options.system} onClick={() => setOptions(o => ({ ...o, system: !o.system }))}><Icon name="sound" off={!options.system}/></button>
        <button type="button" className={options.webcam ? "recorder-icon enabled" : "recorder-icon"} title="Webcam" aria-label="Webcam" aria-pressed={options.webcam} onClick={() => setOptions(o => ({ ...o, webcam: !o.webcam }))}><Icon name="camera" off={!options.webcam}/></button>
        <button type="button" className="recorder-icon recorder-delay" title="Countdown" aria-label="Countdown" aria-expanded={panel === "timer"} aria-controls="recorder-timer-panel" onClick={() => togglePanel("timer")}><Icon name="timer"/><small>{options.countdown}s</small></button>
      </> : <>
        <span className="recorder-time"><i className={state.paused ? "paused" : ""}/>{recording || state.phase === "stopping" ? `${minutes}:${seconds}` : state.phase === "countdown" ? `${state.countdownLeft}s` : "Starting…"}<small>{state.paused ? "Paused" : state.cutting ? "Marking cut" : state.phase === "recording" ? "Recording" : state.phase === "stopping" ? "Saving…" : "Get ready"}</small></span>
        <button type="button" className={`recorder-icon ${state.paused ? "enabled" : ""}`} disabled={!recording} aria-label={state.paused ? "Resume" : "Pause"} title={state.paused ? "Resume recording" : "Pause — omit time until resumed"} onClick={() => act("pause")}><Icon name={state.paused ? "play" : "pause"}/></button>
        <button type="button" className={`recorder-icon ${state.cutting ? "cutting" : ""}`} disabled={!recording} aria-label={state.cutting ? "End cut" : "Begin cut"} title={state.cutting ? "Finish marking the section to remove" : "Mark a section to remove"} onClick={() => act("cut")}><Icon name="cut"/></button>
      </>}
      <button type="button" className={`recorder-record ${recording ? "active" : ""}`} aria-label={idle ? "Start recording" : recording ? "Stop recording" : state.phase === "countdown" ? "Cancel countdown" : "Please wait"} title={idle ? "Start recording" : recording ? "Stop and open editor" : "Cancel countdown"} disabled={state.phase === "starting" || state.phase === "stopping"} onClick={() => act(idle ? "start" : recording ? "stop" : "cancel")}><span className={recording ? "stop" : state.phase === "countdown" ? "cancel" : "dot"}/></button>
      <span className="recorder-divider"/>
      <button type="button" className="recorder-icon" title="More options" aria-label="More options" aria-expanded={panel === "more"} aria-controls="recorder-more-panel" onClick={() => togglePanel("more")}><Icon name="more"/></button>
      <button type="button" className="recorder-icon" title="Hide widget — shortcut brings it back" aria-label="Hide widget" onClick={() => act("hide")}><span style={{ fontSize: 24 }}>−</span></button>
      <button type="button" className="recorder-icon" title={idle ? "Close widget" : "Hide widget — recording continues"} aria-label="Close widget" onClick={() => act("hide")}><Icon name="close"/></button>
    </div>
    {idle && panel === null && <UpdateNotice recorder />}
    {panel === "source" && <div className="recorder-panel" id="recorder-source-panel">
      <header>Capture source <div className="recorder-panel-actions"><button type="button" disabled={sourcesLoading} onClick={refreshSources}>{sourcesLoading ? "Loading…" : "Refresh"}</button><button type="button" className="recorder-panel-close" aria-label="Close capture sources" onClick={() => setPanel(null)}><Icon name="close" /></button></div></header>
      <input type="search" className="recorder-source-search" aria-label="Search capture sources" placeholder="Find a screen or app window…" value={sourceQuery} onChange={e => setSourceQuery(e.target.value)} />
      <div className="recorder-source-list">
        {sourceQuery.trim() === "" && <button type="button" className={options.sourceId === "" ? "selected" : ""} aria-pressed={options.sourceId === ""} onClick={() => { setOptions(o => ({ ...o, sourceId: "" })); setPanel(null); }}><SourcePreview source={sources.find(source => source.isPrimary && source.kind === "screen")} /><span className="recorder-source-name">Primary screen</span><span className="recorder-source-check">{options.sourceId === "" ? "✓" : ""}</span></button>}
        {["screen", "window"].map(kind => {
          const matching = sources.filter(source => source.kind === kind && source.name.toLowerCase().includes(sourceQuery.trim().toLowerCase()));
          return matching.length > 0 && <div key={kind}><div className="recorder-source-group">{kind === "screen" ? "Screens" : "App windows"}</div>{matching.map(source => <button key={source.id} type="button" className={options.sourceId === source.id ? "selected" : ""} aria-pressed={options.sourceId === source.id} title={source.name} onClick={() => { setOptions(o => ({ ...o, sourceId: source.id })); setPanel(null); }}><SourcePreview source={source} /><span className="recorder-source-name">{source.name}</span><span className="recorder-source-check">{options.sourceId === source.id ? "✓" : ""}</span></button>)}</div>;
        })}
        {sourcesLoading && <div className="recorder-empty" role="status">Loading screens and windows…</div>}
        {!sourcesLoading && sourceQuery.trim() !== "" && !sources.some(source => source.name.toLowerCase().includes(sourceQuery.trim().toLowerCase())) && <div className="recorder-empty">No matching screens or windows.</div>}
      </div>
      <p>Keep the selected app window restored and at the same size during recording.</p>
    </div>}
    {panel === "timer" && <div className="recorder-panel" id="recorder-timer-panel"><header>Start recording after</header><div className="recorder-choices">{([0, 3, 5, 10] as const).map(n => <button type="button" className={options.countdown === n ? "selected" : ""} aria-pressed={options.countdown === n} key={n} onClick={() => { setOptions(o => ({ ...o, countdown: n })); setPanel(null); }}>{n === 0 ? "No delay" : `${n} seconds`}</button>)}</div></div>}
    {panel === "more" && <div className="recorder-panel" id="recorder-more-panel"><header>Recording options</header><label>Camera device<select disabled={!idle} value={options.webcamDeviceId} onChange={e => setOptions(o => ({ ...o, webcamDeviceId: e.target.value }))}><option value="">Default camera</option>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label><div className="recorder-choices"><button type="button" onClick={() => act("editor")}>Open library / editor</button><button type="button" onClick={() => void window.zoomcast.openSettings()}>Settings</button></div><p>The toolbar stays on your desktop and is excluded from your video.</p></div>}
    {(error || state.error) && <div className="recorder-error" role="alert">{error || state.error}</div>}
  </div>;
}
