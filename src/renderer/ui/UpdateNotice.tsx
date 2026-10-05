import { useEffect, useState } from "react";
import type { UpdateState } from "../../shared/updates";
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
    {settings && ["idle", "current", "error"].includes(state.status) && <button type="button" onClick={() => action(window.zoomcast.updates.check)}>Check for updates</button>}
    {state.status === "downloading" && <progress aria-label="Update download" max={100} value={state.percent ?? 0} />}
    {(error || state.message) && <p role="status">{error || state.message}</p>}
  </div>;
}
