import { describe, expect, it } from "vitest";
import {
  beginOrExtend,
  canRedo,
  canUndo,
  commit,
  createHistory,
  HISTORY_CAP,
  push,
  redo,
  undo,
  type Entry,
} from "./history";
import { defaultProject } from "./defaults";

const base = defaultProject("test-bundle");

/** Entries differing only in a field cheap to vary. */
function entry(micGainDb: number, selection: Entry["selection"] = null): Entry {
  return { project: { ...base, audio: { ...base.audio, micGainDb } }, selection };
}

describe("push", () => {
  it("moves the present into the past", () => {
    const h = push(createHistory(entry(0)), entry(1));
    expect(h.present.project.audio.micGainDb).toBe(1);
    expect(h.past).toHaveLength(1);
    expect(h.past[0]!.project.audio.micGainDb).toBe(0);
  });

  it("records nothing when the entry is deep-equal to the present", () => {
    const h = push(createHistory(entry(0)), entry(0));
    expect(h.past).toHaveLength(0);
  });

  it("treats a selection-only change as a real change", () => {
    const h = push(createHistory(entry(0)), entry(0, { kind: "segment", id: "s1" }));
    expect(h.past).toHaveLength(1);
  });

  it("clears the future", () => {
    const h = undo(push(createHistory(entry(0)), entry(1)));
    expect(canRedo(h)).toBe(true);
    expect(canRedo(push(h, entry(2)))).toBe(false);
  });

  it("caps the past at HISTORY_CAP, dropping the oldest", () => {
    let h = createHistory(entry(0));
    for (let i = 1; i <= HISTORY_CAP + 10; i += 1) h = push(h, entry(i));
    expect(h.past).toHaveLength(HISTORY_CAP);
    // The oldest survivor, not the original entry(0).
    expect(h.past[0]!.project.audio.micGainDb).toBe(10);
  });
});

describe("undo / redo", () => {
  it("round trips", () => {
    const h = push(createHistory(entry(0)), entry(1));
    const back = undo(h);
    expect(back.present.project.audio.micGainDb).toBe(0);
    expect(redo(back).present.project.audio.micGainDb).toBe(1);
  });

  it("restores the selection alongside the project", () => {
    const h = push(createHistory(entry(0, { kind: "segment", id: "s1" })), entry(1, null));
    expect(undo(h).present.selection).toEqual({ kind: "segment", id: "s1" });
  });

  it("is a no-op at the ends", () => {
    const h = createHistory(entry(0));
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(canRedo(h)).toBe(false);
    expect(redo(h)).toBe(h);
  });
});

describe("gestures", () => {
  it("leaves exactly one entry for many extends and one commit", () => {
    let h = createHistory(entry(0));
    h = beginOrExtend(h, entry(1));
    h = beginOrExtend(h, entry(2));
    h = beginOrExtend(h, entry(3));
    h = commit(h);
    expect(h.past).toHaveLength(1);
    expect(h.past[0]!.project.audio.micGainDb).toBe(0);
    expect(h.present.project.audio.micGainDb).toBe(3);
    expect(h.gestureOpen).toBe(false);
  });

  it("undoes the whole gesture in one step", () => {
    let h = createHistory(entry(0));
    h = commit(beginOrExtend(beginOrExtend(h, entry(1)), entry(2)));
    expect(undo(h).present.project.audio.micGainDb).toBe(0);
  });

  it("leaves no entry for a gesture that returns to its start", () => {
    let h = createHistory(entry(0));
    h = beginOrExtend(h, entry(1));
    h = beginOrExtend(h, entry(0));
    h = commit(h);
    expect(h.past).toHaveLength(0);
    expect(h.present.project.audio.micGainDb).toBe(0);
  });
});
