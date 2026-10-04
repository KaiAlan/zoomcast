import { useEffect, useState } from "react";
import type { ExportJob } from "../../shared/export/jobs";
import { exportFinished } from "../../shared/export/jobs";
import { Icon } from "./Icon";
export function ExportActivity() {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    const unsubscribe = window.zoomcast.exports.onChanged(setJobs);
    void window.zoomcast.exports.list().then(setJobs);
    return unsubscribe;
  }, []);
  const active = jobs.filter(job => !exportFinished(job.phase));
  const latest = active.at(-1) ?? jobs.at(-1);
  if (!latest || (active.length === 0 && latest.id === dismissed)) return null;
  const label = active.length > 0 ? `${active.length} export${active.length > 1 ? "s" : ""} running` : latest.phase === "done" ? "Export complete" : latest.phase === "cancelled" ? "Export cancelled" : "Export needs attention";
  return <aside className="export-activity" aria-label="Background exports">
    <button type="button" onClick={() => { void window.zoomcast.exports.show(latest.id); }}><Icon name="output" size={16} />{label}</button>
    {active.length === 0 && <button type="button" aria-label="Dismiss export status" onClick={() => setDismissed(latest.id)}>×</button>}
  </aside>;
}
