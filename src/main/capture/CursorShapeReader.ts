import koffi, { type TypeObject } from "koffi";
import type { CursorShape, TelemetryEvent } from "../../shared/bundle/types";
import { createShapeTracker, type ShapeTable } from "../../shared/cursor/shapeTracker";
import { logDiag } from "../log";

const POLL_INTERVAL_MS = 1000 / 30;
const CURSOR_SHOWING = 1;

/** IDC_* resource ids for the shapes CursorShape can represent. */
const IDC: Record<number, CursorShape> = {
  32512: "arrow",
  32513: "ibeam",
  32514: "wait",
  32642: "nwse",
  32643: "nesw",
  32644: "ew",
  32645: "ns",
  32649: "hand",
};

/**
 * Reads the live cursor shape at 30Hz.
 *
 * uiohook reports position but never shape, and ffmpeg's draw_mouse would bake
 * the cursor into the pixels — which is exactly what v1 decision #6 rules out,
 * because a baked cursor cannot be smoothed, resized or zoomed. So the shape is
 * read separately and drawn at render time.
 */
type Bindings = {
  CURSORINFO: TypeObject;
  GetCursorInfo: (info: unknown) => boolean;
  table: ShapeTable;
};

let bindings: Bindings | null = null;

/**
 * Load user32 and register the FFI types, once per process.
 *
 * koffi.struct() registers a NAMED type in a process-global registry, so a
 * second call with the same name throws "Duplicate type name". This used to sit
 * inside start(), which runs once per recording - so the second recording of an
 * app session threw, the throw was swallowed by start()'s own catch, and the
 * take silently carried no shape stream at all while the manifest still claimed
 * one. zoomcast is a tray app that lives for days, so that was the normal case
 * rather than the edge one. The registry is process-global, so the bindings
 * have to be too.
 */
function loadBindings(): Bindings {
  if (bindings !== null) return bindings;

  const user32 = koffi.load("user32.dll");

  const POINT = koffi.struct("POINT", { x: "int32", y: "int32" });
  const CURSORINFO = koffi.struct("CURSORINFO", {
    cbSize: "uint32",
    flags: "uint32",
    hCursor: "void *",
    ptScreenPos: POINT,
  });

  // inout, not out: GetCursorInfo requires the caller to set cbSize before
  // the call, and koffi.out() treats the buffer as write-only — the struct
  // that reaches the API would carry cbSize 0 and fail with error 87 on
  // every call, silently and forever. Confirmed by probe in task 1.
  const GetCursorInfo = user32.func("__stdcall", "GetCursorInfo", "bool", [
    koffi.inout(koffi.pointer(CURSORINFO)),
  ]);
  const LoadCursorW = user32.func("__stdcall", "LoadCursorW", "void *", [
    "void *",
    "uintptr_t",
  ]);

  const table: ShapeTable = new Map();
  for (const [id, shape] of Object.entries(IDC)) {
    const handle = Number(koffi.address(LoadCursorW(null, Number(id))));
    if (handle !== 0) table.set(handle, shape);
  }

  bindings = { CURSORINFO, GetCursorInfo, table };
  return bindings;
}

export class CursorShapeReader {
  private timer: NodeJS.Timeout | null = null;

  private constructor(
    private readonly poll: () => void,
  ) {}

  static start(
    onEvent: (e: TelemetryEvent) => void,
    now: () => number,
  ): CursorShapeReader | null {
    try {
      const { CURSORINFO, GetCursorInfo, table } = loadBindings();

      const tracker = createShapeTracker(table);

      const reader = new CursorShapeReader(() => {
        // A fresh literal per poll: koffi zeroes cbSize when it decodes the
        // result, so a reused object fails from the second call onward.
        const info = {
          cbSize: koffi.sizeof(CURSORINFO),
          flags: 0,
          hCursor: null,
          ptScreenPos: { x: 0, y: 0 },
        };

        if (!GetCursorInfo(info)) return;
        const event = tracker.observe(
          now(),
          Number(koffi.address(info.hCursor)),
          (info.flags & CURSOR_SHOWING) !== 0,
        );
        if (event !== null) onEvent(event);
      });

      reader.timer = setInterval(reader.poll, POLL_INTERVAL_MS);
      reader.poll();
      return reader;
    } catch (err) {
      // A missing shape stream is a degraded recording, not a failed one:
      // the renderer falls back to drawing an arrow throughout.
      logDiag("cursorShape", err);
      return null;
    }
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
