import { captionAt, outputCaptions } from "../../shared/captions/timing";
import { CaptionsPanel } from "./CaptionsPanel";
import { cursorFrameAt } from "../../shared/cursor/effects";
import { Icon, type IconName } from "./Icon";
import { webcamTime } from "../../shared/webcam/layout";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OpenedBundle } from "../../shared/api";
import { buildCursorPath, smoothingToHalfLife } from "../../shared/cursor/path";
import { RIPPLE_DURATION_MS, ripplesAt } from "../../shared/cursor/ripples";
import { planExportFrames } from "../../shared/export/exportPlan";
import { clipsFor, outputDurationMs, outputToSource, sourceSpanToOutput } from "../../shared/project/timeline";
import { outputSizeFor } from "../../shared/style/aspect";
import { bundleAssetUrl } from "../media/assetUrl";
import type { AspectChoice, Project } from "../../shared/project/types";
import {
  deleteCut,
  deleteSegment,
  segmentDragToSource,
  segmentResizeToSource,
  setSegmentCamera,
  setSegmentDepth,
} from "../../shared/project/edits";
import { pixelParityZoom } from "../../shared/zoom/geometry";
import { zoomAt } from "../../shared/zoom/interpolate";
import { followPath } from "../../shared/zoom/camera";
import { resetShotToAuto, type DeriveContext } from "../../shared/zoom/derive";
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
import { Timeline, TimelineFooter } from "./Timeline";
import { addZoomAt, deleteClip, reorderClip, splitClip, splitZoom } from "../../shared/project/clips";
import { useProjectHistory } from "./useProjectHistory";

/** How often the numeric readout catches up with the playhead. */
const READOUT_INTERVAL_MS = 100;

/**
 * How far ahead of the playhead to warm the decoder, in output time. One frame
 * at 60fps: far enough that the next draw finds its frame decoded, near enough
 * that a seek does not throw the work away.
 */
const PREFETCH_LOOKAHEAD_MS = 1000 / 60;

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
  const [activeSection, setActiveSection] = useState("Appearance");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const webcamRef = useRef<VideoElementSource | DecodedFrameSource | null>(null);
  const sourceRef = useRef<VideoElementSource | null>(null);
  const playerRef = useRef<PreviewPlayer | null>(null);
  /** The popup measures its selected region inside this timeline wrapper. */
  const [popoverId, setPopoverId] = useState<string | null>(null);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const timelineViewportRef = useRef<HTMLDivElement | null>(null);
  const splitTimelineRef = useRef<() => void>(() => undefined);
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

  useEffect(() => window.zoomcast.updates.onBeforeInstall(
    () => window.zoomcast.saveProject(bundle.dir, project),
  ), [bundle.dir, project]);

  /** The Inspector still keys its lookup off a bare segment id; `Selection` is the wider type. */
  const selectedSegmentId = edit.selection?.kind === "segment" ? edit.selection.id : null;

  const [playheadMs, setPlayheadMs] = useState(0);
  /** The marker element, moved directly during playback. */
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const readoutAtRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("loading…");
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const saveProject = async (): Promise<void> => {
    if (saveInFlight.current || sourceRef.current === null) return;
    saveInFlight.current = true;
    setSaving(true);
    setStatus("Saving project…");
    const snapshot = live.current.project;
    try {
      await window.zoomcast.saveProject(bundle.dir, snapshot);
      setStatus(live.current.project === snapshot ? "Project saved" : "Project saved. New edits are not saved yet.");
    } catch (error) {
      setStatus(`Could not save project: ${error instanceof Error ? error.message : String(error)}. Try saving again.`);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };
  const saveProjectRef = useRef(saveProject);
  saveProjectRef.current = saveProject;
  const [exporting, setExporting] = useState<string | null>(null);
  const runExportRef = useRef<(target?: string) => Promise<void>>(async () => undefined);

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
      : sourceSpanToOutput(selectedSegment.startMs, selectedSegment.endMs, manifest.durationMs, project.cuts, project.clips);

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

  const outDuration = outputDurationMs(manifest.durationMs, project.cuts, project.clips);
  const baseClips = useMemo(() => clipsFor(manifest.durationMs, project.cuts, project.clips), [manifest.durationMs, project.cuts, project.clips]);

  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const next = Math.max(1, Math.min(4, timelineZoom + (event.deltaY < 0 ? 0.25 : -0.25)));
        const x = event.clientX - viewport.getBoundingClientRect().left - 16;
        const width = viewport.clientWidth - 32;
        const fraction = (x + viewport.scrollLeft) / (width * timelineZoom);
        setTimelineZoom(next);
        requestAnimationFrame(() => { viewport.scrollLeft = fraction * width * next - x; });
      } else if (event.shiftKey) {
        event.preventDefault();
        viewport.scrollLeft += event.deltaY || event.deltaX;
      }
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [timelineZoom]);

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
  const captionCues = useMemo(() => outputCaptions(project, manifest.durationMs), [project, manifest.durationMs]);
  const live = useRef({ project, ctx, cursorPath, clicks, backgroundImageUrl, captionCues });
  live.current = { project, ctx, cursorPath, clicks, backgroundImageUrl, captionCues };

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
      const tSource = outputToSource(tOutputMs, manifest.durationMs, p.cuts, p.clips);
      const cursorFrame = cursorFrameAt(cursorPath, clicks, tSource, p.style.cursor, { durationMs: manifest.durationMs, cuts: p.cuts, clips: p.clips, outputMs: tOutputMs, fps: p.output.fps });

      const frame = await source.frameAt(tSource);
      let cameraFrame: Awaited<ReturnType<VideoElementSource["frameAt"]>> | undefined;
      try {
        const camera = webcamRef.current;
        const cameraMs = camera && manifest.webcam && p.webcam.visible
          ? webcamTime(tSource, manifest.webcam.startOffsetMs, camera.durationMs) : null;
        if (camera && cameraMs !== null) {
          try {
            cameraFrame = await camera.frameAt(cameraMs);
          } catch (err) {
            if (!(camera instanceof VideoElementSource) || !bundle.media.webcam) throw err;
            // Some variable-rate VP9 camera takes fail in Chromium's media
            // pipeline after seeking. WebCodecs still decodes those frames.
            const fallback = await DecodedFrameSource.open(bundle.media.webcam);
            camera.close();
            if (disposed) { fallback.close(); return; }
            webcamRef.current = fallback;
            cameraFrame = await fallback.frameAt(cameraMs);
          }
          if (webcamRef.current instanceof VideoElementSource) {
            if (!source.el.paused && webcamRef.current.el.paused) void webcamRef.current.el.play().catch(() => undefined);
            if (source.el.paused) webcamRef.current.el.pause();
          }
        } else if (camera instanceof VideoElementSource) camera.el.pause();
        // Sampled on the fixed grid, never on real elapsed time: this must be
        // the same value the export computes for the same source time.
        const zoomNow = zoomAt(p.zoom.keyframes, tSource);
        const zoomPrev = zoomAt(p.zoom.keyframes, tSource - BLUR_GRID_MS);

        renderer.drawFrame({
          screen: frame.image,
          caption: p.captions ? { text: captionAt(live.current.captionCues, tOutputMs) ?? "", style: p.captions.style } : undefined,
          webcam: cameraFrame && webcamRef.current ? { image: cameraFrame.image, sourceSize: { w: webcamRef.current.width, h: webcamRef.current.height }, config: p.webcam } : undefined,
          zoom: zoomNow,
          motionBlur: blurForCamera(zoomPrev, zoomNow, c.output, p.style.motionBlurAmount),
          style: p.style,
          outputSize: c.output,
          sourceSize: c.source,
          cursor: cursorFrame === null ? undefined : { ...cursorFrame, style: p.style.cursor },
          ripples: ripplesAt(clicks, tSource, RIPPLE_DURATION_MS),
          backgroundImageUrl,
        });
      } finally {
        cameraFrame?.release();
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

      const total = outputDurationMs(manifest.durationMs, live.current.project.cuts, live.current.project.clips);
      el.style.left = `${total === 0 ? 0 : (t / total) * 100}%`;
    };

    // The playhead during playback, taken from the video element itself and
    // converted to output time. See createMediaClock.
    const clock = createMediaClock(
      () => sourceRef.current?.el ?? null,
      () => ({ durationMs: manifest.durationMs, cuts: live.current.project.cuts, clips: live.current.project.clips }),
    );

    const player = new PreviewPlayer(
      renderAt,
      () => outputDurationMs(manifest.durationMs, live.current.project.cuts, live.current.project.clips),
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
          outputToSource(ahead, manifest.durationMs, live.current.project.cuts, live.current.project.clips),
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
        source.el.addEventListener("pause", () => {
          if (webcamRef.current instanceof VideoElementSource) webcamRef.current.el.pause();
        });
        let cameraWarning = "";
        if (bundle.media.webcam) {
          try {
            const camera = await VideoElementSource.open(bundle.media.webcam);
            if (disposed) { camera.close(); return; }
            webcamRef.current = camera;
          } catch (err) {
            cameraWarning = ` · webcam unavailable: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        // Saved segments are the document, including deliberately deleted
        // shots. Rebuild keyframes only; generate a plan for a new/legacy take.
        // Loading is not an undo step.
        resetProject((p) => p, { replan: !bundle.hasSavedPlan });

        // The capture rate, not the output rate, and labelled as such: it is
        // routinely well under what was requested (gdigrab reaches about 28fps
        // at 1080p on this machine) and cannot be fixed in software, so the
        // one thing it must not do is get mistaken for a rendering fault.
        // manifest.video.fps is the achieved rate — checked against
        // `ffprobe -count_frames` on every take on disk, where it agrees
        // exactly.
        setStatus(
          `${manifest.video.width}×${manifest.video.height} · captured at ` +
            `${manifest.video.fps.toFixed(1)}fps${cameraWarning}`,
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
          fn: (exportSource: DecodedFrameSource, webcamSource?: DecodedFrameSource) => Promise<T>,
        ): Promise<T> => {
          const exportSource = await DecodedFrameSource.open(bundle.media.screen, { sequential: true });
          let webcamSource: DecodedFrameSource | undefined;
          try {
            if (bundle.media.webcam && live.current.project.webcam.visible) webcamSource = await DecodedFrameSource.open(bundle.media.webcam, { sequential: true });
            return await fn(exportSource, webcamSource);
          } finally {
            webcamSource?.close();
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
          benchDecode: async (sequential: boolean) => {
            const source = await DecodedFrameSource.open(bundle.media.screen, { sequential });
            const started = performance.now();
            let count = 0;
            try {
              for (const frame of planExportFrames(manifest.durationMs, live.current.project.cuts, live.current.project.output.fps, live.current.project.clips)) {
                const handle = await source.frameAt(frame.tSourceMs); handle.release(); count++;
              }
              return { frames: count, elapsedMs: performance.now() - started };
            } finally { source.close(); }
          },
          exportUI: (outFile: string) => runExportRef.current(outFile),
          exportTo: async (outFile: string) => {
            await withExportSource((exportSource, webcamSource) =>
              exportClip({
                manifest,
                project: live.current.project,
                cursorPath: live.current.cursorPath,
                clicks: live.current.clicks,
                backgroundImageUrl: live.current.backgroundImageUrl,
                mediaDir: bundle.dir.replace(/\\/g, "/"),
                renderer,
                source: exportSource,
                webcamSource,
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
      webcamRef.current?.close();
      webcamRef.current = null;
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
      // A feedback dialog owns its keyboard, including Space and Escape.
      if (event.target instanceof Element && event.target.closest("dialog[open]")) return;
      // Shared with the Space branch below -- Delete/Backspace is
      // destructive and Ctrl/Cmd+Z overrides whatever native undo a text
      // field has, so both must yield to typing exactly as Space already
      // does. One shared check keeps the two definitions from drifting apart.
      const typing = isTypingTarget(event.target);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProjectRef.current();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (typing) return;
        event.preventDefault();
        if (event.shiftKey) editRef.current.redo();
        else editRef.current.undo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b" && !typing) {
        event.preventDefault(); splitTimelineRef.current(); return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (typing) return;
        const s = editRef.current.selection;
        if (s === null) return;
        event.preventDefault();
        editRef.current.apply((p) =>
          s.kind === "segment" ? deleteSegment(p, s.id) : s.kind === "clip" ? deleteClip(p, s.id, manifest.durationMs) : deleteCut(p, s.id),
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
      // Space belongs to the focused disclosure, including its native toggle.
      if (event.target instanceof Element && event.target.closest("summary")) return;

      event.preventDefault();
      playerRef.current?.toggle();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manifest.durationMs]);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect must re-run on every project change; that is the one way an edit reaches a paused preview (see the comment above)
  useEffect(() => {
    playerRef.current?.seek(playerRef.current.playheadMs);
  }, [project]);

  // A paused preview must repaint after an image finishes decoding.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!backgroundImageUrl || !renderer) return;
    let cancelled = false;
    void renderer.preloadBackgroundImage(backgroundImageUrl).then(() => {
      if (cancelled) return;
      if (renderer.backgroundImageFailed(backgroundImageUrl)) { setStatus("Background image could not be loaded"); return; }
      const player = playerRef.current;
      if (player) player.seek(player.playheadMs);
    });
    return () => { cancelled = true; };
  }, [backgroundImageUrl]);

  /** A pacing dial is a global change: it must regenerate unclaimed shots. */
  const onConfigChange = (config: ZoomConfig): void => {
    edit.apply((p) => ({ ...p, zoom: { ...p.zoom, config } }), { replan: true });
  };

  /** Rebuild rendered camera geometry for the new aspect without changing shot timing. */
  const onOutputChange = (output: Project["output"]): void => {
    edit.apply((p) => ({ ...p, output }));
  };

  /** Rebuild camera samples while keeping this shot's authored timing. */
  const onSegmentCameraChange = (id: string, position: ZoomSegment["position"]): void => {
    edit.apply((p) => setSegmentCamera(p, id, position));
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

  /** Restore this shot from telemetry without changing other edited or deleted shots. */
  const onSegmentReset = (id: string): void => {
    edit.apply((p) => resetShotToAuto(p, id, deriveCtx));
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

  const runExport = async (chosenTarget?: string): Promise<void> => {
    if (sourceRef.current === null || exporting !== null) return;
    try {
      const target = chosenTarget ?? await window.zoomcast.pickExportTarget(`${manifest.id}.mp4`);
      if (target === null) return;
      setExporting("starting…");
      const snapshot = structuredClone(live.current.project);
      await window.zoomcast.saveProject(bundle.dir, snapshot);
      const id = await window.zoomcast.exports.start({ bundleDir: bundle.dir, project: snapshot, outFile: target });
      window.dispatchEvent(new CustomEvent("zoomcast:export", { detail: id }));
      setStatus("Export running in the background. You can keep editing or recording.");
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setExporting(null); }
  };
  runExportRef.current = runExport;

  const tools: Array<{ title: string; icon: IconName }> = [
    { title: "Appearance", icon: "appearance" }, { title: "Cursor", icon: "cursor" },
    { title: "Webcam", icon: "webcam" }, { title: "Audio", icon: "audio" },
    { title: "Captions", icon: "captions" },
    { title: "Output", icon: "output" }, { title: "Advanced zoom", icon: "zoom" },
  ];
  const addTimelineSegment = (): void => {
    const id = crypto.randomUUID();
    const next = addZoomAt(project, playerRef.current?.playheadMs ?? playheadMs, manifest.durationMs, id);
    if (next === project) { setStatus("Move the playhead inside a video clip to add a zoom."); return; }
    edit.apply(() => next);
    edit.select({ kind: "segment", id });
    setPopoverId(id);
  };
  const deleteTimelineSelection = (): void => {
    const selection = edit.selection;
    if (!selection) return;
    edit.apply(p => selection.kind === "segment" ? deleteSegment(p, selection.id) : selection.kind === "clip" ? deleteClip(p, selection.id, manifest.durationMs) : deleteCut(p, selection.id));
    edit.select(null);
  };
  const splitTimelineSelection = (): void => {
    const at = playerRef.current?.playheadMs ?? playheadMs;
    const selected = edit.selection;
    const id = crypto.randomUUID();
    const next = selected?.kind === "segment"
      ? splitZoom(project, selected.id, at, manifest.durationMs, id)
      : splitClip(project, selected?.kind === "clip" ? selected.id : null, at, manifest.durationMs, id);
    if (next === project) { setStatus("Place the playhead inside the selected clip or zoom to split it."); return; }
    edit.apply(() => next);
    edit.select({ kind: selected?.kind === "segment" ? "segment" : "clip", id });
    setPopoverId(null);
    setStatus("Segment split. Select a piece to move or delete it.");
  };
  splitTimelineRef.current = splitTimelineSelection;
  const splitEnabled = (edit.selection?.kind === "segment"
    ? splitZoom(project, edit.selection.id, playheadMs, manifest.durationMs, "split-check")
    : splitClip(project, edit.selection?.kind === "clip" ? edit.selection.id : null, playheadMs, manifest.durationMs, "split-check")) !== project;
  const timeLabel = (ms: number): string => `${Math.floor(ms / 60000)}:${(ms / 1000 % 60).toFixed(1).padStart(4, "0")}`;
  return (
    <div className="editor-shell">
      <header className="editor-header">
        <div className="editor-file-actions">
          <button type="button" className="icon-button" onClick={onBack} aria-label="Library" title="Back to recordings"><Icon name="folder" /></button>
          <span className="header-divider" />
          <button type="button" className="icon-button" disabled={!edit.canUndo} onClick={edit.undo} aria-label="Undo" title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
          <button type="button" className="icon-button" disabled={!edit.canRedo} onClick={edit.redo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Icon name="redo" /></button>
        </div>
        <div className="project-heading"><span className="project-name" title={manifest.id}>{manifest.id}</span><span className="project-extension">zoomcast project</span></div>
        <div className="header-actions">
          <button type="button" className="quiet-action" aria-label="Save project" title="Save project (Ctrl+S)" disabled={saving || sourceRef.current === null} onClick={() => { void saveProject(); }}><Icon name="save" size={16} />{saving ? "Saving…" : "Save project"}</button>
          <button type="button" className="primary-action" disabled={exporting !== null || outDuration <= 0} onClick={() => { void runExport(); }}><Icon name="output" size={16} />{exporting === null ? "Export video" : `Exporting ${exporting}`}</button>
        </div>
      </header>
      <nav className="tool-rail" aria-label="Editor tools">
        <span className="rail-brand" aria-hidden="true">z</span>
        {tools.map(({ title, icon }) => <button key={title} type="button" className={`tool-button ${activeSection === title ? "active" : ""}`} aria-label={title} aria-pressed={activeSection === title} title={title} onClick={() => setActiveSection(title)}><Icon name={icon} size={22} /></button>)}
        <button type="button" className="tool-button rail-settings" aria-label="Settings" title="Settings" onClick={() => void window.zoomcast.openSettings()}><Icon name="settings" size={22} /></button>
      </nav>
      <aside className="editor-inspector" aria-label="Recording controls">
        <CaptionsPanel active={activeSection === "Captions"} bundle={bundle} project={project}
          onChange={captions => edit.apply(p => ({ ...p, captions }))}
          onTransient={captions => edit.applyTransient(p => ({ ...p, captions }))}
          onCommit={edit.commitGesture}
          onSeek={t => playerRef.current?.seek(t)} />
        <Inspector
          activeSection={activeSection}
          audio={project.audio}
          onAudioChange={(audio) => edit.apply((p) => ({ ...p, audio }))}
          webcam={project.webcam}
          hasWebcam={Boolean(bundle.media.webcam)}
          onWebcamChange={(webcam) => edit.apply((p) => ({ ...p, webcam }))}
          config={project.zoom.config}
          onChange={onConfigChange}
          cursor={project.style.cursor}
          hasCursorPosition={cursorPath.xs.length > 0}
          onCursorChange={(cursor) =>
            edit.apply((p) => ({ ...p, style: { ...p.style, cursor } }))
          }
          style={project.style}
          output={project.output}
          dir={bundle.dir}
          onStyleChange={(style) => edit.apply((p) => ({ ...p, style }), { replan: style.paddingFactor !== project.style.paddingFactor })}
          onStyleTransient={style => edit.applyTransient(p => ({ ...p, style }))}
          onStyleCommit={edit.commitGesture}
          onOutputChange={onOutputChange}
        />
      </aside>
      <main className="editor-workspace">
        <div className="preview-heading"><span>Preview</span><select className="aspect-button" aria-label="Preview aspect ratio" value={project.output.aspect} onChange={event => onOutputChange({ ...project.output, aspect: event.target.value as AspectChoice })}>
          {(["native", "16:9", "4:3", "1:1", "9:16"] as const).map(aspect => <option key={aspect} value={aspect}>{aspect === "native" ? "Native aspect" : aspect}</option>)}
        </select></div>
        <div className="preview-stage"><canvas ref={canvasRef} className="preview-canvas" /></div>
        <div className="transport">
          <span className="editor-status" role="status">{status || "Loading recording…"}</span>
          <div className="playback-controls">
            <span className="time-readout">{timeLabel(playheadMs)}</span>
            <button type="button" className="icon-button" aria-label="Restart" title="Back to start" onClick={() => playerRef.current?.seek(0)}><Icon name="restart" size={16} /></button>
            <button type="button" className="play-button" aria-label={playing ? "Pause" : "Play"} title="Play / pause (Space)" onClick={() => playerRef.current?.toggle()}><Icon name={playing ? "pause" : "play"} size={17} /></button>
            <span className="time-readout time-total">{timeLabel(outDuration)}</span>
          </div>
          <span className="transport-help">Space to play</span>
        </div>
      </main>
        <section className="editor-timeline" ref={timelineWrapRef}>
          <div className="timeline-toolbar">
            <div className="timeline-actions">
              <button type="button" className="timeline-add" onClick={addTimelineSegment} disabled={outDuration <= 0}><Icon name="plus" size={17} />Add segment<span><Icon name="zoom" size={18} /></span></button>
              <button type="button" className="icon-button" aria-label="Delete timeline selection" title="Delete selected video clip or zoom" disabled={edit.selection === null} onClick={deleteTimelineSelection}><Icon name="trash" size={18} /></button>
              <button type="button" className="icon-button" aria-label="Timeline undo" title="Undo (Ctrl+Z)" disabled={!edit.canUndo} onClick={edit.undo}><Icon name="undo" size={18} /></button>
              <button type="button" className="icon-button" aria-label="Timeline redo" title="Redo (Ctrl+Shift+Z)" disabled={!edit.canRedo} onClick={edit.redo}><Icon name="redo" size={18} /></button>
              <button type="button" className="icon-button" aria-label="Split at playhead" title="Split selected clip or zoom (Ctrl+B)" disabled={!splitEnabled} onClick={splitTimelineSelection}><Icon name="scissors" size={18} /></button>
              <button type="button" className="icon-button" aria-label="Reset selected zoom" title="Reset selected zoom" disabled={selectedSegment === null} onClick={() => { if (selectedSegment) onSegmentReset(selectedSegment.id); }}><Icon name="restart" size={18} /></button>
            </div>
            <div className="timeline-scale"><button type="button" aria-label="Zoom timeline out" disabled={timelineZoom === 1} onClick={() => setTimelineZoom(z => Math.max(1, z - 0.5))}>−</button><input type="range" aria-label="Timeline zoom" min="1" max="4" step="0.25" value={timelineZoom} onChange={event => setTimelineZoom(Number(event.target.value))} /><button type="button" aria-label="Zoom timeline in" disabled={timelineZoom === 4} onClick={() => setTimelineZoom(z => Math.min(4, z + 0.5))}>+</button></div>
          </div>
          <div className="timeline-viewport" ref={timelineViewportRef} onScroll={event => setTimelineScrollLeft(event.currentTarget.scrollLeft)}><div style={{ width: `${timelineZoom * 100}%` }}>
          <Timeline
            durationMs={manifest.durationMs}
            outputDurationMs={outDuration}
            cuts={project.cuts}
            keyframes={project.zoom.keyframes}
            segments={project.zoom.segments}
            selection={edit.selection}
            onSelect={selection => { edit.select(selection); setPopoverId(selection?.kind === "segment" ? selection.id : null); }}
            playheadMs={playheadMs}
            playheadRef={playheadElRef}
            pixelParityZoom={ceiling}
            onSeek={(t) => playerRef.current?.seek(t)}
            onSegmentMove={onSegmentMove}
            onSegmentResize={onSegmentResize}
            onSegmentDragCommit={edit.commitGesture}
            clips={baseClips}
            orderedClips={project.clips}
            onClipReorder={(id, beforeId) => edit.apply(p => reorderClip(p, id, beforeId, manifest.durationMs))}
          />

          </div></div>
          <TimelineFooter clips={baseClips} segments={project.zoom.segments} playheadMs={playheadMs} outputDurationMs={outDuration} maxZoom={project.zoom.config.maxZoom} pixelParityZoom={ceiling} />

          {selectedSegment !== null && selectedSegment.id === popoverId && selectedSegmentSpan !== null && outDuration > 0 && (
            <SegmentPopover
              segment={selectedSegment}
              maxZoom={project.zoom.config.maxZoom}
                layoutVersion={`${timelineZoom}-${timelineScrollLeft}-${selectedSegmentSpan.startMs}-${outDuration}`}
              timelineRef={timelineWrapRef}
              onDepthChange={onSegmentDepthChange}
              onCameraChange={onSegmentCameraChange}
              onDelete={onSegmentDelete}
              onReset={onSegmentReset}
              onDismiss={() => setPopoverId(null)}
            />
          )}
        </section>

    </div>
  );
}
