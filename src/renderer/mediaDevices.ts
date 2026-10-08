import type { MicrophoneSettings } from "../shared/settings/types";

/** The test and real capture deliberately request the same device and processing. */
export function microphoneConstraints(settings: MicrophoneSettings): MediaStreamConstraints {
  return { video: false, audio: {
    ...(settings.microphoneDeviceId ? { deviceId: { exact: settings.microphoneDeviceId } } : {}),
    noiseSuppression: settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoGainControl: settings.autoGainControl,
  } };
}

export function mediaError(error: unknown, device: "Microphone" | "Camera" | "System audio"): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return `${device} access denied. In Windows Settings → Privacy & security, allow ${device === "Camera" ? "camera" : "microphone"} access for desktop apps, then try again.`;
  if (name === "NotFoundError" || name === "OverconstrainedError") return `${device} unavailable. Connect the selected device or choose another one.`;
  if (name === "NotReadableError") return `${device} could not open. Close other apps using it and try again.`;
  return `${device}: ${error instanceof Error ? error.message : String(error)}`;
}

/** No connection to speakers: monitoring never feeds the microphone back. */
export async function monitorLevel(stream: MediaStream, callback: (level: number) => void): Promise<() => void> {
  const context = new AudioContext();
  try {
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      callback(Math.min(1, Math.sqrt(sum / samples.length) * 4));
    }, 100);
    return () => { window.clearInterval(timer); source.disconnect(); void context.close(); };
  } catch (error) { void context.close(); throw error; }
}
