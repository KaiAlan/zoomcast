import type { Settings } from "./types";

/**
 * 60 by default — but read this before believing it.
 *
 * gdigrab does NOT deliver 60. Measured at 1080p on 2026-09-06, counting real
 * frames: bare ffmpeg managed 21.9fps when asked for 30 and 28.6fps when asked
 * for 60, and inside the app the achieved rate sat at 27-30fps regardless of
 * which was requested. So asking for 60 is worth roughly a third more frames
 * in isolation and is never worse, but it does not buy 60fps capture.
 *
 * 60 is the default because it costs nothing and occasionally helps. 30 stays
 * available because the extra frames cost file size and CPU on a path that is
 * already CPU-bound. Real 60fps capture needs ddagrab, not this setting.
 */
export function defaultSettings(): Settings {
  return { theme: "light", captureFps: 60, webcamEnabled: false, webcamDeviceId: "" };
}
