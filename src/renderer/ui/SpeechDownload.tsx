import { useEffect, useState } from "react";
import type { CaptionState } from "../../shared/captions/types";

export function useSpeechState() {
  const [state, setState] = useState<CaptionState | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const off = window.zoomcast.captions.onChanged(next => { if (alive) setState(next); });
    void window.zoomcast.captions.state().then(next => { if (alive) setState(next); }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; off(); };
  }, []);
  return { state, error, setError };
}

export function SpeechDownload({ state, management = false }: { state: CaptionState | null; management?: boolean }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const run = async (operation: () => Promise<void>) => {
    setError(""); setPending(true);
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setPending(false); }
  };
  return <div className="speech-download">
    <p className="control-help">Transcribe on your computer. Audio stays local. Free to use after a one-time download.</p>
    {!state ? <p role="status">Checking speech download…</p> : <>
      {state.installed ? <p className="control-help">Offline transcription ready · {(state.diskBytes / 1000000).toFixed(0)} MB on disk</p> : <button type="button" className="quiet-action" disabled={state.busy || pending} onClick={() => void run(() => window.zoomcast.captions.install())}>Download caption support ({Math.ceil(state.downloadBytes / 1000000)} MB)</button>}
      {state.busy && <div className="caption-progress">
        <progress aria-label="Caption task progress" max={1} value={state.progress ?? undefined} />
        <button type="button" className="quiet-action" onClick={() => void run(() => window.zoomcast.captions.cancel())}>Cancel caption task</button>
      </div>}
      {state.message && <p className="control-help" role="status">{state.message}</p>}
      {management && state.installed && <button type="button" className="quiet-action" disabled={state.busy || pending} onClick={() => void run(() => window.zoomcast.captions.remove())}>Remove speech download</button>}
      {management && <p className="control-help">Removing the download frees disk space. Saved transcripts and caption exports are kept. App updates keep the download.</p>}
    </>}
    {error && <p role="alert" className="caption-error">{error}</p>}
  </div>;
}
