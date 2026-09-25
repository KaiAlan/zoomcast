import { useEffect, useMemo, useRef, useState } from "react";
import type { OpenedBundle } from "../../shared/api";
import { buildCursorPath, cursorAt, smoothingToHalfLife } from "../../shared/cursor/path";
import { RIPPLE_DURATION_MS, ripplesAt } from "../../shared/cursor/ripples";
import { outputDurationMs, outputToSource, sourceSpanToOutput } from "../../shared/project/timeline";
import { outputSizeFor } from "../../shared/style/aspect";
import { bundleAssetUrl } from "../media/assetUrl";
import type { Project } from "../../shared/project/types";
import {
  createCutFromDrag,
  cutDragToSource,
  cutResizeToSource,
  deleteCut,
  deleteSegment,
  resetSegment,
  segmentDragToSource,
  segmentResizeToSource,
  setSegmentCamera,
  setSegmentDepth,
} from "../../shared/project/edits";
import { pixelParityZoom } from "../../shared/zoom/geometry";
import { zoomAt } from "../../shared/zoom/interpolate";
import { followPath } from "../../shared/zoom/camera";
import { type DeriveContext } from "../../shared/zoom/derive";
import type { PlanContext, ZoomConfig, ZoomSegment } from "../../shared/zoom/types";
import { Renderer } from "../gl/Renderer";
import { exportClip } from "../media/exportClip";
import { PreviewPlayer } from "../media/PreviewPlayer";
import { VideoElementSource } from "../media/VideoElementSource";
import { DecodedFrameSource } from "../media/VideoSource";
import { BLUR_GRID_MS, blurForCamera } from "../../shared/style/motionBlur";
import { createMediaClock } from "../media/mediaClock";
import { Inspector } from "./Inspector";
import { SegmentPopover } from "./SegmentPopover";
import { Timeline } from "./Timeline";
import { msToPct } from "./timeline/geometry";
import { useProjectHistory } from "./useProjectHistory";

/** How often the numeric readout catches up with the playhead. */
const READOUT_INTERVAL_MS = 100;

/**
 * How far ahead of the playhead to warm the decoder, in output time. One frame
 * at 60fps: far enough that the next draw finds its frame decoded, near enough
 * that a seek does not throw the work away.
 */
const PREFETCH_LOOKAHEAD_MS = 1000 / 60;

const button: React.CSSProperties = {
  background: "#1c2029",
  color: "#e6e6e6",
  border: "1px solid #2a2e38",
  borderRadius: 5,
  padding: "6px 14px",
  cursor: "pointer",
  fontSize: 13,
};

/**
 * True when a keydown's target is a text/number input, a textarea, or
 * anything contenteditable -- the one definition every guarded branch of the
 * keydown effect below shares, so a destructive or overriding shortcut
 * (Delete/Backspace, Ctrl/Cmd+Z) can never fire while the user is typing in
 * one of the Inspector's or the style panel's fields, and so that guard can
 * never quietly drift out of sync with the Space handler's own.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    el !== null &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
  );
}

export function Editor({
  bundle,
  onBack,
}: {
  bundle: OpenedBundle;
  onBack: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const sourceRef = useRef<VideoElementSource | null>(null);
  const playerRef = useRef<PreviewPlayer | null>(null);
  /** Wraps `<Timeline>` so `SegmentPopover` can tell "inside the timeline" from "outside" for its dismiss-on-outside-pointerdown. */
  const timelineWrapRef = useRef<HTMLDivElement | null>(null);

  const { manifest } = bundle;

  /**
   * The camera's own path: the same function the cursor uses, at a
   * camera-scale half-life. Built once per take — it is a pure function of
   * telemetry, which is what keeps preview and export showing one camera.
   */
  const cameraPath = useMemo(() => followPath(bundle.telemetry), [bundle.telemetry]);

  /** Everything replanFrom/deriveKeyframes need that does not live on the project. */
  const deriveCtx = useMemo<DeriveContext>(
    () => ({
      telemetry: bundle.telemetry,
      cameraPath,
      source: { w: manifest.video.width, h: manifest.video.height },
      durationMs: manifest.durationMs,
    }),
    [bundle.telemetry, cameraPath, manifest.video.width, manifest.video.height, manifest.durationMs],
  );

  /**
   * The only thing in this file that changes the project.
   *
   * Every handler below goes through `edit`, and the callback here is the one
   * place `live.current`'s project is patched. It used to be patched by hand at
   * each `setProject`, which is how addCut ended up patching the ref and never
   * redrawing at all.
   *
   * `live` is declared further down, because it also carries values derived
   * from the project this hook owns. The forward reference is safe: this
   * callback is only ever invoked from an event handler or an effect, long
   * after the binding exists.
   */
  const edit = useProjectHistory(bundle.project, deriveCtx, (p) => {
    live.current = { ...live.current, project: p };
  });
  const project = edit.project;

  /** The Inspector still keys its lookup off a bare segment id; `Selection` is the wider type. */
  const selectedSegmentId = edit.selection?.kind === "segment" ? edit.selection.id : null;

  const [playheadMs, setPlayheadMs] = useState(0);
  /** The marker element, moved directly during playback. */
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const readoutAtRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("loading…");
  const [exporting, setExporting] = useState<string | null>(null);

  // Resolved by lookup rather than held as state. Every re-plan rebuilds the
  // segments, and a shot whose cluster the new plan no longer produces is
  // gone — a stored object would go stale, where a missing id simply shows the
  // empty state.
  const selectedSegment =
    project.zoom.segments.find((s) => s.id === selectedSegmentId) ?? null;

  /**
   * Where the selected segment's region sits, in the same output timebase
   * `ZoomLane` draws it in. Null when there is no selection, or when the
   * segment's span does not survive the cuts (`sourceSpanToOutput` returns
   * null for a span a cut has swallowed entirely) -- in both cases the
   * popover has nothing to anchor to and stays closed.
   */
  const selectedSegmentSpan =
    selectedSegment === null
      ? null
      : sourceSpanToOutput(selectedSegment.startMs, selectedSegment.endMs, manifest.durationMs, project.cuts);

  const ctx: PlanContext = useMemo(
    () => ({
      source: { w: manifest.video.width, h: manifest.video.height },
      output: outputSizeFor(project.output, {
        w: manifest.video.width,
        h: manifest.video.height,
      }),
      paddingFactor: project.style.paddingFactor,
      durationMs: manifest.durationMs,
    }),
    [manifest, project.output, project.style.paddingFactor],
  );

  const ceiling = useMemo(
    () => pixelParityZoom(ctx.source, ctx.output, ctx.paddingFactor),
    [ctx],
  );

  const outDuration = outputDurationMs(manifest.durationMs, project.cuts);

  // Built once per bundle: pure and cheap, but rebuilding per frame would be
  // wasteful. Depends on smoothing because that changes the resulting path.
  const cursorPath = useMemo(
    () =>
      buildCursorPath(bundle.telemetry, {
        halfLifeMs: smoothingToHalfLife(project.style.cursor.smoothing),
        sampleHz: 120,
      }),
    [bundle.telemetry, project.style.cursor.smoothing],
  );

  // ripplesAt only ever looks at "down" events, but the full telemetry stream
  // is dominated by "move" samples. Filtering once here keeps the per-frame
  // scan (in both preview and export) bounded by click count, not move count.
  const clicks = useMemo(
    () => bundle.telemetry.filter((e) => e.k === "down"),
    [bundle.telemetry],
  );

  // Resolved once here so both render paths use the same URL. Undefined unless
  // the style actually selects an image.
  // Gated on kind, not just on imageFile: Background is a flat record that
  // remembers every kind's settings, so a project that once used an image
  // keeps its imageFile after switching to a gradient. Resolving it anyway
  // made export await a decode of an image it was never going to draw.
  const backgroundImageUrl = useMemo(
    () =>
      project.style.background.kind === "image"
        ? bundleAssetUrl(bundle.dir, project.style.background.imageFile)
        : undefined,
    [bundle.dir, project.style.background.kind, project.style.background.imageFile],
  );

  // Latest values for the render loop, which must not be re-created per frame.
  const live = useRef({ project, ctx, cursorPath, clicks, backgroundImageUrl });
  live.current = { project, ctx, cursorPath, clicks, backgroundImageUrl };

  // Stable across history changes, unlike `edit` itself, so the mount effect
  // below can depend on it without being torn down on every edit.
  const { reset: resetProject } = edit;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    let disposed = false;
    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;

    const renderAt = async (tOutputMs: number): Promise<void> => {
      const source = sourceRef.current;
      if (source === null || disposed) return;

      const { project: p, ctx: c, cursorPath, clicks, backgroundImageUrl } = live.current;
      const tSource = outputToSource(tOutputMs, manifest.durationMs, p.cuts);
      const sample = cursorAt(cursorPath, tSource);

      const frame = await source.frameAt(tSource);
      try {
        // Sampled on the fixed grid, never on real elapsed time: this must be
        // the same value the export computes for the same source time.
        const zoomNow = zoomAt(p.zoom.keyframes, tSource);
        const zoomPrev = zoomAt(p.zoom.keyframes, tSource - BLUR_GRID_MS);

        renderer.drawFrame({
          screen: frame.image,
          zoom: zoomNow,
          motionBlur: blurForCamera(zoomPrev, zoomNow, c.output, p.style.motionBlurAmount),
          style: p.style,
          outputSize: c.output,
          sourceSize: c.source,
          cursor: sample === null ? undefined : { sample, style: p.style.cursor },
          ripples: ripplesAt(clicks, tSource, RIPPLE_DURATION_MS),
          backgroundImageUrl,
        });
      } finally {
        frame.release();
      }
    };

    /**
     * The playhead's position is a style write, not React state.
     *
     * onTick fires every animation frame; routing that through setState
     * re-rendered the whole editor 60 times a second, and the tree it
     * re-rendered includes the inspector and the timeline's keyframe blocks.
     * The marker is the only thing that has to move at that rate, so it moves
     * directly and React hears about the playhead ten times a second, for the
     * numeric readout alone.
     */
    const positionPlayhead = (t: number): void => {
      const el = playheadElRef.current;
      if (el === null) return;

      const total = outputDurationMs(manifest.durationMs, live.current.project.cuts);
      el.style.left = `${total === 0 ? 0 : (t / total) * 100}%`;
    };

    // The playhead during playback, taken from the video element itself and
    // converted to output time. See createMediaClock.
    const clock = createMediaClock(
      () => sourceRef.current?.el ?? null,
      () => ({ durationMs: manifest.durationMs, cuts: live.current.project.cuts }),
    );

    const player = new PreviewPlayer(
      renderAt,
      () => outputDurationMs(manifest.durationMs, live.current.project.cuts),
      (t, isPlaying) => {
        positionPlayhead(t);

        const now = performance.now();
        // Paused, seeking and stopping all update immediately: a readout that
        // lags by up to 100ms is fine while playing and wrong when still.
        if (!isPlaying || now - readoutAtRef.current >= READOUT_INTERVAL_MS) {
          readoutAtRef.current = now;
          setPlayheadMs(t);
        }

        // Identical values bail out of re-rendering, so this is free per tick.
        setPlaying(isPlaying);
      },
      (tOutputMs) => {
        const source = sourceRef.current;
        if (source === null) return;

        // One frame of lookahead, in source time. See VideoSource.prefetch.
        const ahead = tOutputMs + PREFETCH_LOOKAHEAD_MS;
        void source.prefetch(
          outputToSource(ahead, manifest.durationMs, live.current.project.cuts),
        );
      },
      clock,
    );
    playerRef.current = player;

    void (async () => {
      try {
        const source = await VideoElementSource.open(bundle.media.screen);
        if (disposed) {
          source.close();
          return;
        }

        sourceRef.current = source;

        // The plan the bundle opens with. `reset` and not `apply`: this is not
        // an edit the user made, and pushing it would leave the editor with an
        // undo step back to a project that has no segments in it.
        resetProject((p) => p, { replan: true });

        // The capture rate, not the output rate, and labelled as such: it is
        // routinely well under what was requested (gdigrab reaches about 28fps
        // at 1080p on this machine) and cannot be fixed in software, so the
        // one thing it must not do is get mistaken for a rendering fault.
        // manifest.video.fps is the achieved rate — checked against
        // `ffprobe -count_frames` on every take on disk, where it agrees
        // exactly.
        setStatus(
          `${manifest.video.width}×${manifest.video.height} · captured at ` +
            `${manifest.video.fps.toFixed(1)}fps`,
        );

        /**
         * Export decodes through DecodedFrameSource, never through the
         * preview's <video>.
         *
         * A media element seeks asynchronously and lands on the nearest
         * decodable frame, so "give me exactly the frame at t" is not a
         * question it can answer -- and that is the only question export asks.
         * Opened per export rather than held for the session: exports are
         * infrequent and a live decoder holds frame-pool memory.
         */
        const withExportSource = async <T,>(
          fn: (exportSource: DecodedFrameSource) => Promise<T>,
        ): Promise<T> => {
          const exportSource = await DecodedFrameSource.open(bundle.media.screen);
          try {
            return await fn(exportSource);
          } finally {
            exportSource.close();
          }
        };

        // Test hooks for tools/verify-parity.ts. renderAt is awaited directly
        // rather than going through the player, so a screenshot is guaranteed
        // to be taken after the frame has actually been drawn.
        window.__zc = {
          renderAt: async (tOutputMs: number) => {
            await renderAt(tOutputMs);
            return canvas.toDataURL("image/png");
          },
          exportTo: async (outFile: string) => {
            await withExportSource((exportSource) =>
              exportClip({
                manifest,
                project: live.current.project,
                cursorPath: live.current.cursorPath,
                clicks: live.current.clicks,
                backgroundImageUrl: live.current.backgroundImageUrl,
                mediaDir: bundle.dir.replace(/\\/g, "/"),
                renderer,
                source: exportSource,
                outFile,
                encoder: "libx264",
                onProgress: () => undefined,
              }),
            );
          },
          /**
           * What the preview actually achieves, measured rather than argued.
           *
           * Times completed draws, not rAF ticks: a tick that arrives while a
           * render is in flight is dropped by PreviewPlayer, so counting ticks
           * would report a healthy 60fps while the picture updated ten times a
           * second. `droppedTicks` is the gap between the two.
           */
          benchPreview: async (ms: number) => {
            const drawn: number[] = [];
            let ticks = 0;

            const player = playerRef.current;
            if (player === null) throw new Error("no player");

            player.seek(0);
            const t0 = performance.now();

            // Sample the drawn frame by watching the canvas through the same
            // rAF clock the player runs on.
            let stop = false;
            const watch = (): void => {
              if (stop) return;
              ticks += 1;
              requestAnimationFrame(watch);
            };
            requestAnimationFrame(watch);

            const onDraw = (): void => {
              drawn.push(performance.now() - t0);
            };
            player.onDrawn = onDraw;
            player.play();

            await new Promise<void>((r) => setTimeout(r, ms));
            player.pause();
            stop = true;
            player.onDrawn = undefined;

            const seconds = (performance.now() - t0) / 1000;
            const deltas = drawn.slice(1).map((t, i) => t - (drawn[i] ?? 0));
            deltas.sort((a, b) => a - b);
            const pick = (q: number): number =>
              deltas.length === 0 ? 0 : (deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * q))] ?? 0);

            return {
              frames: drawn.length,
              seconds,
              fps: drawn.length / seconds,
              p50DeltaMs: pick(0.5),
              p95DeltaMs: pick(0.95),
              worstDeltaMs: deltas[deltas.length - 1] ?? 0,
              droppedTicks: ticks - drawn.length,
            };
          },
        };

        // ?seek=<ms> lets a screenshot land on a chosen playhead position.
        const seek = new URLSearchParams(window.location.search).get("seek");
        player.seek(seek === null ? 0 : Number(seek));
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      player.dispose();
      sourceRef.current?.close();
      sourceRef.current = null;
      renderer.dispose();
      rendererRef.current = null;
    };
    // `resetProject` is stable, so this still tears down only when the bundle
    // changes. `deriveCtx` has left the list because the load-time re-plan now
    // reads its context from inside the hook.
  }, [bundle, manifest, resetProject]);

  // Latest `edit` for the keydown effect below. `edit` changes identity on
  // every history change (undo, redo, select, any apply), so closing over it
  // directly would force the effect to re-attach its listener on every one of
  // those -- a dependency list that is technically correct but re-runs
  // constantly. Reading through a ref updated every render keeps the
  // listener attached once, the same idiom `useProjectHistory` itself uses
  // for `ctx` and `onProject`.
  const editRef = useRef(edit);
  editRef.current = edit;

  // Space toggles playback; Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes;
  // Delete/Backspace removes the selection; Escape clears it. preventDefault
  // on Space matters twice over: it stops the page scrolling, and it stops
  // Space from re-activating whichever button was last clicked, which would
  // otherwise fight this handler.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Shared with the Space branch below -- Delete/Backspace is
      // destructive and Ctrl/Cmd+Z overrides whatever native undo a text
      // field has, so both must yield to typing exactly as Space already
      // does. One shared check keeps the two definitions from drifting apart.
      const typing = isTypingTarget(event.target);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (typing) return;
        event.preventDefault();
        if (event.shiftKey) editRef.current.redo();
        else editRef.current.undo();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (typing) return;
        const s = editRef.current.selection;
        if (s === null) return;
        event.preventDefault();
        editRef.current.apply((p) =>
          s.kind === "segment" ? deleteSegment(p, s.id) : deleteCut(p, s.id),
        );
        editRef.current.select(null);
        return;
      }

      if (event.key === "Escape") {
        // Deliberately NOT guarded on `typing`: clearing `edit.selection`
        // has no effect on a field's contents or focus, unlike Delete and
        // Ctrl+Z it is not destructive and overrides nothing, and it also
        // clears whatever `SegmentPopover` is showing -- it unmounts once
        // `edit.selection` resolves to null, on the next render. That
        // component's own Escape listener calls the same `select(null)` --
        // redundant on a keystroke that already had a popover open, but not
        // a race, since both converge on the same call rather than disagreeing.
        editRef.current.select(null);
        return;
      }

      if (event.code !== "Space" || event.repeat) return;
      if (typing) return;

      event.preventDefault();
      playerRef.current?.toggle();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * The one way an edit reaches a paused preview.
   *
   * PreviewPlayer draws on play, seek and toggle; nothing watches `project`.
   * This file used to answer "how does an edit redraw?" three different ways —
   * this effect for style and output, a functional setProject plus a
   * synchronous seek for the zoom config, and addCut, which patched
   * `live.current` and never redrew at all, so adding a cut left a stale frame
   * on screen until the next scrub.
   *
   * It is an effect and not a seek inside each handler because `cursorPath`
   * and `ctx` are useMemos on `project`: only the re-render rebuilds them, so a
   * synchronous seek redraws with the old ones. The synchronous version worked
   * by relying on React's eager-state optimisation, which is an optimisation
   * and not a contract.
   *
   * It watches the whole project on purpose. Every field reaches the renderer
   * the same way, and a dependency list that enumerates them is a list someone
   * will forget to extend — which is exactly how addCut's bug happened.
   * Redrawing one frame more often than strictly needed costs a decode that is
   * almost always a cache hit.
   */
  useEffect(() => {
    playerRef.current?.seek(playerRef.current.playheadMs);
  }, [project]);

  /** A pacing dial is a global change: it must regenerate unclaimed shots. */
  const onConfigChange = (config: ZoomConfig): void => {
    edit.apply((p) => ({ ...p, zoom: { ...p.zoom, config } }), { replan: true });
  };

  /**
   * Output changes must re-plan, not just re-render.
   *
   * The frame comes from the output size, so a segment's centre and its
   * clamp belong to the shape it was planned against. Changing the aspect with
   * a bare setProject updated the context and the readout while leaving the
   * keyframes derived for the old frame.
   *
   * Note the reason is no longer the ceiling: since 2026-09-07 that is
   * `cfg.maxZoom` and independent of output size — the camera samples
   * 1/scale of the source at any aspect. It is the frame, and therefore the
   * clamp, that still moves. paddingFactor feeds the same frame if a control
   * for it ever lands.
   */
  const onOutputChange = (output: Project["output"]): void => {
    edit.apply((p) => ({ ...p, output }), { replan: true });
  };

  /**
   * Switch one shot's camera.
   *
   * It re-plans afterwards rather than only patching the segment, because
   * keyframes are derived: a follow shot emits a sample every 100ms where a
   * fixed one emits two keyframes, so nothing would change on screen
   * otherwise. `replanSegments` carries the new position across that re-plan
   * by id, which is also what makes the choice survive every later re-plan.
   */
  const onSegmentCameraChange = (id: string, position: ZoomSegment["position"]): void => {
    edit.apply((p) => setSegmentCamera(p, id, position), { replan: true });
  };

  /** Set one shot's depth from the popover. Pins the segment (see `setSegmentDepth`). */
  const onSegmentDepthChange = (id: string, depth: number): void => {
    edit.apply((p) => setSegmentDepth(p, id, depth));
  };

  /** Delete the shot from the popover and drop the now-stale selection. */
  const onSegmentDelete = (id: string): void => {
    edit.apply((p) => deleteSegment(p, id));
    edit.select(null);
  };

  /**
   * Unpin, then re-plan: the shot rejoins the planner. This is what makes
   * pinning recoverable, and pinning is a one-way door without it.
   */
  const onSegmentReset = (id: string): void => {
    edit.apply((p) => resetSegment(p, id), { replan: true });
  };

  /**
   * Drag a segment to an absolute output-ms target for its start edge.
   *
   * `targetStartOutputMs` is absolute, not a delta: `applyTransient` extends
   * an open gesture by replacing `present` wholesale on every intermediate
   * step (see `useProjectHistory.step` / `history.beginOrExtend`), so a
   * delta-from-drag-start would be re-applied on top of an already-moved
   * project and compound. An absolute target makes this idempotent --
   * re-applying it to an unchanged project is a no-op, and a segment
   * clamped against a neighbour has its next step measured fresh from the
   * clamped position toward the same target rather than banking the
   * rejected movement.
   *
   * The output-ms-to-source-delta glue lives in `segmentDragToSource`
   * (edits.ts), pure and unit-tested there, rather than as a closure here.
   */
  const onSegmentMove = (id: string, targetStartOutputMs: number): void => {
    edit.applyTransient((p) => segmentDragToSource(p, id, targetStartOutputMs, manifest.durationMs));
  };

  /**
   * Resize one edge to an absolute output-ms target. Idempotent for the same
   * reason as `onSegmentMove` above. The glue lives in `segmentResizeToSource`
   * (edits.ts) -- see its doc comment for the §7 cut-crossing behaviour.
   */
  const onSegmentResize = (id: string, edge: "start" | "end", tOutputMs: number): void => {
    edit.applyTransient((p) => segmentResizeToSource(p, id, edge, tOutputMs, manifest.durationMs));
  };

  /**
   * Author a cut by dragging across empty space on the cut lane.
   *
   * One discrete edit, so it goes through `apply` and not the transient drag
   * path: nothing is recorded until the pointer comes up, and the result is a
   * single undo step. `createCutFromDrag` holds the `MIN_CUT_MS` floor, which
   * `addCut` does not enforce and nothing else now guards.
   */
  const onCreateCut = (aFrac: number, bFrac: number): void => {
    edit.apply((p) =>
      createCutFromDrag(p, crypto.randomUUID(), aFrac, bFrac, manifest.durationMs),
    );
  };

  /**
   * Drag a cut's seam to an absolute lane fraction.
   *
   * A fraction, where the segment callbacks take output ms, because a cut edit
   * moves the output timebase: growing a cut shortens `outDuration`, so the
   * same pointer pixel is a different output ms from one pointermove to the
   * next and output ms stops being an absolute coordinate mid-gesture. The
   * pointer's position across the lane does not stop being one. The mapping
   * lives in `cutDragToSource` / `cutResizeToSource` (edits.ts), pure and
   * unit-tested there; read `cutResizeToSource` for why a resize has to solve
   * for the post-rescale geometry rather than convert through it.
   */
  const onCutMove = (id: string, targetStartFrac: number): void => {
    edit.applyTransient((p) => cutDragToSource(p, id, targetStartFrac, manifest.durationMs));
  };

  /** Resize one edge to an absolute lane fraction. See `onCutMove`. */
  const onCutResize = (id: string, edge: "start" | "end", tFrac: number): void => {
    edit.applyTransient((p) => cutResizeToSource(p, id, edge, tFrac, manifest.durationMs));
  };

  const runExport = (): void => {
    const renderer = rendererRef.current;
    // Only a liveness check: export does not draw from the preview's source.
    if (renderer === null || sourceRef.current === null || exporting !== null) return;

    void (async () => {
      const target = await window.zoomcast.pickExportTarget(`${manifest.id}.mp4`);
      if (target === null) return;

      // Persist what this export is being made from. saveProject already
      // existed but was wired only to the manual save button, so the bundle
      // for the take that exported badly on 2026-09-05 has no project.json at
      // all and the settings that produced the file are unrecoverable. An
      // export is exactly the moment the state is worth keeping.
      await window.zoomcast.saveProject(bundle.dir, project);

      playerRef.current?.pause();
      setExporting("starting…");

      // Export decodes through DecodedFrameSource, never the preview's
      // <video>: a media element seeks to the nearest decodable frame, and
      // export needs exactly the frame at t. Opened per export and closed
      // after -- a live decoder holds frame-pool memory.
      const exportSource = await DecodedFrameSource.open(bundle.media.screen);

      try {
        await exportClip({
          manifest,
          project,
          cursorPath: live.current.cursorPath,
          clicks: live.current.clicks,
          backgroundImageUrl: live.current.backgroundImageUrl,
          mediaDir: bundle.dir.replace(/\\/g, "/"),
          renderer,
          source: exportSource,
          outFile: target,
          encoder: "h264_amf",
          onProgress: ({ done, total }) =>
            setExporting(`${Math.round((done / total) * 100)}%`),
        });

        setExporting(null);
        setStatus(`exported to ${target}`);
      } catch (err) {
        setExporting(null);
        setStatus(err instanceof Error ? err.message : String(err));
      } finally {
        exportSource.close();
        // The export drew at output size; put the preview back where it was.
        playerRef.current?.seek(playerRef.current.playheadMs);
      }
    })();
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0d0e11", color: "#e6e6e6" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 20, gap: 14, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={onBack}
            title="Back to recordings"
            style={{
              ...button,
              padding: "4px 11px",
              lineHeight: 1.2,
            }}
          >
            ←
          </button>
          <span style={{ fontSize: 15 }}>{manifest.id}</span>
          <span style={{ fontSize: 12, opacity: 0.5 }}>{status}</span>
          <span style={{ fontSize: 12, opacity: 0.35, marginLeft: "auto" }}>
            space to play · drag the timeline to scrub
          </span>
        </div>

        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            flex: 1,
            minHeight: 0,
            objectFit: "contain",
            borderRadius: 6,
            background: "#000",
          }}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={button} onClick={() => playerRef.current?.toggle()}>
            {playing ? "pause" : "play"}
          </button>
          <button type="button" style={button} onClick={() => playerRef.current?.seek(0)}>
            start
          </button>
          <button
            type="button"
            style={button}
            onClick={() => void window.zoomcast.saveProject(bundle.dir, project)}
          >
            save
          </button>
          <button
            type="button"
            style={{ ...button, opacity: exporting === null ? 1 : 0.5 }}
            disabled={exporting !== null}
            onClick={runExport}
          >
            {exporting === null ? "export…" : `exporting ${exporting}`}
          </button>
        </div>

        <div ref={timelineWrapRef} style={{ position: "relative" }}>
          <Timeline
            durationMs={manifest.durationMs}
            outputDurationMs={outDuration}
            cuts={project.cuts}
            keyframes={project.zoom.keyframes}
            segments={project.zoom.segments}
            selection={edit.selection}
            onSelect={edit.select}
            playheadMs={playheadMs}
            playheadRef={playheadElRef}
            pixelParityZoom={ceiling}
            maxZoom={project.zoom.config.maxZoom}
            onSeek={(t) => playerRef.current?.seek(t)}
            onSegmentMove={onSegmentMove}
            onSegmentResize={onSegmentResize}
            onSegmentDragCommit={edit.commitGesture}
            onCreateCut={onCreateCut}
            onCutMove={onCutMove}
            onCutResize={onCutResize}
            onCutDragCommit={edit.commitGesture}
          />

          {selectedSegment !== null && selectedSegmentSpan !== null && outDuration > 0 && (
            <SegmentPopover
              segment={selectedSegment}
              maxZoom={project.zoom.config.maxZoom}
              leftPct={msToPct(selectedSegmentSpan.startMs, outDuration)}
              timelineRef={timelineWrapRef}
              onDepthChange={onSegmentDepthChange}
              onCameraChange={onSegmentCameraChange}
              onDelete={onSegmentDelete}
              onReset={onSegmentReset}
              onDismiss={() => edit.select(null)}
            />
          )}
        </div>
      </div>

      <div
        style={{
          width: 280,
          borderLeft: "1px solid #23262e",
          padding: 20,
          overflowY: "auto",
        }}
      >
        <Inspector
          config={project.zoom.config}
          onChange={onConfigChange}
          cursor={project.style.cursor}
          onCursorChange={(cursor) =>
            edit.apply((p) => ({ ...p, style: { ...p.style, cursor } }))
          }
          style={project.style}
          output={project.output}
          dir={bundle.dir}
          onStyleChange={(style) => edit.apply((p) => ({ ...p, style }))}
          onOutputChange={onOutputChange}
        />
      </div>
    </div>
  );
}
