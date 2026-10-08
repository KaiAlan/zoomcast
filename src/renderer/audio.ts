import type { AudioHealth } from "../shared/recorder";
import type { MicrophoneSettings } from "../shared/settings/types";
import { defaultSettings } from "../shared/settings/defaults";
import { mediaError, microphoneConstraints, monitorLevel } from "./mediaDevices";

export type AudioRole = "mic" | "system";
export type AudioStartResult = { role: AudioRole; startedAtUnixMs: number; ok: boolean; error?: string };
declare global {
  interface Window {
    __audio?: {
      start: (roles: AudioRole[], settings?: MicrophoneSettings) => Promise<AudioStartResult[]>;
      stop: () => Promise<void>;
    };
  }
}

type Live = { recorder: MediaRecorder; stream: MediaStream; cleanup: () => void; drain: () => Promise<void> };
const CHUNK_MS = 250;

async function openStream(role: AudioRole, settings: MicrophoneSettings): Promise<MediaStream> {
  if (role === "mic") return navigator.mediaDevices.getUserMedia(microphoneConstraints(settings));
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  for (const track of display.getVideoTracks()) { track.stop(); display.removeTrack(track); }
  if (display.getAudioTracks().length === 0) {
    for (const track of display.getTracks()) track.stop();
    throw new Error("System audio loopback returned no audio track");
  }
  return display;
}

export function installAudioHooks(): void {
  let live: Live[] = [];
  window.__audio = {
    async start(roles, settings = defaultSettings()) {
      const results: AudioStartResult[] = [];
      for (const role of roles) {
        let stream: MediaStream | undefined;
        let cleanup = () => {};
        const send = (health: AudioHealth) => window.zoomcast.audioHealth(role, health);
        try {
          send({ status: "starting", level: 0, message: "Opening audio device…" });
          stream = await openStream(role, settings);
          const track = stream.getAudioTracks()[0];
          if (track?.readyState !== "live") throw new Error("No live audio track");
          const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128_000 });
          let upload = Promise.resolve();
          let failed = "";
          let level = 0;
          let lastSignal = Date.now();
          let lastChunk = Date.now();
          let hasChunk = false;
          const fail = (message: string) => { failed = message; send({ status: "failed", level: 0, message }); };
          track.onended = () => fail("Audio device disconnected or stopped. Stop the take and check your device.");
          recorder.onerror = () => fail("Audio recording failed. Stop the take and check your device.");
          recorder.ondataavailable = event => {
            if (!event.data.size) return;
            // Keep chunks ordered, and await the final disk acknowledgement on stop.
            upload = upload.then(async () => {
              const buf = await event.data.arrayBuffer();
              await window.zoomcast.audioChunk(role, new Uint8Array(buf));
              lastChunk = Date.now(); hasChunk = true;
            }).catch(() => fail("Audio could not be saved. Check available disk space and stop the take."));
          };
          let stopMonitor = () => {};
          try { stopMonitor = await monitorLevel(stream, value => { level = value; if (value > 0.012) lastSignal = Date.now(); }); }
          catch { /* Capture health still works when the optional meter cannot open. */ }
          const timer = window.setInterval(() => {
            if (failed) return;
            if (track.readyState === "ended" || recorder.state === "inactive") { fail("Audio recording stopped unexpectedly. Stop the take and check your device."); return; }
            if (Date.now() - lastChunk > 8000) { fail("Audio data stopped arriving. Stop the take and check your device."); return; }
            const status = track.muted ? "muted" : !hasChunk ? "starting" : role === "mic" && Date.now() - lastSignal > 15000 ? "quiet" : "recording";
            send({ status, level, message: status === "muted" ? `${role === "mic" ? "Microphone" : "System audio"} is not receiving audio. Check its mute switch or connection.` : status === "quiet" ? "No microphone sound detected for 15 seconds. Speak or check your microphone’s mute switch." : status === "starting" ? "Waiting for audio…" : role === "mic" ? "Microphone recording" : "System audio recording" });
          }, 500);
          cleanup = () => { window.clearInterval(timer); stopMonitor(); track.onended = null; recorder.onerror = null; };
          const startedAtUnixMs = await new Promise<number>((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error("Audio recorder did not start in time")), 8000);
            recorder.addEventListener("error", () => { window.clearTimeout(timeout); reject(new Error("Audio recorder could not start")); }, { once: true });
            recorder.onstart = () => { window.clearTimeout(timeout); resolve(Date.now()); };
            recorder.start(CHUNK_MS);
          });
          live.push({ recorder, stream, cleanup, drain: () => upload });
          results.push({ role, startedAtUnixMs, ok: true });
        } catch (error) {
          cleanup();
          for (const track of stream?.getTracks() ?? []) track.stop();
          const message = mediaError(error, role === "mic" ? "Microphone" : "System audio");
          send({ status: "failed", level: 0, message });
          results.push({ role, startedAtUnixMs: 0, ok: false, error: message });
        }
      }
      return results;
    },
    async stop() {
      const entries = live; live = [];
      await Promise.all(entries.map(async entry => {
        entry.cleanup();
        if (entry.recorder.state !== "inactive") {
          await new Promise<void>(resolve => { entry.recorder.addEventListener("stop", () => resolve(), { once: true }); entry.recorder.stop(); });
        }
        for (const track of entry.stream.getTracks()) track.stop();
        await entry.drain();
      }));
    },
  };
}
