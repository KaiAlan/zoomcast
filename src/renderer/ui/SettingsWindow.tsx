import { useEffect, useRef, useState } from "react";
import { CAPTURE_FPS_CHOICES, type Settings } from "../../shared/settings/types";
import { CameraCheck, MicrophoneCheck } from "./DeviceChecks";
import { FeedbackButton } from "./FeedbackButton";
import { Icon, type IconName } from "./Icon";
import { ShortcutSettings } from "./ShortcutSettings";
import { SpeechDownload, useSpeechState } from "./SpeechDownload";
import { UpdateNotice, WhatsNew } from "./UpdateNotice";
import "./captions.css";
import "./settings.css";

const SECTIONS = [
  { id: "general", title: "General", icon: "settings", description: "Appearance, shortcuts and startup.", keywords: "theme light dark system appearance hotkey shortcut start windows startup" },
  { id: "recording", title: "Recording", icon: "video", description: "Set up your next recording.", keywords: "capture frame rate fps webcam camera microphone audio system sound noise suppression echo cancellation gain volume test preview permissions" },
  { id: "captions", title: "Captions", icon: "captions", description: "Free transcription that runs on your computer.", keywords: "offline speech transcript subtitles model download language storage" },
  { id: "updates", title: "App updates", icon: "restart", description: "Your version, updates and release notes.", keywords: "version upgrade restart release new check download" },
  { id: "help", title: "Help & feedback", icon: "message", description: "Share a problem or an idea with us.", keywords: "support bug issue report feedback help" },
] as const satisfies ReadonlyArray<{ id: string; title: string; icon: IconName; description: string; keywords: string }>;
type SectionId = typeof SECTIONS[number]["id"];

/** Settings stay mounted across sections; live device checks run only while visible. */
export function SettingsWindow() {
  const speech = useSpeechState();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<SectionId>("general");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const saveRequest = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState("");
  const [busy, setBusy] = useState(false);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void window.zoomcast.getSettings().then(next => { if (live) setSettings(next); }).catch(() => { if (live) setLoadError(true); });
    const unsubscribe = window.zoomcast.onSettingsChanged(next => { if (live) setSettings(next); });
    return () => { live = false; unsubscribe(); };
  }, []);
  const refreshDevices = () => {
    void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => setDeviceError("Device list unavailable. Check Windows microphone and camera permissions."));
  };
  useEffect(() => {
    let live = true;
    const refresh = () => { void navigator.mediaDevices.enumerateDevices().then(next => { if (live) setDevices(next); }).catch(() => { if (live) setDeviceError("Device list unavailable. Check Windows microphone and camera permissions."); }); };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    void window.zoomcast.recorder.state().then(state => { if (live) setBusy(state.phase !== "idle"); });
    const unsubscribe = window.zoomcast.recorder.onState(state => setBusy(state.phase !== "idle"));
    return () => { live = false; unsubscribe(); navigator.mediaDevices.removeEventListener("devicechange", refresh); };
  }, []);
  const cameras = devices.filter(d => d.kind === "videoinput");
  const microphones = devices.filter(d => d.kind === "audioinput" && d.deviceId !== "communications");

  const matches = SECTIONS.filter(section => `${section.title} ${section.keywords}`.toLowerCase().includes(query.trim().toLowerCase()));
  const active = matches.find(section => section.id === selected) ?? matches[0];

  const update = async (next: Settings) => {
    const request = ++saveRequest.current;
    setSettings(next); setSaving(true); setSaveError(false);
    try { await window.zoomcast.setSettings(next); }
    catch { if (request === saveRequest.current) setSaveError(true); }
    finally { if (request === saveRequest.current) setSaving(false); }
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
            <div className="settings-camera"><label className="settings-row"><span>Camera</span><select aria-label="Camera" value={settings.webcamDeviceId} onChange={event => void update({ ...settings, webcamDeviceId: event.target.value })}><option value="">Default camera</option>{cameras.map((camera, i) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${i + 1}`}</option>)}{settings.webcamDeviceId && !cameras.some(camera => camera.deviceId === settings.webcamDeviceId) && <option value={settings.webcamDeviceId}>Selected camera (disconnected)</option>}</select></label>
            {active?.id === "recording" && !busy && <CameraCheck key={settings.webcamDeviceId} deviceId={settings.webcamDeviceId} refreshDevices={refreshDevices} />}
            <button type="button" className="settings-action" onClick={() => void window.zoomcast.openMediaSettings("camera").catch(() => setDeviceError("Open Windows Settings → Privacy & security → Camera to allow desktop apps."))}>Camera permissions</button><p className="settings-hint">Applies to the next recording. Adjust webcam position and appearance in the editor.</p></div>
          </div>
          <div className="settings-card"><h2>Audio</h2>
            <label className="settings-row"><span><span>Microphone</span><small>Used by the recorder and the test below.</small></span><select aria-label="Microphone device" value={settings.microphoneDeviceId} onChange={event => void update({ ...settings, microphoneDeviceId: event.target.value })}><option value="">Default microphone</option>{microphones.filter(d => d.deviceId !== "default").map((mic, i) => <option key={mic.deviceId} value={mic.deviceId}>{mic.label || `Microphone ${i + 1}`}</option>)}{settings.microphoneDeviceId && !microphones.some(mic => mic.deviceId === settings.microphoneDeviceId) && <option value={settings.microphoneDeviceId}>Selected microphone (disconnected)</option>}</select></label>
            {([
              ["noiseSuppression", "Noise suppression", "Reduce steady background noise."],
              ["echoCancellation", "Echo cancellation", "Reduce speaker audio picked up by your microphone."],
              ["autoGainControl", "Automatic microphone volume", "Let your device balance quiet and loud speech."],
            ] as const).map(([field, label, hint]) => <label className="settings-row" key={field}><span><span>{label}</span><small>{hint}</small></span><input type="checkbox" role="switch" aria-checked={settings[field]} aria-label={label} checked={settings[field]} onChange={event => void update({ ...settings, [field]: event.target.checked })} /></label>)}
            {active?.id === "recording" && !busy && <MicrophoneCheck key={`${settings.microphoneDeviceId}:${settings.noiseSuppression}:${settings.echoCancellation}:${settings.autoGainControl}`} settings={settings} refreshDevices={refreshDevices} />}
            <button type="button" className="settings-action" onClick={() => void window.zoomcast.openMediaSettings("microphone").catch(() => setDeviceError("Open Windows Settings → Privacy & security → Microphone to allow desktop apps."))}>Microphone permissions</button><p className="settings-hint">Enable microphone and system audio in the recording widget before each take. Processing changes apply to the next recording; device support may vary. Adjust volume and audio sync in the editor.</p>
          </div>
          {busy && <p className="settings-hint" role="status">Finish the current recording before testing devices. Changes apply to your next take.</p>}
          {deviceError && <p className="settings-hint" role="status">{deviceError}</p>}
        </section>
        <section className="settings-panel" aria-label="Caption settings" hidden={active?.id !== "captions"}><div className="settings-card"><h2>Offline caption support</h2><SpeechDownload state={speech.state} management />{speech.error && <p role="alert">{speech.error}</p>}</div><div className="settings-card"><h2>Working with transcripts</h2><p className="settings-hint">Open Captions in the editor to generate and correct a transcript, style captions, or export SRT and VTT subtitles. Your audio stays on your computer.</p></div></section>
        <section className="settings-panel" aria-label="App update settings" hidden={active?.id !== "updates"}><div className="settings-card"><h2>Check for updates</h2><UpdateNotice settings /><p className="settings-hint">Zoomcast checks once when you open the app. Updates download when you choose Update. Restart when your recording, export and caption tasks are finished.</p></div><WhatsNew settings /></section>
        <section className="settings-panel" aria-label="Help and feedback" hidden={active?.id !== "help"}><div className="settings-card"><h2>Send feedback</h2><p className="settings-hint">Report a problem or suggest an improvement. You can review your report before sending it on GitHub.</p><FeedbackButton /></div></section>
      {!active && <div className="settings-empty"><Icon name="search" size={28} /><h1>No settings found</h1><p>Try “camera”, “theme”, “captions” or “updates”.</p><button type="button" className="settings-action" onClick={() => setQuery("")}>Clear search</button></div>}
    </div>
  </div>;
}
