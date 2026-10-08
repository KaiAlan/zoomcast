import type { ExportJob } from "../shared/export/jobs";
import { exportFinished } from "../shared/export/jobs";
import { ExportPage } from "./ui/ExportPage";
import { ExportWindow } from "./ui/ExportWindow";
import { ExportActivity } from "./ui/ExportActivity";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenedBundle } from "../shared/api";
import { installAudioHooks } from "./audio";
import { installWebcamHooks } from "./webcam";
import { installShootHook } from "./shoot";
import { Editor } from "./ui/Editor";
import { SettingsWindow } from "./ui/SettingsWindow";
import { Welcome } from "./ui/Welcome";
import { UpdateNotice } from "./ui/UpdateNotice";
import { FeedbackButton } from "./ui/FeedbackButton";

/** The headless screenshot harness, used by tools/verify-decode.ts. */
function ShootHarness() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas !== null) installShootHook(canvas);
  }, []);

  return <canvas ref={canvasRef} width={1280} height={720} />;
}

export function App() {
  const [activeTab, setActiveTab] = useState<"editor" | "exports">("editor");
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [bundle, setBundle] = useState<OpenedBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isExport = window.location.hash === "#export";
  const isShoot = window.location.hash === "#shoot";
  const isAudio = window.location.hash === "#audio";
  const isWebcam = window.location.hash === "#webcam";
  const isSettings = window.location.hash === "#settings";

  // The hidden audio-capture window renders nothing; it only exposes hooks.
  useEffect(() => {
    if (isAudio) installAudioHooks();
  }, [isAudio]);
  useEffect(() => { if (isWebcam) installWebcamHooks(); }, [isWebcam]);

  const open = useCallback(async (dir: string) => {
    try {
      setBundle(await window.zoomcast.openBundle(dir));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Opening a finished recording lives here rather than in Welcome, so it also
  // works when a take is started by hotkey while the editor is already open.
  useEffect(() => {
    if (isShoot || isAudio || isWebcam || isExport) return;
    return window.zoomcast.recording.onStopped((result) => void open(result.dir));
  }, [isShoot, isAudio, isWebcam, isExport, open]);

  // ?bundle=<path> auto-opens, which is how the UI screenshot mode drives this.
  useEffect(() => {
    if (isShoot) return;
    const dir = new URLSearchParams(window.location.search).get("bundle");
    if (dir !== null && dir.trim() !== "") void open(dir);
  }, [isShoot, open]);

  useEffect(() => {
    if (isExport || isAudio || isWebcam || isShoot || isSettings) return;
    const showExport = (id: string): void => { setSelectedJob(id); setActiveTab("exports"); };
    const opened = (event: Event): void => showExport((event as CustomEvent<string>).detail);
    const unsubscribe = window.zoomcast.exports.onChanged(setJobs);
    const unsubscribeOpen = window.zoomcast.exports.onOpen(showExport);
    void window.zoomcast.exports.list().then(setJobs);
    window.addEventListener("zoomcast:export", opened);
    return () => { unsubscribe(); unsubscribeOpen(); window.removeEventListener("zoomcast:export", opened); };
  }, [isExport, isAudio, isWebcam, isShoot, isSettings]);

  if (isExport) return <ExportWindow />;
  if (isAudio || isWebcam) return null;
  if (isShoot) return <ShootHarness />;
  if (isSettings) return <SettingsWindow />;
  const active = jobs.filter(job => !exportFinished(job.phase));
  const current = jobs.find(job => job.id === selectedJob) ?? jobs.at(-1);
  return <div className="workspace-shell">
    <nav className="workspace-tabs" aria-label="Workspace tabs">
      <button type="button" aria-pressed={activeTab === "editor"} onClick={() => setActiveTab("editor")}>{bundle ? "Editor" : "Recordings"}</button>
      <button type="button" aria-pressed={activeTab === "exports"} onClick={() => setActiveTab("exports")}>Exports{active.length > 0 ? ` (${active.length})` : ""}</button>
      {activeTab === "exports" && jobs.length > 1 && <select aria-label="Export job" value={current?.id} onChange={event => setSelectedJob(event.target.value)}>{jobs.map(job => <option key={job.id} value={job.id}>{job.file.split(/[\\/]/).at(-1)} · {job.phase}</option>)}</select>}
      <UpdateNotice />
      <FeedbackButton />
    </nav>
    <div className="workspace-main">
      <div className="workspace-editor-pane" style={activeTab === "exports" ? {display:"none"} : undefined}>
        {bundle ? <Editor key={bundle.dir} bundle={bundle} onBack={() => setBundle(null)} /> : <Welcome error={error} onOpen={dir => void open(dir)} />}
        <ExportActivity />
      </div>
      {activeTab === "exports" && (current ? <ExportPage job={current} onCancel={() => { void window.zoomcast.exports.cancel(current.id); }} onBackground={() => setActiveTab("editor")} onBack={() => setActiveTab("editor")} /> : <div className="export-page"><h1>No exports yet</h1><p>Export a recording to see its progress here.</p><button type="button" className="primary-action" onClick={() => setActiveTab("editor")}>Back to recordings</button></div>)}
    </div>
  </div>;
}
