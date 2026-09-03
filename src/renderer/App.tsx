import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenedBundle } from "../shared/api";
import { installShootHook } from "./shoot";
import { Editor } from "./ui/Editor";

const button: React.CSSProperties = {
  background: "#1c2029",
  color: "#e6e6e6",
  border: "1px solid #2a2e38",
  borderRadius: 5,
  padding: "8px 16px",
  cursor: "pointer",
  fontSize: 13,
};

/** The headless screenshot harness, used by tools/verify-decode.ts. */
function ShootHarness() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas !== null) installShootHook(canvas);
  }, []);

  return <canvas ref={canvasRef} width={1280} height={720} />;
}

function Welcome({ onOpen, error }: { onOpen: () => void; error: string | null }) {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        background: "#0d0e11",
        color: "#e6e6e6",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 20 }}>zoomcast</div>
      <div style={{ fontSize: 13, opacity: 0.55 }}>open a recording bundle to edit</div>
      <button type="button" style={button} onClick={onOpen}>
        open bundle…
      </button>
      {error !== null && (
        <div style={{ fontSize: 12, color: "#e0894a", maxWidth: 520, textAlign: "center" }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function App() {
  const [bundle, setBundle] = useState<OpenedBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isShoot = window.location.hash === "#shoot";

  const open = useCallback(async (dir: string) => {
    try {
      setBundle(await window.zoomcast.openBundle(dir));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // ?bundle=<path> auto-opens, which is how the UI screenshot mode drives this.
  useEffect(() => {
    if (isShoot) return;
    const dir = new URLSearchParams(window.location.search).get("bundle");
    if (dir !== null) void open(dir);
  }, [isShoot, open]);

  if (isShoot) return <ShootHarness />;
  if (bundle !== null) return <Editor bundle={bundle} />;

  return (
    <Welcome
      error={error}
      onOpen={() => {
        void (async () => {
          const dir = await window.zoomcast.pickBundle();
          if (dir !== null) await open(dir);
        })();
      }}
    />
  );
}
