import type { TelemetryEvent } from "../bundle/types";
import type { Rect } from "./geometry";

export type ControlContext = { role: string; rect: Rect };
export type ContextEvent = Extract<TelemetryEvent, { k: "context" }>;
export type ControlCandidate = { role: string; rect: Rect };
const containers = new Set(["ToolBar", "Menu", "MenuBar", "List", "Tree", "DataGrid", "Tab", "Table", "Header", "StatusBar", "AppBar", "Group", "Pane", "Custom"]);
const fields = new Set(["Edit", "ComboBox", "Slider", "Spinner", "Calendar"]);

/** Bounds and roles only: neither accessible names nor field values are collected. */
export function validControlContext(value: unknown): value is ControlContext {
  if (!value || typeof value !== "object") return false;
  const { role, rect } = value as ControlContext;
  return typeof role === "string" && /^[A-Za-z]{1,32}$/.test(role) && !!rect
    && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)
    && rect.w > 0 && rect.h > 0 && rect.w < 100000 && rect.h < 100000;
}

/** Prefer a toolbar/menu/field over a tiny icon; ignore whole-window ancestors. */
export function chooseControlContext(candidates: ControlCandidate[], capture: Rect, point?: { x: number; y: number }): ControlContext | null {
  const usable = candidates.filter(c => validControlContext(c)
    && c.role !== "Window" && c.role !== "Document"
    && c.rect.x >= capture.x - 2 && c.rect.y >= capture.y - 2
    && c.rect.x + c.rect.w <= capture.x + capture.w + 2
    && c.rect.y + c.rect.h <= capture.y + capture.h + 2
    && (!point || (point.x >= c.rect.x - 2 && point.x <= c.rect.x + c.rect.w + 2
      && point.y >= c.rect.y - 2 && point.y <= c.rect.y + c.rect.h + 2)));
  if (!usable.length) return null;
  const modest = (c: ControlCandidate) => c.rect.w * c.rect.h < capture.w * capture.h * 0.65;
  const field = usable.find(c => c.role === "ComboBox" && modest(c))
    ?? usable.find(c => fields.has(c.role) && modest(c));
  const bar = usable.find(c => ["ToolBar", "Menu", "MenuBar"].includes(c.role) && modest(c));
  const group = usable.find(c => containers.has(c.role) && modest(c) && c.rect.w >= 80 && c.rect.h >= 28);
  const target = field ?? bar ?? group ?? usable.find(c => modest(c) && c.rect.w >= 20 && c.rect.h >= 16);
  return target ? { role: target.role, rect: { ...target.rect, x: target.rect.x - capture.x, y: target.rect.y - capture.y } } : null;
}

/** Async replies retain the originating input timestamp, even if logged later. */
export function contextResolver(events: TelemetryEvent[]): (t: number, trigger: ContextEvent["trigger"]) => ControlContext | undefined {
  const contexts = events.filter((e): e is ContextEvent => e.k === "context" && validControlContext(e.target));
  const exact = new Map(contexts.map(e => [`${e.trigger}:${e.t}`, e.target]));
  const focus = contexts.filter(e => e.trigger === "key");
  return (t, trigger) => {
    const match = exact.get(`${trigger}:${t}`);
    if (match || trigger !== "key") return match;
    let lo = 0, hi = focus.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if ((focus[mid]?.t ?? Infinity) <= t) lo = mid + 1; else hi = mid; }
    const recent = focus[lo - 1];
    return recent && t - recent.t <= 1200 ? recent.target : undefined;
  };
}
