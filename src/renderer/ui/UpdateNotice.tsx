import { useEffect, useState } from "react";
import type { ReleaseSummary, UpdateState } from "../../shared/updates";
import "./updates.css";

function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    let pushed = false;
    const unsubscribe = window.zoomcast.updates.onChanged(next => { pushed = true; if (live) setState(next); });
    void window.zoomcast.updates.state().then(next => { if (live && !pushed) setState(next); });
    return () => { live = false; unsubscribe(); };
  }, []);
  return state;
}

function ReleaseHighlights({ release }: { release: ReleaseSummary }) {
  const [error, setError] = useState("");
  return <>
    {release.highlights.length > 0 && <ul>{release.highlights.map(line => <li key={line}>{line}</li>)}</ul>}
    <button type="button" onClick={() => {
      setError("");
      void window.zoomcast.updates.openReleaseNotes(release.version).catch(() => setError("Could not open release notes. Please try again."));
    }}>Full release notes on GitHub</button>
    {error && <p role="status">{error}</p>}
  </>;
}

/** Kept outside the timeline toolbar; recorder only renders this while idle. */
export function WhatsNew({ settings = false, recorder = false }: { settings?: boolean; recorder?: boolean }) {
  const state = useUpdateState();
  const [error, setError] = useState("");
  if (!state?.installedRelease || (!settings && !state.showWhatsNew)) return null;
  return <section className={`update-whats-new${recorder ? " recorder-whats-new" : ""}`} aria-label="What's new">
    <h3>What’s new in Zoomcast {state.installedRelease.version}</h3>
    <ReleaseHighlights release={state.installedRelease} />
    {state.showWhatsNew && <button type="button" onClick={() => {
      setError("");
      void window.zoomcast.updates.dismissWhatsNew().catch(() => setError("Could not remember this dismissal. Please try again."));
    }}>Got it</button>}
    {error && <p role="status">{error}</p>}
  </section>;
}

export function UpdateNotice({ settings = false, recorder = false }: { settings?: boolean; recorder?: boolean }) {
  const state = useUpdateState();
  const [error, setError] = useState("");
  if (!state) return null;
  const action = (run: () => Promise<void>): void => {
    setError("");
    void run().catch(() => setError("Could not complete the update. Please try again."));
  };
  const compact = !settings;
  if (compact && !["available", "downloading", "downloaded", "installing"].includes(state.status)) return null;
  let label = `Zoomcast ${state.currentVersion}`;
  if (state.status === "checking") label = "Checking for updates…";
  if (state.status === "current") label = `Zoomcast ${state.currentVersion} is up to date`;
  if (state.status === "available") label = `Zoomcast ${state.version} is available`;
  if (state.status === "downloading") label = `Downloading update · ${Math.floor(state.percent ?? 0)}%`;
  if (state.status === "downloaded") label = `Zoomcast ${state.version} is ready to install`;
  if (state.status === "installing") label = "Restarting to update…";
  if (state.status === "disabled") label += " · Updates are available in the installed app";
  return <div className={compact ? `update-notice${recorder ? " recorder-update" : ""}` : "update-settings"}>
    <span role="status">{label}</span>
    {state.status === "available" && <button type="button" onClick={() => action(window.zoomcast.updates.download)}>Update</button>}
    {state.status === "downloaded" && <button type="button" onClick={() => action(window.zoomcast.updates.install)}>Restart to update</button>}
    {state.release && ["available", "downloaded"].includes(state.status) && <details className="update-release-preview">
      <summary>What’s new</summary><ReleaseHighlights release={state.release} />
    </details>}
    {settings && ["idle", "current", "error"].includes(state.status) && <button type="button" onClick={() => action(window.zoomcast.updates.check)}>Check for updates</button>}
    {state.status === "downloading" && <progress aria-label="Update download" max={100} value={state.percent ?? 0} />}
    {(error || state.message) && <p role="status">{error || state.message}</p>}
  </div>;
}
