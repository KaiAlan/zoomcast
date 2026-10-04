import { useEffect, useState } from "react";
import { CAPTURE_FPS_CHOICES, type Settings } from "../../shared/settings/types";
import { fieldLabel, row, selectInput } from "./controls";
import { UpdateAccess, UpdateNotice } from "./UpdateNotice";

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
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraStatus, setCameraStatus] = useState("");

  useEffect(() => {
    void window.zoomcast.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    const refresh = (): void => {
      void navigator.mediaDevices.enumerateDevices().then((devices) =>
        setCameras(devices.filter((d) => d.kind === "videoinput")),
      ).catch(() => setCameraStatus("Camera devices unavailable"));
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);

  if (settings === null) {
    return <div style={{ padding: 24, color: "var(--text)" }}>loading…</div>;
  }

  const update = (next: Settings): void => {
    setSettings(next);
    void window.zoomcast.setSettings(next);
  };

  return (
    <div className="settings-page"
      style={{
        padding: 24,
        color: "var(--text)",
        background: "var(--page)",
        minHeight: "100vh",
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      <h2 style={{ fontWeight: 400, fontSize: 18, margin: "0 0 18px" }}>Settings</h2>

      <label style={row}><span style={fieldLabel}>Theme</span><select aria-label="Theme" style={selectInput} value={settings.theme} onChange={event => update({ ...settings, theme: event.target.value as Settings["theme"] })}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></select></label>
      <p className="control-help">System follows your Windows appearance. Theme changes apply to all open windows.</p>
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
          color: "var(--muted)",
          fontSize: 12,
          maxWidth: 460,
          lineHeight: 1.6,
          marginTop: 16,
        }}
      >
        Applies to the fallback screen recorder. Desktop Duplication targets
        60 fps automatically. Each take shows its achieved rate.
      </p>

      <label style={row}>
        <span style={fieldLabel}>Record webcam</span>
        <input type="checkbox" checked={settings.webcamEnabled}
          onChange={(e) => update({ ...settings, webcamEnabled: e.target.checked })} />
      </label>
      {settings.webcamEnabled && <>
        <label style={row}>
          <span style={fieldLabel}>Camera</span>
          <select style={selectInput} value={settings.webcamDeviceId}
            onChange={(e) => update({ ...settings, webcamDeviceId: e.target.value })}>
            <option value="">Default camera</option>
            {cameras.map((camera, i) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${i + 1}`}</option>)}
            {settings.webcamDeviceId !== "" && !cameras.some((c) => c.deviceId === settings.webcamDeviceId) && <option value={settings.webcamDeviceId}>Selected camera (disconnected)</option>}
          </select>
        </label>
        <button type="button" onClick={() => {
          setCameraStatus("Checking camera…");
          void navigator.mediaDevices.getUserMedia({video: settings.webcamDeviceId ? {deviceId:{exact:settings.webcamDeviceId}} : true,audio:false}).then(async (stream) => {
            for (const track of stream.getTracks()) track.stop();
            const devices = await navigator.mediaDevices.enumerateDevices();
            setCameras(devices.filter((d) => d.kind === "videoinput"));
            setCameraStatus("Camera ready");
          }).catch((err: unknown) => setCameraStatus(err instanceof Error ? err.message : "Camera unavailable"));
        }}>Check camera</button>
        <p style={{ color: "var(--muted)", fontSize: 12 }}>Camera video is recorded separately. Adjust its appearance in the editor. Applies to the next recording.</p>
        {cameraStatus && <p role="status" style={{ fontSize: 12 }}>{cameraStatus}</p>}
      </>}
      <h2 style={{ fontWeight: 400, fontSize: 18, margin: "24px 0 12px" }}>App updates</h2>
      <UpdateNotice settings />
      <UpdateAccess />
    </div>
  );
}
