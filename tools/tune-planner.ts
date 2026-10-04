/**
 * Planner tuning against real telemetry.
 *
 * The zoom defaults in src/shared/zoom/config.ts were only ever judged against
 * synthetic fixtures, where the click pattern is whatever make-fixture.ts was
 * told to emit. This replays REAL recordings through planZoom and reports what
 * the plan actually looks like, so the dials can be judged without watching a
 * window — the same reason verify:decode and verify:parity exist.
 *
 * src/shared/ is pure, so this is plain node. No Electron, no ffmpeg.
 *
 * Run: npm run tune -- <take|all> [--set k=v,k=v] [--compare]
 *
 *   npm run tune -- all                     every take on disk, default config
 *   npm run tune -- 2026-09-03T21-24-08     one take, with the per-zoom table
 *   npm run tune -- <take> --set minHoldMs=2500,deadzonePx=200
 *   npm run tune -- <take> --compare        default vs. the built-in variants
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { TelemetryEvent } from "../src/shared/bundle/types";
import { clusterImpulses, mergeAndFilter } from "../src/shared/zoom/cluster";
import { DEFAULT_ZOOM_CONFIG } from "../src/shared/zoom/config";
import { applyGuards } from "../src/shared/zoom/guards";
import { toImpulses } from "../src/shared/zoom/impulses";
import { segmentsToKeyframes } from "../src/shared/zoom/keyframes";
import { planZoom } from "../src/shared/zoom/planner";
import type { PlanContext, ZoomConfig, ZoomKeyframe } from "../src/shared/zoom/types";

const RECORDINGS = join(
  process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
  "zoomcast",
  "recordings",
);

/** Matches src/shared/project/defaults.ts. */
const PADDING_FACTOR = 0.85;

type Take = {
  id: string;
  events: TelemetryEvent[];
  ctx: PlanContext;
  durationMs: number;
  clean: boolean;
};

function loadTake(dir: string, id: string): Take | null {
  const jsonl = join(dir, "input.jsonl");
  if (!existsSync(jsonl)) return null;

  const events = readFileSync(jsonl, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as TelemetryEvent);

  if (events.length === 0) return null;

  const manPath = join(dir, "manifest.json");
  const clean = existsSync(manPath);
  const man = clean
    ? (JSON.parse(readFileSync(manPath, "utf8")) as {
        durationMs: number;
        display: { width: number; height: number };
      })
    : null;

  // An unclean take has no manifest; fall back to the last event and the
  // panel size, which is what every take on this machine was captured at.
  const source = man
    ? { w: man.display.width, h: man.display.height }
    : { w: 1920, h: 1080 };

  const durationMs = man?.durationMs ?? (events[events.length - 1]?.t ?? 0);

  return {
    id,
    events,
    ctx: {
      source,
      output: { ...source },
      paddingFactor: PADDING_FACTOR,
      durationMs,
    },
    durationMs,
    clean,
  };
}

function loadAll(): Take[] {
  if (!existsSync(RECORDINGS)) return [];
  return readdirSync(RECORDINGS)
    .sort()
    .map((id) => loadTake(join(RECORDINGS, id), id))
    .filter((t): t is Take => t !== null);
}

type Zoom = {
  inT: number;
  outT: number;
  scale: number;
  cx: number;
  cy: number;
  /** Focus points visited without pulling out. 1 is an ordinary zoom. */
  stops: number;
};

/**
 * Recover segments from the keyframe list: a run of scale > 1 keyframes closed
 * by a scale-1 one. A run longer than a single keyframe is a travelling zoom.
 */
function toZooms(kfs: ZoomKeyframe[]): Zoom[] {
  const zooms: Zoom[] = [];
  let open: ZoomKeyframe[] = [];

  for (const k of kfs) {
    if (k.scale > 1) {
      open.push(k);
      continue;
    }

    const first = open[0];
    if (first !== undefined) {
      zooms.push({
        inT: first.tSourceMs,
        outT: k.tSourceMs,
        scale: Math.max(...open.map((o) => o.scale)),
        cx: first.cx,
        cy: first.cy,
        stops: open.length,
      });
    }
    open = [];
  }

  return zooms;
}

type Metrics = {
  zooms: number;
  perMinute: number;
  coverage: number;
  shortestHoldMs: number;
  medianHoldMs: number;
  shortestGapMs: number;
  maxJumpPx: number;
  scaleMin: number;
  scaleMax: number;
};

function median(ns: number[]): number {
  if (ns.length === 0) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[m - 1] as number) + (s[m] as number)) / 2 : (s[m] as number);
}

function metrics(zooms: Zoom[], take: Take): Metrics {
  const holds = zooms.map((z) => z.outT - z.inT);
  const gaps: number[] = [];
  let maxJump = 0;

  for (let i = 1; i < zooms.length; i++) {
    const prev = zooms[i - 1] as Zoom;
    const cur = zooms[i] as Zoom;
    gaps.push(cur.inT - prev.outT);
    maxJump = Math.max(
      maxJump,
      Math.hypot(
        (cur.cx - prev.cx) * take.ctx.source.w,
        (cur.cy - prev.cy) * take.ctx.source.h,
      ),
    );
  }

  const zoomedMs = holds.reduce((a, b) => a + b, 0);
  const scales = zooms.map((z) => z.scale);

  return {
    zooms: zooms.length,
    perMinute: take.durationMs > 0 ? (zooms.length / take.durationMs) * 60_000 : 0,
    coverage: take.durationMs > 0 ? zoomedMs / take.durationMs : 0,
    shortestHoldMs: holds.length > 0 ? Math.min(...holds) : 0,
    medianHoldMs: median(holds),
    shortestGapMs: gaps.length > 0 ? Math.min(...gaps) : Infinity,
    maxJumpPx: maxJump,
    scaleMin: scales.length > 0 ? Math.min(...scales) : 1,
    scaleMax: scales.length > 0 ? Math.max(...scales) : 1,
  };
}

/** Where candidate zooms die. Shows which dial is actually binding. */
function funnel(take: Take, cfg: ZoomConfig): Record<string, number> {
  const imps = toImpulses(take.events, cfg);
  const clustered = clusterImpulses(imps, cfg);
  const merged = mergeAndFilter(clustered, cfg);
  const guarded = applyGuards(merged, cfg, take.durationMs);
  const planned = toZooms(segmentsToKeyframes(planZoom(take.events, cfg, take.ctx), cfg, take.ctx));

  return {
    impulses: imps.length,
    clustered: clustered.length,
    "merged+weighted": merged.length,
    guarded: guarded.length,
    "scale>1": planned.length,
  };
}

function fmt(n: number, d = 1): string {
  return Number.isFinite(n) ? n.toFixed(d) : "—";
}

function reportTake(take: Take, cfg: ZoomConfig, detail: boolean): void {
  const zooms = toZooms(segmentsToKeyframes(planZoom(take.events, cfg, take.ctx), cfg, take.ctx));
  const m = metrics(zooms, take);

  console.log(
    `\n${take.id}  ${fmt(take.durationMs / 1000)}s  ${take.events.length} events` +
      `  ${take.clean ? "clean" : "UNCLEAN (no manifest)"}`,
  );
  console.log(`  funnel: ${Object.entries(funnel(take, cfg)).map(([k, v]) => `${k}=${v}`).join("  →  ")}`);
  console.log(
    `  ${m.zooms} zooms  ${fmt(m.perMinute)}/min  ${fmt(m.coverage * 100, 0)}% zoomed` +
      `  hold med ${fmt(m.medianHoldMs / 1000, 2)}s min ${fmt(m.shortestHoldMs / 1000, 2)}s` +
      `  gap min ${fmt(m.shortestGapMs / 1000, 2)}s` +
      `  scale ${fmt(m.scaleMin, 3)}–${fmt(m.scaleMax, 3)}  max jump ${fmt(m.maxJumpPx, 0)}px`,
  );

  if (detail && zooms.length > 0) {
    console.table(
      zooms.map((z, i) => {
        const prev = zooms[i - 1];
        return {
          "#": i,
          in: `${fmt(z.inT / 1000, 2)}s`,
          out: `${fmt(z.outT / 1000, 2)}s`,
          hold: `${fmt((z.outT - z.inT) / 1000, 2)}s`,
          gap: prev === undefined ? "—" : `${fmt((z.inT - prev.outT) / 1000, 2)}s`,
          scale: fmt(z.scale, 3),
          stops: z.stops,
          "cx,cy": `${Math.round(z.cx * take.ctx.source.w)},${Math.round(z.cy * take.ctx.source.h)}`,
          jump:
            prev === undefined
              ? "—"
              : `${fmt(Math.hypot((z.cx - prev.cx) * take.ctx.source.w, (z.cy - prev.cy) * take.ctx.source.h), 0)}px`,
        };
      }),
    );
  }
}

const VARIANTS: Array<{ name: string; patch: Partial<ZoomConfig> }> = [
  { name: "default", patch: {} },
  { name: "calmer   (hold 2.5s)", patch: { minHoldMs: 2500 } },
  { name: "calmer+  (hold 3.5s)", patch: { minHoldMs: 3500 } },
  { name: "wide deadzone (240px)", patch: { deadzonePx: 240 } },
  { name: "sticky   (trail 900ms)", patch: { trailMs: 900 } },
  { name: "picky    (weight 1.4)", patch: { minWeight: 1.4 } },
  { name: "combined", patch: { minHoldMs: 2500, deadzonePx: 200, trailMs: 800, minWeight: 1.2 } },
  { name: "dwell 1.8s", patch: { minDwellMs: 1800 } },
  { name: "dwell 2.2s", patch: { minDwellMs: 2200 } },
  { name: "recovery 1.0s", patch: { minRecoveryMs: 1000 } },
  { name: "dwell 2.0 + rec 1.0", patch: { minDwellMs: 2000, minRecoveryMs: 1000 } },
];

function compare(takes: Take[]): void {
  for (const take of takes) {
    console.log(`\n=== ${take.id}  ${fmt(take.durationMs / 1000)}s  ${take.events.length} events`);
    console.table(
      VARIANTS.map(({ name, patch }) => {
        const cfg = { ...DEFAULT_ZOOM_CONFIG, ...patch };
        const m = metrics(toZooms(segmentsToKeyframes(planZoom(take.events, cfg, take.ctx), cfg, take.ctx)), take);
        return {
          variant: name,
          zooms: m.zooms,
          "per min": fmt(m.perMinute),
          "zoomed %": fmt(m.coverage * 100, 0),
          "hold med": fmt(m.medianHoldMs / 1000, 2),
          "hold min": fmt(m.shortestHoldMs / 1000, 2),
          "gap min": fmt(m.shortestGapMs / 1000, 2),
          "jump max": fmt(m.maxJumpPx, 0),
        };
      }),
    );
  }
}

function parseSet(arg: string): Partial<ZoomConfig> {
  const patch: Record<string, number | string> = {};
  for (const pair of arg.split(",")) {
    const [k, v] = pair.split("=");
    if (k === undefined || v === undefined) throw new Error(`bad --set pair: ${pair}`);
    if (!(k in DEFAULT_ZOOM_CONFIG)) throw new Error(`unknown config key: ${k}`);
    patch[k] = k === "easing" ? v : Number(v);
  }
  return patch as Partial<ZoomConfig>;
}

const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith("--")) ?? "all";
const setArg = args.find((a) => a.startsWith("--set="))?.slice("--set=".length);
const setIdx = args.indexOf("--set");
const setVal = setArg ?? (setIdx >= 0 ? args[setIdx + 1] : undefined);
const wantCompare = args.includes("--compare");

const all = loadAll();
if (all.length === 0) {
  console.error(`no takes with telemetry under ${RECORDINGS}`);
  process.exit(1);
}

const takes = which === "all" ? all : all.filter((t) => t.id.includes(which));
if (takes.length === 0) {
  console.error(`no take matching "${which}". available:\n  ${all.map((t) => t.id).join("\n  ")}`);
  process.exit(1);
}

const cfg = { ...DEFAULT_ZOOM_CONFIG, ...(setVal !== undefined ? parseSet(setVal) : {}) };

if (setVal !== undefined) console.log(`config overrides: ${setVal}`);

if (wantCompare) compare(takes);
else for (const take of takes) reportTake(take, cfg, takes.length === 1);
