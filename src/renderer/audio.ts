export type AudioRole = "mic" | "system";

export type AudioStartResult = {
  role: AudioRole;
  startedAtUnixMs: number;
  ok: boolean;
  error?: string;
};

declare global {
  interface Window {
    __audio?: {
      start: (roles: AudioRole[]) => Promise<AudioStartResult[]>;
      stop: () => Promise<void>;
    };
  }
}

type Live = {
  role: AudioRole;
  recorder: MediaRecorder;
  stream: MediaStream;
};

const CHUNK_MS = 250;

/**
 * Grab one audio source.
 *
 * The mic is plain getUserMedia with the browser's cleanup disabled — echo
 * cancellation and auto gain are actively harmful on a narration track.
 *
 * System audio uses getDisplayMedia, which Electron answers through the main
 * process's display-media handler with `audio: 'loopback'`. That is what makes
 * Windows loopback capture work without any extra dependency, and it is why
 * ffmpeg is not asked to record audio at all.
 */
async function openStream(role: AudioRole): Promise<MediaStream> {
  if (role === "mic") {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  }

  const display = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });

  // Only the audio is wanted; ffmpeg is already capturing the screen.
  for (const track of display.getVideoTracks()) {
    track.stop();
    display.removeTrack(track);
  }

  if (display.getAudioTracks().length === 0) {
    throw new Error("system audio loopback returned no audio track");
  }

  return display;
}

export function installAudioHooks(): void {
  let live: Live[] = [];

  window.__audio = {
    async start(roles: AudioRole[]): Promise<AudioStartResult[]> {
      const results: AudioStartResult[] = [];

      for (const role of roles) {
        try {
          const stream = await openStream(role);
          const recorder = new MediaRecorder(stream, {
            mimeType: "audio/webm;codecs=opus",
            audioBitsPerSecond: 128_000,
          });

          recorder.ondataavailable = (event) => {
            if (event.data.size === 0) return;
            void event.data.arrayBuffer().then((buf) => {
              void window.zoomcast.audioChunk(role, new Uint8Array(buf));
            });
          };

          // `onstart` is the closest thing to the true first-sample instant that
          // MediaRecorder exposes; using the start() call site instead would
          // charge device warm-up to the recording and drift the audio.
          const startedAtUnixMs = await new Promise<number>((resolve) => {
            recorder.onstart = () => resolve(Date.now());
            recorder.start(CHUNK_MS);
          });

          live.push({ role, recorder, stream });
          results.push({ role, startedAtUnixMs, ok: true });
        } catch (err) {
          results.push({
            role,
            startedAtUnixMs: 0,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return results;
    },

    async stop(): Promise<void> {
      const stopping = live.map(
        (entry) =>
          new Promise<void>((resolve) => {
            entry.recorder.onstop = () => {
              for (const track of entry.stream.getTracks()) track.stop();
              resolve();
            };
            if (entry.recorder.state === "inactive") {
              for (const track of entry.stream.getTracks()) track.stop();
              resolve();
            } else {
              entry.recorder.stop();
            }
          }),
      );

      live = [];
      await Promise.all(stopping);
    },
  };
}
