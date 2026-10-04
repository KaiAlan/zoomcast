import { WEBCAM_MIME_TYPES, type WebcamStart } from "../shared/webcam/capture";

declare global {
  interface Window {
    __webcam?: { start(deviceId: string): Promise<WebcamStart>; stop(): Promise<void> };
  }
}

/** Hidden renderer: camera video only; narration stays in the mic track. */
export function installWebcamHooks(): void {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let pending: Promise<void> = Promise.resolve();
  let writeError: unknown;
  window.__webcam = {
    async start(deviceId) {
      if (stream !== null) throw new Error("camera already recording");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 },
            ...(deviceId === "" ? {} : { deviceId: { exact: deviceId } }),
          },
          audio: false,
        });
        const mimeType = WEBCAM_MIME_TYPES.find((mime) => MediaRecorder.isTypeSupported(mime));
        if (mimeType === undefined) throw new Error("camera recording codec unavailable");
        const track = stream.getVideoTracks()[0];
        if (track === undefined) throw new Error("camera returned no video track");
        const settings = track.getSettings();
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 });
        recorder.ondataavailable = (e) => {
          if (e.data.size === 0) return;
          // onstop awaits this chain, so the final Blob reaches disk before
          // remuxing starts. IPC acknowledges the actual stream write.
          pending = pending.then(async () => {
            await window.zoomcast.webcamChunk(new Uint8Array(await e.data.arrayBuffer()));
          }).catch((err: unknown) => { writeError = err; });
        };
        const r = recorder;
        const startedAtUnixMs = await new Promise<number>((resolve, reject) => {
          r.onstart = () => resolve(Date.now());
          r.onerror = () => {
            const error = new Error("camera recorder failed");
            writeError = error;
            reject(error);
          };
          r.start(250);
        });
        return { startedAtUnixMs, mimeType, width: settings.width ?? 1280, height: settings.height ?? 720, fps: settings.frameRate ?? 30 };
      } catch (err) {
        for (const track of stream?.getTracks() ?? []) track.stop();
        stream = null;
        recorder = null;
        throw err;
      }
    },
    async stop() {
      try {
        const r = recorder;
        if (r !== null && r.state !== "inactive") {
          await new Promise<void>((resolve) => { r.onstop = () => resolve(); r.stop(); });
        }
        await pending;
        if (writeError !== undefined) throw writeError;
      } finally {
        for (const track of stream?.getTracks() ?? []) track.stop();
        stream = null;
        recorder = null;
      }
    },
  };
}
