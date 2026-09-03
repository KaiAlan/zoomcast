import { useCallback, useEffect, useState } from "react";
import type { RecordingSummary } from "../../shared/api";

type Props = {
  onOpen: (dir: string) => void;
  error: string | null;
};

const button: React.CSSProperties = {
  background: "#1c2029",
  color: "#e6e6e6",
  border: "1px solid #2a2e38",
  borderRadius: 5,
  padding: "9px 18px",
  cursor: "pointer",
  fontSize: 13,
};

const mb = (bytes: number): string =>
  bytes > 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;

export function Welcome({ onOpen, error }: Props) {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [state, setState] = useState<"idle" | "countdown" | "recording">("idle");
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.zoomcast.listRecordings().then(setRecordings);
  }, []);

  useEffect(() => {
    refresh();
    void window.zoomcast.isRecording().then((on) => setState(on ? "recording" : "idle"));

    const offs = [
      window.zoomcast.recording.onCountdown(() => setState("countdown")),
      window.zoomcast.recording.onStarted(() => {
        setState("recording");
        setNotice(null);
      }),
      window.zoomcast.recording.onStopped((result) => {
        setState("idle");
        refresh();
        setNotice(
          result.unclean
            ? `recording ended unexpectedly — opening anyway (${result.backend})`
            : null,
        );
        onOpen(result.dir);
      }),
      window.zoomcast.recording.onError((message) => {
        setState("idle");
        setNotice(message);
      }),
    ];

    return () => {
      for (const off of offs) off();
    };
  }, [refresh, onOpen]);

  const label =
    state === "recording" ? "stop recording" : state === "countdown" ? "…" : "record";

  const total = recordings.reduce((sum, r) => sum + r.sizeBytes, 0);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        background: "#0d0e11",
        color: "#e6e6e6",
        fontFamily: "system-ui, sans-serif",
        padding: 32,
      }}
    >
      <div style={{ fontSize: 20 }}>zoomcast</div>
      <div style={{ fontSize: 13, opacity: 0.55 }}>
        record your screen, or open an existing bundle
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button
          type="button"
          style={{
            ...button,
            borderColor: state === "recording" ? "#e5484d" : "#2a2e38",
            color: state === "recording" ? "#ff8a8d" : "#e6e6e6",
          }}
          disabled={state === "countdown"}
          onClick={() => void window.zoomcast.toggleRecording()}
        >
          {label}
        </button>
        <button
          type="button"
          style={button}
          onClick={() => {
            void (async () => {
              const dir = await window.zoomcast.pickBundle();
              if (dir !== null) onOpen(dir);
            })();
          }}
        >
          open bundle…
        </button>
      </div>

      <div style={{ fontSize: 12, opacity: 0.4 }}>or press Ctrl+Shift+R anywhere</div>

      {notice !== null && (
        <div style={{ fontSize: 12, color: "#e0894a", maxWidth: 560, textAlign: "center" }}>
          {notice}
        </div>
      )}
      {error !== null && (
        <div style={{ fontSize: 12, color: "#e0894a", maxWidth: 560, textAlign: "center" }}>
          {error}
        </div>
      )}

      {recordings.length > 0 && (
        <div style={{ marginTop: 20, width: 520, maxHeight: 280, overflowY: "auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              opacity: 0.45,
              marginBottom: 6,
            }}
          >
            <span>recordings</span>
            <span>{mb(total)} total</span>
          </div>

          {recordings.map((r) => (
            <button
              key={r.dir}
              type="button"
              onClick={() => onOpen(r.dir)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                width: "100%",
                background: "#15171c",
                border: "1px solid #23262e",
                borderRadius: 5,
                color: "#e6e6e6",
                padding: "8px 12px",
                marginBottom: 6,
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            >
              <span>{r.id.replace("T", " ").replace(/-(\d\d)-(\d\d)$/, ":$1:$2")}</span>
              <span style={{ opacity: 0.5 }}>{mb(r.sizeBytes)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
