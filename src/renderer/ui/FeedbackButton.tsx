import { useId, useRef, useState } from "react";
import type { FeedbackRequest } from "../../shared/feedback";
import "./feedback.css";

/** Drafts stay in the app until the user opens a report to review on GitHub. */
export function FeedbackButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [kind, setKind] = useState<FeedbackRequest["kind"]>("bug");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [opening, setOpening] = useState(false);
  const [status, setStatus] = useState("");
  const submit = async (): Promise<void> => {
    setOpening(true); setStatus("");
    try {
      const result = await window.zoomcast.openFeedback({ kind, title, details });
      setStatus(result.copied
        ? "Report copied. Paste it into the GitHub description, review it, and submit."
        : "Report opened in your browser. Review it and submit on GitHub.");
    } catch (error) {
      setStatus(`Could not open GitHub: ${error instanceof Error ? error.message : String(error)}. Your draft is still here; try again.`);
    } finally { setOpening(false); }
  };
  return <>
    <button type="button" className="quiet-action" onClick={() => dialogRef.current?.showModal()}>Send feedback</button>
    <dialog ref={dialogRef} className="feedback-dialog" aria-labelledby={headingId}>
      <div className="feedback-heading"><h2 id={headingId}>Send feedback</h2><button type="button" className="quiet-action" aria-label="Close feedback" onClick={() => dialogRef.current?.close()}>Close</button></div>
      <p className="control-help">Report a bug, suggest a feature, or share feedback with the Zoomcast team.</p>
      <form onSubmit={event => { event.preventDefault(); if (!opening) void submit(); }}>
        <fieldset disabled={opening}>
          <label>Report type<select value={kind} onChange={event => setKind(event.target.value as FeedbackRequest["kind"])}><option value="bug">Bug report</option><option value="feature">Feature request</option><option value="feedback">General feedback</option></select></label>
          <label>Summary<input autoFocus required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="What would you like us to know?" /></label>
          <label>Details<textarea required maxLength={4000} rows={6} value={details} onChange={event => setDetails(event.target.value)} placeholder={kind === "bug" ? "What happened? Include steps to reproduce and what you expected." : "Describe your suggestion or feedback."} /></label>
        </fieldset>
        <p className="control-help">Opens a public GitHub report for you to review and submit. GitHub sign-in is required. Only your text and the app and Windows versions are included.</p>
        <button type="submit" className="primary-action" disabled={opening || !title.trim() || !details.trim()}>{opening ? "Opening…" : "Open report on GitHub"}</button>
        {status && <p role="status" className="feedback-status">{status}</p>}
      </form>
    </dialog>
  </>;
}
