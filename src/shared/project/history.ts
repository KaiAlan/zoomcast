import type { Project } from "./types";

/** What is selected in the timeline. Segments and cuts share one field. */
export type Selection = { kind: "segment" | "cut" | "clip"; id: string } | null;

export type Entry = { project: Project; selection: Selection };

export type History = {
  past: Entry[];
  present: Entry;
  future: Entry[];
  /** Open while a drag is in flight. See `beginOrExtend`. */
  gestureOpen: boolean;
};

/** v1 §6: the document is small enough that nothing cleverer is warranted. */
export const HISTORY_CAP = 100;

export function createHistory(present: Entry): History {
  return { past: [], present, future: [], gestureOpen: false };
}

/**
 * Deep equality by `JSON.stringify`. Sound for `Entry` because of how
 * `Project` is shaped today — no `Date`/`Map`/`Set` in it, `pinned` required
 * rather than optional (so no present-but-undefined vs absent), and key order
 * fixed by every writer spreading `defaultProject` — which is a property of
 * the type, not something this module enforces.
 */
function same(a: Entry, b: Entry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function capped(past: Entry[]): Entry[] {
  return past.length > HISTORY_CAP ? past.slice(past.length - HISTORY_CAP) : past;
}

/**
 * Commit one edit.
 *
 * A no-op records nothing: a drag that ends where it started, or a depth
 * preset that re-selects the current depth, must not consume an undo slot.
 */
export function push(h: History, next: Entry): History {
  if (same(h.present, next)) return h;

  return {
    past: capped([...h.past, h.present]),
    present: next,
    future: [],
    gestureOpen: h.gestureOpen,
  };
}

/**
 * One step of a drag.
 *
 * The FIRST call of a gesture banks the pre-drag entry in `past`; later calls
 * only replace `present`. Without that first bank the pre-drag project is
 * overwritten by the first pointermove and nothing holds it any more.
 *
 * Deliberately NOT routed through `push`. `push` declines a no-op and returns
 * `h` untouched, which is right for a discrete edit and wrong here: a first
 * pointermove that changes nothing — a segment already held against zero
 * dragged further left, a cut already on the `MIN_CUT_MS` floor — would leave
 * `gestureOpen` true with nothing banked, and every later step would then
 * overwrite `present` with the pre-drag state lost. `commit`'s unwind is the
 * single place a no-op gesture is decided (spec §5); this one only opens.
 */
export function beginOrExtend(h: History, next: Entry): History {
  if (h.gestureOpen) {
    return { ...h, present: next, future: [] };
  }

  return {
    past: capped([...h.past, h.present]),
    present: next,
    future: [],
    gestureOpen: true,
  };
}

/**
 * End a drag.
 *
 * Unwinds the entry `beginOrExtend` banked if the gesture turned out to be a
 * no-op — dragging a segment and putting it back must not cost an undo step.
 */
export function commit(h: History): History {
  if (!h.gestureOpen) return h;

  const previous = h.past[h.past.length - 1];
  if (previous !== undefined && same(previous, h.present)) {
    return { ...h, past: h.past.slice(0, -1), gestureOpen: false };
  }

  return { ...h, gestureOpen: false };
}

export function canUndo(h: History): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History): boolean {
  return h.future.length > 0;
}

export function undo(h: History): History {
  const previous = h.past[h.past.length - 1];
  if (previous === undefined) return h;

  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    gestureOpen: false,
  };
}

export function redo(h: History): History {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;

  return {
    past: capped([...h.past, h.present]),
    present: next,
    future: rest,
    gestureOpen: false,
  };
}
