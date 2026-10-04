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
  if (compact && !["available", "downloading", "downloaded", "installing", "needs-access"].includes(state.status)) return null;
  let label = `Zoomcast ${state.currentVersion}`;
  if (state.status === "checking") label = "Checking for updates…";
  if (state.status === "current") label = `Zoomcast ${state.currentVersion} is up to date`;
  if (state.status === "available") label = `Zoomcast ${state.version} is available`;
  if (state.status === "downloading") label = `Downloading update · ${Math.floor(state.percent ?? 0)}%`;
  if (state.status === "downloaded") label = `Zoomcast ${state.version} is ready to install`;
  if (state.status === "installing") label = "Restarting to update…";
  if (state.status === "disabled") label += " · Updates are available in the installed app";
  if (state.status === "needs-access") label = "Private updates need GitHub access";
  return <div className={compact ? `update-notice${recorder ? " recorder-update" : ""}` : "update-settings"}>
    <span role="status">{label}</span>
    {state.status === "available" && <button type="button" onClick={() => action(window.zoomcast.updates.download)}>Update</button>}
    {state.status === "downloaded" && <button type="button" onClick={() => action(window.zoomcast.updates.install)}>Restart to update</button>}
    {compact && state.status === "needs-access" && <button type="button" onClick={() => action(window.zoomcast.openSettings)}>Set up updates</button>}
    {settings && ["idle", "current", "error", "needs-access"].includes(state.status) && <button type="button" onClick={() => action(window.zoomcast.updates.check)}>Check for updates</button>}
    {state.status === "downloading" && <progress aria-label="Update download" max={100} value={state.percent ?? 0} />}
    {(error || state.message) && <p role="status">{error || state.message}</p>}
  </div>;
}

export function UpdateAccess() {
  const [access, setAccess] = useState<{ configured: boolean; canStore: boolean } | null>(null);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { void window.zoomcast.updates.access().then(setAccess); }, []);
  const save = async (value: string | null): Promise<void> => {
    setPending(true); setMessage("");
    try {
      await window.zoomcast.updates.setAccess(value);
      setToken(""); setAccess(await window.zoomcast.updates.access());
      setMessage(value ? "Update access saved securely on this Windows account." : "Update access removed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save update access."); }
    finally { setPending(false); }
  };
  if (!access) return null;
  return <div className="update-access">
    <p>Private releases require a GitHub account with access to KaiAlan/zoomcast. Use a fine-grained token for that repository with Contents: read-only.</p>
    <p>If GitHub cannot offer this repository for your collaborator account, a classic token with repo scope may be required. That scope also permits writes to repositories your account can access.</p>
    {access.configured ? <button type="button" disabled={pending} onClick={() => void save(null)}>Remove update access</button> : <>
      <label>Update access<input type="password" autoComplete="off" spellCheck={false} value={token} placeholder="GitHub access token" onChange={event => setToken(event.target.value)} /></label>
      <button type="button" disabled={pending || !access.canStore || !token.trim()} onClick={() => void save(token.trim())}>{pending ? "Verifying…" : "Save update access"}</button>
    </>}
    {!access.canStore && <p>Windows credential protection is unavailable.</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
