import type { TelemetryEvent } from "../bundle/types";
import type { Impulse, ZoomConfig } from "./types";

const CLICK_WEIGHT = 1;
const KEY_WEIGHT = 0.4;
const WHEEL_WEIGHT = 0.3;

/**
 * Turn raw telemetry into weighted attention impulses.
 *
 * uiohook reports keystrokes with no coordinates, so typing tells us WHEN
 * attention is concentrated but never WHERE. Keystrokes therefore borrow the
 * most recent click's position — people click into an editor before typing
 * into it — falling back to the cursor once that click goes stale.
 */
export function toImpulses(events: TelemetryEvent[], cfg: ZoomConfig): Impulse[] {
  const out: Impulse[] = [];
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
        out.push({ t: e.t, x: e.x, y: e.y, w: CLICK_WEIGHT, srcIndex: i });
        break;

      case "wheel":
        lastCursor = { x: e.x, y: e.y };
        out.push({ t: e.t, x: e.x, y: e.y, w: WHEEL_WEIGHT, srcIndex: i });
        break;

      case "key": {
        if (e.d !== "down") break;
        const click = lastClick;
        const fresh = click !== null && e.t - click.t <= cfg.keyAnchorWindowMs;
        const anchor = fresh ? click : lastCursor;
        if (anchor === null) break;
        out.push({ t: e.t, x: anchor.x, y: anchor.y, w: KEY_WEIGHT, srcIndex: i });
        break;
      }

      default:
        break;
    }
  });

  return out;
}
