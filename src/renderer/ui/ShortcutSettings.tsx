import { useEffect, useState } from "react";
import type { ShortcutState } from "../../shared/shortcut";

export function ShortcutSettings() {
  const [state, setState] = useState<ShortcutState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void window.zoomcast.shortcutState().then(value => {
        if (!disposed) { setState(value); setError(""); }
      }).catch(() => { if (!disposed) setError("Could not read shortcut settings. Reopen Settings to retry."); });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { disposed = true; window.removeEventListener("focus", refresh); };
  }, []);

  const changeStartup = async (enabled: boolean) => {
    setBusy(true); setError("");
    try { setState(await window.zoomcast.setStartWithWindows(enabled)); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not change startup settings"); }
    finally { setBusy(false); }
  };

  return <section aria-label="Recording shortcut">
    <h2>Recording shortcut</h2>
    {state && <>
      <p><kbd className="settings-shortcut-key">{state.hotkey || "Ctrl+Alt+R unavailable"}</kbd></p>
      <p className="control-help">{state.mode === "launcher"
        ? "Opens the recorder even after Quit. Windows launches Zoomcast or brings its running recorder forward."
        : state.mode === "conflict"
          ? "Another app is using Ctrl+Alt+R. Release those keys in that app and restart Zoomcast. You can still open the recorder from the tray."
          : state.startupSupported
            ? "Opens the recorder while Zoomcast is running. Reinstall Zoomcast to restore its Windows launch shortcut for access after Quit."
            : "Opens the recorder while Zoomcast is running. Install Zoomcast using its Windows installer to also launch it after Quit."}</p>
      {state.mode === "launcher" && <p className="control-help">If the keys do not respond, check other apps using {state.hotkey}. The Start menu’s Zoomcast Recorder shortcut also opens the recorder.</p>}
      <label className="settings-row"><span>Start with Windows</span><input type="checkbox" role="switch" aria-checked={state.startWithWindows} aria-label="Start with Windows" checked={state.startWithWindows} disabled={busy || !state.startupSupported} onChange={event => void changeStartup(event.target.checked)} /></label>
      <p className="control-help">{state.startupSupported ? "Starts quietly in the tray at sign-in for faster access. Closing a window keeps Zoomcast running; Quit stops it." : "Available in the installed Windows app."}</p>
    </>}
    {!state && !error && <p>Loading shortcut settings…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
