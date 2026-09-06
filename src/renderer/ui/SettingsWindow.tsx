import { useEffect, useState } from "react";
import { CAPTURE_FPS_CHOICES, type Settings } from "../../shared/settings/types";
import { fieldLabel, row, selectInput } from "./controls";

/**
 * The app's first settings surface.
 *
 * Deliberately a window rather than a tray submenu: an encoder choice, an
 * output directory and the record hotkey all belong here next, and a submenu
 * does not hold them.
 *
 * Writes on every change rather than offering a Save button. There is nothing
 * here to get into a half-valid state, and a tray app the user opens for one
 * toggle should not also ask them to confirm it.
 */
export function SettingsWindow() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void window.zoomcast.getSettings().then(setSettings);
  }, []);

  if (settings === null) {
    return <div style={{ padding: 24, color: "#e6e6e6" }}>loading…</div>;
  }

  const update = (next: Settings): void => {
    setSettings(next);
    void window.zoomcast.setSettings(next);
  };

  return (
    <div
      style={{
        padding: 24,
        color: "#e6e6e6",
        background: "#0d0e11",
        height: "100vh",
        boxSizing: "border-box",
      }}
    >
      <h2 style={{ fontWeight: 400, fontSize: 18, margin: "0 0 18px" }}>Settings</h2>

      <div style={row}>
        <span style={fieldLabel}>Capture frame rate</span>
        <select
          style={selectInput}
          value={settings.captureFps}
          onChange={(e) =>
            update({
              ...settings,
              captureFps: Number(e.target.value) as Settings["captureFps"],
            })
          }
        >
          {CAPTURE_FPS_CHOICES.map((fps) => (
            <option key={fps} value={fps}>
              {fps} fps
            </option>
          ))}
        </select>
      </div>

      <p
        style={{
          color: "#8b90a0",
          fontSize: 12,
          maxWidth: 460,
          lineHeight: 1.6,
          marginTop: 16,
        }}
      >
        Screen capture is CPU-bound and does not reach the rate it is asked for —
        this machine records about 28fps either way, and each take stores what it
        actually achieved. Asking for 60 is never worse and sometimes helps; 30
        costs less CPU and produces smaller files. Takes effect on the next
        recording.
      </p>
    </div>
  );
}
