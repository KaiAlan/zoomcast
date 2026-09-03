import { useEffect, useRef } from "react";
import { installShootHook } from "./shoot";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    installShootHook(canvas);
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        margin: 0,
        background: "#0d0e11",
        color: "#e6e6e6",
        fontFamily: "system-ui, sans-serif",
        fontWeight: 400,
        padding: 24,
      }}
    >
      <div style={{ marginBottom: 12, opacity: 0.7 }}>zoomcast</div>
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        style={{ width: "100%", maxWidth: 1280, display: "block" }}
      />
    </div>
  );
}
