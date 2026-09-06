import { defaultSettings } from "./defaults";
import { CAPTURE_FPS_CHOICES, type CaptureFps, type Settings } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function captureFps(raw: unknown, fallback: CaptureFps): CaptureFps {
  return CAPTURE_FPS_CHOICES.find((c) => c === raw) ?? fallback;
}

/**
 * Merge field by field over the defaults, never cast.
 *
 * settings.json is a plain file: a user can edit it, an older build can have
 * written it, and a crash can have truncated it. Degrading to a default beats
 * throwing on startup in a tray app whose whole job is to be already running.
 *
 * Anyone adding a field to Settings must add it here too, or a stored value
 * for it is silently dropped on load.
 */
export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!isRecord(raw)) return base;

  return { captureFps: captureFps(raw.captureFps, base.captureFps) };
}
