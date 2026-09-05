import { defaultProject } from "./defaults";
import type { Project } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Bring any persisted project up to the current shape.
 *
 * bundleIo reads project.json with an unchecked `as Project`, which was only
 * ever safe because the shape never changed. It has now started changing:
 * `style.cursor` is the first REQUIRED field added to the persisted structure,
 * and it is dereferenced unguarded in four places, so a project.json written by
 * any earlier build throws "Cannot read properties of undefined (reading
 * 'smoothing')" and the editor renders nothing for that take.
 *
 * Latent today — no project.json exists on disk yet — but phase B adds
 * background and frame fields and phase C adds persisted zoom segments to the
 * same file, by which time saved projects will exist. Fixing it now costs
 * nothing and means both phases inherit a safe pattern.
 *
 * Field-by-field rather than a version bump, deliberately: a half-written or
 * hand-edited file should degrade to defaults, not throw. Anyone adding a field
 * to Project must add it here too, or old projects silently lose it.
 */
export function normalizeProject(raw: unknown, bundleId: string): Project {
  const base = defaultProject(bundleId);
  if (!isRecord(raw)) return base;

  const style = isRecord(raw.style) ? raw.style : {};
  const shadow = isRecord(style.shadow) ? style.shadow : {};
  const background = isRecord(style.background) ? style.background : undefined;
  const cursor = isRecord(style.cursor) ? style.cursor : {};
  const output = isRecord(raw.output) ? raw.output : {};
  const audio = isRecord(raw.audio) ? raw.audio : {};
  const zoom = isRecord(raw.zoom) ? raw.zoom : {};

  return {
    version: 1,
    // The caller's id wins: the directory a bundle was loaded from is the
    // truth, and a copied project directory would otherwise keep a stale id.
    bundleId,
    cuts: Array.isArray(raw.cuts) ? (raw.cuts as Project["cuts"]) : base.cuts,
    zoom: {
      config: isRecord(zoom.config)
        ? { ...base.zoom.config, ...(zoom.config as Partial<Project["zoom"]["config"]>) }
        : base.zoom.config,
      keyframes: Array.isArray(zoom.keyframes)
        ? (zoom.keyframes as Project["zoom"]["keyframes"])
        : base.zoom.keyframes,
    },
    style: {
      paddingFactor: num(style.paddingFactor, base.style.paddingFactor),
      cornerRadiusPx: num(style.cornerRadiusPx, base.style.cornerRadiusPx),
      shadow: {
        blurPx: num(shadow.blurPx, base.style.shadow.blurPx),
        opacity: num(shadow.opacity, base.style.shadow.opacity),
        offsetYPx: num(shadow.offsetYPx, base.style.shadow.offsetYPx),
      },
      // Background is a discriminated union; a partial merge across kinds would
      // produce a shape matching neither arm. Take it whole or not at all.
      background:
        background !== undefined &&
        (background.kind === "solid" || background.kind === "gradient")
          ? (background as Project["style"]["background"])
          : base.style.background,
      cursor: {
        visible: bool(cursor.visible, base.style.cursor.visible),
        sizePct: num(cursor.sizePct, base.style.cursor.sizePct),
        smoothing: num(cursor.smoothing, base.style.cursor.smoothing),
        shadow: bool(cursor.shadow, base.style.cursor.shadow),
        ripples: bool(cursor.ripples, base.style.cursor.ripples),
      },
    },
    webcam: isRecord(raw.webcam)
      ? { ...base.webcam, ...(raw.webcam as Partial<Project["webcam"]>) }
      : base.webcam,
    audio: {
      micGainDb: num(audio.micGainDb, base.audio.micGainDb),
      systemGainDb: num(audio.systemGainDb, base.audio.systemGainDb),
      syncNudgeMs: num(audio.syncNudgeMs, base.audio.syncNudgeMs),
    },
    output: {
      width: num(output.width, base.output.width),
      height: num(output.height, base.output.height),
      fps: num(output.fps, base.output.fps),
      bitrateMbps: num(output.bitrateMbps, base.output.bitrateMbps),
    },
  };
}
