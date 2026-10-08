import { useEffect, useRef, useState } from "react";
import { CAPTURE_FPS_CHOICES, type Settings } from "../../shared/settings/types";
import { FeedbackButton } from "./FeedbackButton";
import { Icon, type IconName } from "./Icon";
import { ShortcutSettings } from "./ShortcutSettings";
import { SpeechDownload, useSpeechState } from "./SpeechDownload";
import { UpdateNotice, WhatsNew } from "./UpdateNotice";
import "./captions.css";
import "./settings.css";

const SECTIONS = [
  { id: "general", title: "General", icon: "settings", description: "Appearance, shortcuts and startup.", keywords: "theme light dark system appearance hotkey shortcut start windows startup" },
  { id: "recording", title: "Recording", icon: "video", description: "Set up your next recording.", keywords: "capture frame rate fps webcam camera microphone audio system sound" },
  { id: "captions", title: "Captions", icon: "captions", description: "Free transcription that runs on your computer.", keywords: "offline speech transcript subtitles model download language storage" },
  { id: "updates", title: "App updates", icon: "restart", description: "Your version, updates and release notes.", keywords: "version upgrade restart release new check download" },
  { id: "help", title: "Help & feedback", icon: "message", description: "Share a problem or an idea with us.", keywords: "support bug issue report feedback help" },
] as const satisfies ReadonlyArray<{ id: string; title: string; icon: IconName; description: string; keywords: string }>;
type SectionId = typeof SECTIONS[number]["id"];

/** Settings stay mounted across sections, preserving pending tasks and camera feedback. */
export function SettingsWindow() {
  const speech = useSpeechState();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<SectionId>("general");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const saveRequest = useRef(0);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraStatus, setCameraStatus] = useState("");
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void window.zoomcast.getSettings().then(next => { if (live) setSettings(next); }).catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void navigator.mediaDevices.enumerateDevices().then(devices => {
        if (live) setCameras(devices.filter(d => d.kind === "videoinput"));
      }).catch(() => { if (live) setCameraStatus("Camera devices unavailable"); });
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => { live = false; navigator.mediaDevices.removeEventListener("devicechange", refresh); };
  }, []);

  const matches = SECTIONS.filter(section => `${section.title} ${section.keywords}`.toLowerCase().includes(query.trim().toLowerCase()));
  const active = matches.find(section => section.id === selected) ?? matches[0];

  const update = async (next: Settings) => {
    const request = ++saveRequest.current;
    setSettings(next); setSaving(true); setSaveError(false);
    try { await window.zoomcast.setSettings(next); }
    catch { if (request === saveRequest.current) setSaveError(true); }
    finally { if (request === saveRequest.current) setSaving(false); }
  };
  const checkCamera = async () => {
    if (!settings) return;
    setCameraStatus("Checking camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: settings.webcamDeviceId ? { deviceId: { exact: settings.webcamDeviceId } } : true, audio: false });
      for (const track of stream.getTracks()) track.stop();
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter(d => d.kind === "videoinput")); setCameraStatus("Camera ready");
    } catch (error) { setCameraStatus(error instanceof Error ? error.message : "Camera unavailable"); }
  };

  if (!settings) return <div className="settings-loading" role="status">{loadError ? <>Could not load settings. <button type="button" onClick={() => window.location.reload()}>Try again</button></> : "Loading settings…"}</div>;
  return <div className="settings-page">
    <aside className="settings-sidebar">
      <div className="settings-brand"><span className="settings-brand-mark">Z</span><div>Zoomcast<span className="settings-brand-label">Settings</span></div></div>
      <div className="settings-search"><Icon name="search" size={16} /><input type="search" aria-label="Search settings" placeholder="Search settings…" value={query} onChange={event => { setQuery(event.target.value); content.current?.scrollTo(0, 0); }} /></div>
      <nav aria-label="Settings sections">{matches.map(section => <button key={section.id} type="button" aria-current={active?.id === section.id ? "page" : undefined} onClick={() => { setSelected(section.id); content.current?.scrollTo(0, 0); }}><Icon name={section.icon} size={18} />{section.title}</button>)}</nav>
      <p className="settings-save-state" role="status">{saving ? "Saving changes…" : saveError ? "Changes could not be saved." : "Changes save automatically."}</p>
      {saveError && <button type="button" className="settings-action" onClick={() => void update(settings)}>Retry saving</button>}
    </aside>
    <div ref={content} className="settings-content">
      {active && <header className="settings-heading"><h1>{active.title}</h1><p>{active.description}</p></header>}
        <section className="settings-panel" aria-label="General settings" hidden={active?.id !== "general"}>
          <div className="settings-card"><h2>Appearance</h2><label className="settings-row"><span><span>Theme</span><small>Choose the look of every Zoomcast window.</small></span><select aria-label="Theme" value={settings.theme} onChange={event => void update({ ...settings, theme: event.target.value as Settings["theme"] })}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></label><p className="settings-hint">System follows your Windows appearance.</p></div>
          <div className="settings-card"><ShortcutSettings /></div>
        </section>
        <section className="settings-panel" aria-label="Recording settings" hidden={active?.id !== "recording"}>
          <div className="settings-card"><h2>Screen capture</h2><label className="settings-row"><span><span>Capture frame rate</span><small>Preferred rate for the fallback recorder.</small></span><select aria-label="Capture frame rate" value={settings.captureFps} onChange={event => void update({ ...settings, captureFps: Number(event.target.value) as Settings["captureFps"] })}>{CAPTURE_FPS_CHOICES.map(fps => <option key={fps} value={fps}>{fps} fps</option>)}</select></label><p className="settings-hint">The main screen recorder targets 60 fps automatically. Each recording shows the rate it achieved.</p></div>
          <div className="settings-card"><h2>Webcam</h2><label className="settings-row"><span><span>Record webcam</span><small>Capture camera video alongside your screen.</small></span><input type="checkbox" role="switch" aria-checked={settings.webcamEnabled} aria-label="Record webcam" checked={settings.webcamEnabled} onChange={event => void update({ ...settings, webcamEnabled: event.target.checked })} /></label>
            {settings.webcamEnabled && <div className="settings-camera"><label className="settings-row"><span>Camera</span><select aria-label="Camera" value={settings.webcamDeviceId} onChange={event => void update({ ...settings, webcamDeviceId: event.target.value })}><option value="">Default camera</option>{cameras.map((camera, i) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${i + 1}`}</option>)}{settings.webcamDeviceId && !cameras.some(camera => camera.deviceId === settings.webcamDeviceId) && <option value={settings.webcamDeviceId}>Selected camera (disconnected)</option>}</select></label><button type="button" className="settings-action" onClick={() => void checkCamera()}>Check camera</button><p className="settings-hint">Applies to the next recording. Adjust webcam position and appearance in the editor.</p></div>}
            {cameraStatus && <p className="settings-hint" role="status">{cameraStatus}</p>}
          </div>
          <div className="settings-card"><h2>Audio</h2><p className="settings-hint">Choose microphone and system audio in the recording controls before each take. Adjust their volume and sync in the editor’s Audio panel.</p></div>
        </section>
        <section className="settings-panel" aria-label="Caption settings" hidden={active?.id !== "captions"}><div className="settings-card"><h2>Offline caption support</h2><SpeechDownload state={speech.state} management />{speech.error && <p role="alert">{speech.error}</p>}</div><div className="settings-card"><h2>Working with transcripts</h2><p className="settings-hint">Open Captions in the editor to generate and correct a transcript, style captions, or export SRT and VTT subtitles. Your audio stays on your computer.</p></div></section>
        <section className="settings-panel" aria-label="App update settings" hidden={active?.id !== "updates"}><div className="settings-card"><h2>Check for updates</h2><UpdateNotice settings /><p className="settings-hint">Zoomcast checks once when you open the app. Updates download when you choose Update. Restart when your recording, export and caption tasks are finished.</p></div><WhatsNew settings /></section>
        <section className="settings-panel" aria-label="Help and feedback" hidden={active?.id !== "help"}><div className="settings-card"><h2>Send feedback</h2><p className="settings-hint">Report a problem or suggest an improvement. You can review your report before sending it on GitHub.</p><FeedbackButton /></div></section>
      {!active && <div className="settings-empty"><Icon name="search" size={28} /><h1>No settings found</h1><p>Try “camera”, “theme”, “captions” or “updates”.</p><button type="button" className="settings-action" onClick={() => setQuery("")}>Clear search</button></div>}
    </div>
  </div>;
}
