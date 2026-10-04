import type { ExportJob } from "../../shared/export/jobs";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import "./export.css";

const durationLabel = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
};
export function ExportPage({ job, onCancel, onBack, onBackground }: {
  job: ExportJob; onCancel: () => void; onBack: () => void; onBackground: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const terminal = ["done", "failed", "cancelled"].includes(job.phase);
  useEffect(() => {
    if (terminal) { setNow(Date.now()); return; }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [terminal]);
  const elapsed = Math.max(0, now - job.startedAt);
  const ratio = job.total > 0 ? job.done / job.total : 0;
  const percent = job.phase === "done" ? 100 : job.phase === "finishing" ? 99 : Math.min(98, Math.floor(ratio * 98));
  const remaining = job.done > 10 && job.phase === "rendering" ? elapsed * (1 - ratio) / ratio : null;
  const heading = job.phase === "done" ? "Your video is ready" : job.phase === "failed" ? "Export couldn’t finish" : job.phase === "cancelled" ? "Export cancelled" : "Exporting your video";
  const detail = job.phase === "preparing" ? "Preparing your recording…" : job.phase === "finishing" ? "Finishing the video and audio…" : job.phase === "rendering" ? "Rendering your edits" : job.phase === "done" ? "Saved to your chosen location." : job.phase === "cancelled" ? "Your recording and edits are still saved." : job.error;
  return <main className="export-page" aria-label="Video export">
    <div className="export-brand"><span className="rail-brand" aria-hidden="true">z</span><span>zoomcast</span></div>
    <section className="export-card">
      <div className="export-heading-icon"><Icon name="output" size={26} /></div>
      <h1>{heading}</h1><p className="export-detail" role="status">{detail}</p>
      <div className="export-preview">{job.preview ? <img src={job.preview} alt="Export preview" /> : <div className="export-preview-placeholder">Preparing preview…</div>}<span>{terminal ? "Video preview" : "Live preview"}</span></div>
      <div className="export-progress-label"><span>{job.phase === "done" ? "Complete" : terminal ? "Stopped" : job.phase === "finishing" ? "Almost there" : "Export progress"}</span><strong>{percent}%</strong></div>
      <div className="export-progress-track" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div style={{width:`${percent}%`}} /></div>
      <div className="export-timing"><span>Elapsed {durationLabel(elapsed)}</span><span>{remaining === null ? (terminal ? "" : "Estimating time…") : `About ${durationLabel(remaining)} remaining`}</span></div>
      {job.phase === "done" && <p className="export-destination" title={job.file}>{job.file}</p>}
      <div className="export-actions">{terminal ? <button type="button" className="primary-action" onClick={onBack}>Back to editor</button> : <><button type="button" className="primary-action" onClick={onBackground}>Continue in background</button><button type="button" className="quiet-action" disabled={job.phase === "finishing"} onClick={onCancel}>Cancel export</button></>}</div>
    </section>
  </main>;
}
