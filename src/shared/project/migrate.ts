import { normalizeCaptions } from "../captions/document";
import { defaultProject } from "./defaults";
import type { Cut, Project } from "./types";
import { DEFAULT_ZOOM_CONFIG } from "../zoom/config";
import type { ZoomConfig } from "../zoom/types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Upgrade complete factory presets; custom/partial settings stay user-owned. */
function zoomConfig(raw: unknown): ZoomConfig {
  if (!isRecord(raw)) return { ...DEFAULT_ZOOM_CONFIG };
  const factoryPresets = [
    { ...DEFAULT_ZOOM_CONFIG, transitionMs: 1500, transitionOutMs: 1000, panMs: 1000, maxZoom: 2 },
    { ...DEFAULT_ZOOM_CONFIG, transitionMs: 1000, transitionOutMs: 900, maxZoom: 2 },
    { ...DEFAULT_ZOOM_CONFIG, transitionMs: 1200 },
  ];
  if (factoryPresets.some(preset => Object.entries(preset).every(([key, value]) => raw[key] === value))) {
    return { ...DEFAULT_ZOOM_CONFIG };
  }
  return { ...DEFAULT_ZOOM_CONFIG, ...(raw as Partial<ZoomConfig>) };
}

/**
 * Export frame rate, restricted to the rates the UI offers.
 *
 * Not clamped to the nearest: an out-of-set value means a project written by an
 * older build, when this was a free number field stepping by 30 from 60 — so 0
 * was two clicks away, and planExportFrames at 0 emits no frames while ffmpeg
 * gets `-r 0`. Such a project must not load into a UI that cannot show it.
 */
function exportFps(raw: unknown, fallback: number): number {
  return raw === 30 || raw === 60 ? raw : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function num01(v: unknown, fallback: number): number {
  return Math.min(1, Math.max(0, num(v, fallback)));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fallback;
}

/**
 * Cuts, with an id on every one of them and no two the same.
 *
 * Cuts written before ids existed get a deterministic `cut-<index>`, so the
 * same project.json migrates to the same ids every load. That fallback used to
 * be minted blind, and a project carrying an explicit id of literally `cut-1`
 * collided with the fallback for index 1. Harmless while nothing looked a cut
 * up by id; phase E's timeline does exactly that — `moveCut` and `resizeCut`
 * both `find` by id — so a collision would move or resize the wrong cut.
 *
 * Explicit ids are reserved up front. Their first occurrence is preserved;
 * duplicate occurrences receive deterministic fallbacks, just like missing ids.
 */
function migrateCuts(raw: unknown[]): Cut[] {
  const explicit = new Set(
    raw
      .filter(isRecord)
      .map((c) => c.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const taken = new Set<string>();

  return raw.flatMap((c, i) => {
    if (!isRecord(c)) return [];
    const startMs = num(c.startMs, 0);
    const endMs = num(c.endMs, 0);
    if (endMs <= startMs) return [];

    let id: string;
    if (typeof c.id === "string" && !taken.has(c.id)) {
      id = c.id;
    } else {
      id = `cut-${i}`;
      for (let n = 1; explicit.has(id) || taken.has(id); n += 1) id = `cut-${i}-${n}`;
    }

    taken.add(id);
    return [{ id, startMs, endMs }];
  });
}

const BACKGROUND_KINDS = ["gradient", "color", "image", "hidden"] as const;
const BLUR_STRENGTHS = ["none", "moderate", "strong"] as const;
const FRAME_PRESETS = ["default", "minimal", "hidden"] as const;
const ASPECTS = ["native", "16:9", "4:3", "1:1", "9:16"] as const;

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
  const cursor = isRecord(style.cursor) ? style.cursor : {};

  // Phase B grouped the loose frame fields under style.frame so a preset can
  // set them as a group. Read the new location first, then the old one.
  const frame = isRecord(style.frame) ? style.frame : {};
  const legacyShadow = isRecord(style.shadow) ? style.shadow : {};
  const shadow = isRecord(frame.shadow) ? frame.shadow : legacyShadow;
  const border = isRecord(frame.border) ? frame.border : {};

  // Phase B widened Background from a union to a flat record. Neither legacy
  // field survives: gradients are named presets now, and "solid" was renamed
  // "color". An old solid keeps its colour; an old two-stop gradient falls back
  // to the default preset, because there is no faithful mesh equivalent of it.
  const bg = isRecord(style.background) ? style.background : {};
  const legacyKind = str(bg.kind, "");
  const bgKind = legacyKind === "solid"
    ? "color"
    : oneOf(bg.kind, BACKGROUND_KINDS, base.style.background.kind);
  const output = isRecord(raw.output) ? raw.output : {};
  const audio = isRecord(raw.audio) ? raw.audio : {};
  const zoom = isRecord(raw.zoom) ? raw.zoom : {};

  return {
    version: 1,
    captions: normalizeCaptions(raw.captions),
    // The caller's id wins: the directory a bundle was loaded from is the
    // truth, and a copied project directory would otherwise keep a stale id.
    bundleId,
    cuts: Array.isArray(raw.cuts) ? migrateCuts(raw.cuts as unknown[]) : base.cuts,
    ...(Array.isArray(raw.clips) ? { clips: migrateCuts(raw.clips) } : {}),
    zoom: {
      config: zoomConfig(zoom.config),
      // A project written before phase C has keyframes but no segments. It
      // normalises to an empty list rather than losing the field; the editor
      // re-plans on load anyway.
      segments: Array.isArray(zoom.segments)
        ? (zoom.segments as Project["zoom"]["segments"])
        : base.zoom.segments,
      keyframes: Array.isArray(zoom.keyframes)
        ? (zoom.keyframes as Project["zoom"]["keyframes"])
        : base.zoom.keyframes,
    },
    style: {
      paddingFactor: num(style.paddingFactor, base.style.paddingFactor),
      motionBlurAmount: num01(style.motionBlurAmount, base.style.motionBlurAmount),
      frame: {
        preset: oneOf(frame.preset, FRAME_PRESETS, base.style.frame.preset),
        cornerRadiusPx: num(
          frame.cornerRadiusPx ?? style.cornerRadiusPx,
          base.style.frame.cornerRadiusPx,
        ),
        shadow: {
          blurPx: num(shadow.blurPx, base.style.frame.shadow.blurPx),
          opacity: num(shadow.opacity, base.style.frame.shadow.opacity),
          offsetYPx: num(shadow.offsetYPx, base.style.frame.shadow.offsetYPx),
        },
        border: {
          visible: bool(border.visible, base.style.frame.border.visible),
          widthPx: num(border.widthPx, base.style.frame.border.widthPx),
          color: str(border.color, base.style.frame.border.color),
        },
      },
      background: {
        kind: bgKind,
        preset: str(bg.preset, base.style.background.preset),
        // An old { kind: "solid", color } keeps its colour through the rename.
        color: str(bg.color, base.style.background.color),
        imageFile: typeof bg.imageFile === "string" ? bg.imageFile : null,
        // Never invent a blur an old project did not ask for.
        blur: oneOf(bg.blur, BLUR_STRENGTHS, "none"),
      },
      cursor: {
        visible: bool(cursor.visible, base.style.cursor.visible),
        appearance: oneOf(cursor.appearance, ["classic", "rounded", "filled", "dot", "outline"], base.style.cursor.appearance),
        loop: bool(cursor.loop, false),
        motionBlur: num01(cursor.motionBlur, 0),
        clickBounce: Math.min(5, Math.max(0, num(cursor.clickBounce, 0))),
        bounceDurationMs: Math.min(1000, Math.max(100, num(cursor.bounceDurationMs, 350))),
        sway: Math.min(2, Math.max(0, num(cursor.sway, 0))),
        sizePct: Math.min(500, Math.max(10, num(cursor.sizePct, base.style.cursor.sizePct))),
        smoothing: num(cursor.smoothing, base.style.cursor.smoothing),
        shadow: bool(cursor.shadow, base.style.cursor.shadow),
        ripples: bool(cursor.ripples, base.style.cursor.ripples),
      },
    },
    webcam: isRecord(raw.webcam)
      ? {
          visible: bool(raw.webcam.visible, base.webcam.visible),
          mirror: bool(raw.webcam.mirror, base.webcam.mirror),
          shape: oneOf(raw.webcam.shape, ["circle", "rounded"], base.webcam.shape),
          position: oneOf(raw.webcam.position, ["bottom-right", "bottom-left", "top-right", "top-left"], base.webcam.position),
          sizePct: num(raw.webcam.sizePct, base.webcam.sizePct),
          marginPx: num(raw.webcam.marginPx, base.webcam.marginPx),
        }
      : base.webcam,
    audio: {
      micGainDb: num(audio.micGainDb, base.audio.micGainDb),
      systemGainDb: num(audio.systemGainDb, base.audio.systemGainDb),
      syncNudgeMs: num(audio.syncNudgeMs, base.audio.syncNudgeMs),
    },
    output: {
      width: num(output.width, base.output.width),
      height: num(output.height, base.output.height),
      // "native" keeps every existing export exactly as it was.
      aspect: oneOf(output.aspect, ASPECTS, "native"),
      fps: exportFps(output.fps, base.output.fps),
      bitrateMbps: num(output.bitrateMbps, base.output.bitrateMbps),
    },
  };
}
