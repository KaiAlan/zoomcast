import type { Project } from "./types";

/** What is selected in the timeline. Segments and cuts share one field. */
export type Selection = { kind: "segment" | "cut"; id: string } | null;

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
 * The FIRST call of a gesture pushes, so the pre-drag state reaches `past`;
 * later calls only replace `present`. Without that first push the pre-drag
 * project is overwritten by the first pointermove and nothing holds it any
 * more.
 */
export function beginOrExtend(h: History, next: Entry): History {
  if (h.gestureOpen) {
    return { ...h, present: next, future: [] };
  }

  return { ...push(h, next), gestureOpen: true };
}

/**
 * End a drag.
 *
 * Unwinds the entry `beginOrExtend` pushed if the gesture turned out to be a
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
