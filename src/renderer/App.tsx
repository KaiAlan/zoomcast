import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenedBundle } from "../shared/api";
import { installAudioHooks } from "./audio";
import { installShootHook } from "./shoot";
import { Editor } from "./ui/Editor";
import { SettingsWindow } from "./ui/SettingsWindow";
import { Welcome } from "./ui/Welcome";

/** The headless screenshot harness, used by tools/verify-decode.ts. */
function ShootHarness() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas !== null) installShootHook(canvas);
  }, []);

  return <canvas ref={canvasRef} width={1280} height={720} />;
}

export function App() {
  const [bundle, setBundle] = useState<OpenedBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isShoot = window.location.hash === "#shoot";
  const isAudio = window.location.hash === "#audio";
  const isSettings = window.location.hash === "#settings";

  // The hidden audio-capture window renders nothing; it only exposes hooks.
  useEffect(() => {
    if (isAudio) installAudioHooks();
  }, [isAudio]);

  const open = useCallback(async (dir: string) => {
    try {
      setBundle(await window.zoomcast.openBundle(dir));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Opening a finished recording lives here rather than in Welcome, so it also
  // works when a take is started by hotkey while the editor is already open.
  useEffect(() => {
    if (isShoot || isAudio) return;
    return window.zoomcast.recording.onStopped((result) => void open(result.dir));
  }, [isShoot, isAudio, open]);

  // ?bundle=<path> auto-opens, which is how the UI screenshot mode drives this.
  useEffect(() => {
    if (isShoot) return;
    const dir = new URLSearchParams(window.location.search).get("bundle");
    if (dir !== null && dir.trim() !== "") void open(dir);
  }, [isShoot, open]);

  if (isAudio) return null;
  if (isShoot) return <ShootHarness />;
  if (isSettings) return <SettingsWindow />;
  if (bundle !== null) {
    return <Editor bundle={bundle} onBack={() => setBundle(null)} />;
  }

  return <Welcome error={error} onOpen={(dir) => void open(dir)} />;
}
