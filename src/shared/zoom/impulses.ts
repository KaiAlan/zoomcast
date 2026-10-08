import type { TelemetryEvent } from "../bundle/types";
import { contextResolver } from "./context";
import type { Impulse, ZoomConfig } from "./types";

const CLICK_WEIGHT = 1;
const KEY_WEIGHT = 0.4;
const WHEEL_WEIGHT = 0.3;

/**
 * Turn raw telemetry into weighted attention impulses.
 *
 * uiohook reports keystrokes with no coordinates, so typing tells us WHEN
 * attention is concentrated. Focused-control bounds supply WHERE when present.
 * Older/opaque captures borrow the most recent click, then the cursor.
 */
export function toImpulses(events: TelemetryEvent[], cfg: ZoomConfig): Impulse[] {
  const out: Impulse[] = [];
  const context = contextResolver(events);
  let lastCursor: { x: number; y: number } | null = null;
  let lastClick: { x: number; y: number; t: number } | null = null;

  events.forEach((e, i) => {
    switch (e.k) {
      case "move":
        lastCursor = { x: e.x, y: e.y };
        break;

      case "down":
        lastCursor = { x: e.x, y: e.y };
        lastClick = { x: e.x, y: e.y, t: e.t };
        out.push({ t: e.t, x: e.x, y: e.y, w: CLICK_WEIGHT, srcIndex: i, kind: "click" });
        break;

      case "wheel":
        lastCursor = { x: e.x, y: e.y };
        out.push({ t: e.t, x: e.x, y: e.y, w: WHEEL_WEIGHT, srcIndex: i, kind: "wheel" });
        break;

      case "key": {
        if (e.d !== "down") break;
        const click = lastClick;
        const fresh = click !== null && e.t - click.t <= cfg.keyAnchorWindowMs;
        const focused = context(e.t, "key");
        const anchor = focused ? { x: focused.rect.x + focused.rect.w / 2, y: focused.rect.y + focused.rect.h / 2 } : fresh ? click : lastCursor;
        if (anchor === null) break;
        out.push({ t: e.t, x: anchor.x, y: anchor.y, w: KEY_WEIGHT, srcIndex: i, kind: "key" });
        break;
      }

      default:
        break;
    }
  });

  return out;
}

/** A click starts a shot; typing may continue it. Hover/scroll never starts one. */
export function clickAttention(events: TelemetryEvent[], cfg: ZoomConfig): Impulse[] {
  let clicked: Impulse | undefined;
  let lastKeyAt = -Infinity;
  const out: Impulse[] = [];
  const focused = contextResolver(events);
  for (const impulse of toImpulses(events, cfg)) {
    if (impulse.kind === "click") {
      clicked = impulse; lastKeyAt = -Infinity; out.push(impulse);
    } else if (impulse.kind === "key" && clicked
      && (impulse.t - clicked.t <= cfg.keyAnchorWindowMs || impulse.t - lastKeyAt <= cfg.clusterWindowMs)) {
      const control = focused(impulse.t, "key");
      out.push({ ...impulse, x: control ? control.rect.x + control.rect.w / 2 : clicked.x,
        y: control ? control.rect.y + control.rect.h / 2 : clicked.y });
      lastKeyAt = impulse.t;
    }
  }
  return out;
}
