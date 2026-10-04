import { useCallback, useMemo, useRef, useState } from "react";
import {
  beginOrExtend,
  canRedo as canRedoOf,
  canUndo as canUndoOf,
  commit,
  createHistory,
  push,
  redo as redoOf,
  undo as undoOf,
  type History,
  type Selection,
} from "../../shared/project/history";
import type { Project } from "../../shared/project/types";
import { deriveKeyframes, replanFrom, type DeriveContext } from "../../shared/zoom/derive";

export type ProjectHistory = {
  project: Project;
  selection: Selection;
  canUndo: boolean;
  canRedo: boolean;
  apply: (fn: (p: Project) => Project, opts?: { replan?: boolean }) => void;
  applyTransient: (fn: (p: Project) => Project) => void;
  commitGesture: () => void;
  reset: (fn: (p: Project) => Project, opts?: { replan?: boolean }) => void;
  select: (selection: Selection) => void;
  undo: () => void;
  redo: () => void;
};

/**
 * The one way an edit reaches the project, the history and the preview.
 *
 * Every mutation used to be a bare `setProject` that also hand-patched
 * `live.current`, and the file recorded what happened when one forgot:
 * `addCut` "patched `live.current` and never redrew at all, so adding a cut
 * left a stale frame on screen until the next scrub". Phase E adds eight more
 * mutations, so the patching happens here once instead.
 */
export function useProjectHistory(
  initial: Project,
  ctx: DeriveContext,
  onProject: (p: Project) => void,
): ProjectHistory {
  const [history, setHistory] = useState<History>(() =>
    createHistory({ project: initial, selection: null }),
  );

  // Read inside callbacks so they need not be rebuilt when the context moves.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const onProjectRef = useRef(onProject);
  onProjectRef.current = onProject;

  /** Keyframes are derived, so no edit may leave them behind. */
  const rederive = useCallback((p: Project, replan: boolean): Project => {
    const parts = replan
      ? replanFrom(p.zoom.config, p, ctxRef.current)
      : deriveKeyframes(p.zoom.config, p, ctxRef.current);
    return { ...p, zoom: { ...p.zoom, ...parts } };
  }, []);

  const step = useCallback(
    (
      fn: (p: Project) => Project,
      commitStyle: "push" | "extend",
      replan: boolean,
    ): void => {
      setHistory((h) => {
        const next = rederive(fn(h.present.project), replan);
        // Selection travels inside the snapshot, which is what makes undoing a
        // delete restore what was selected when it happened.
        const entry = { project: next, selection: h.present.selection };
        const advanced = commitStyle === "push" ? push(h, entry) : beginOrExtend(h, entry);
        onProjectRef.current(advanced.present.project);
        return advanced;
      });
    },
    [rederive],
  );

  const apply = useCallback(
    (fn: (p: Project) => Project, opts?: { replan?: boolean }): void =>
      step(fn, "push", opts?.replan === true),
    [step],
  );

  const applyTransient = useCallback(
    (fn: (p: Project) => Project): void => step(fn, "extend", false),
    [step],
  );

  const commitGesture = useCallback((): void => setHistory((h) => commit(h)), []);

  /**
   * Replace the document without recording an edit.
   *
   * The load-time plan is not something the user did. Pushing it would leave
   * `canUndo` true the moment a bundle opens, and the state it would undo to
   * is a project with no segments in it — one that was never on screen.
   */
  const reset = useCallback(
    (fn: (p: Project) => Project, opts?: { replan?: boolean }): void => {
      setHistory((h) => {
        const next = rederive(fn(h.present.project), opts?.replan === true);
        onProjectRef.current(next);
        return createHistory({ project: next, selection: h.present.selection });
      });
    },
    [rederive],
  );

  /**
   * Selecting is not an undo step.
   *
   * It replaces `present.selection` in place rather than pushing, because
   * pushing would make every click on a segment its own history entry and
   * Ctrl+Z would walk back through past selections instead of undoing edits.
   * Undo still restores the selection an edit was made with: `step` captures
   * `selection` into the entry it pushes, so selection rides inside snapshots
   * rather than being independently undoable.
   */
  const select = useCallback((selection: Selection): void => {
    setHistory((h) => ({ ...h, present: { ...h.present, selection } }));
  }, []);

  const undo = useCallback((): void => {
    setHistory((h) => {
      const next = undoOf(h);
      if (next !== h) onProjectRef.current(next.present.project);
      return next;
    });
  }, []);

  const redo = useCallback((): void => {
    setHistory((h) => {
      const next = redoOf(h);
      if (next !== h) onProjectRef.current(next.present.project);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      project: history.present.project,
      selection: history.present.selection,
      canUndo: canUndoOf(history),
      canRedo: canRedoOf(history),
      apply,
      applyTransient,
      commitGesture,
      reset,
      select,
      undo,
      redo,
    }),
    [history, apply, applyTransient, commitGesture, reset, select, undo, redo],
  );
}
