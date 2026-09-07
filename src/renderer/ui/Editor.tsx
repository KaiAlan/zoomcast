import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OpenedBundle } from "../../shared/api";
import { buildCursorPath, cursorAt, smoothingToHalfLife } from "../../shared/cursor/path";
import { RIPPLE_DURATION_MS, ripplesAt } from "../../shared/cursor/ripples";
import { outputDurationMs, outputToSource } from "../../shared/project/timeline";
import { outputSizeFor } from "../../shared/style/aspect";
import { bundleAssetUrl } from "../media/assetUrl";
import type { Cut, Project } from "../../shared/project/types";
import { pixelParityZoom } from "../../shared/zoom/geometry";
import { zoomAt } from "../../shared/zoom/interpolate";
import { followPath } from "../../shared/zoom/camera";
import { segmentsToKeyframes } from "../../shared/zoom/keyframes";
import { planZoom } from "../../shared/zoom/planner";
import { replan, replanSegments } from "../../shared/zoom/replan";
import type { PlanContext, ZoomConfig } from "../../shared/zoom/types";
import { Renderer } from "../gl/Renderer";
import { exportClip } from "../media/exportClip";
import { PreviewPlayer } from "../media/PreviewPlayer";
import { VideoSource } from "../media/VideoSource";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";

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

export function Editor({
  bundle,
  onBack,
}: {
  bundle: OpenedBundle;
  onBack: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const sourceRef = useRef<VideoSource | null>(null);
  const playerRef = useRef<PreviewPlayer | null>(null);

  const [project, setProject] = useState<Project>(bundle.project);
  const [playheadMs, setPlayheadMs] = useState(0);
  /** The marker element, moved directly during playback. */
  const playheadElRef = useRef<HTMLDivElement | null>(null);
  const readoutAtRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("loading…");
  const [exporting, setExporting] = useState<string | null>(null);

  const { manifest } = bundle;

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

  /**
   * The camera's own path: the same function the cursor uses, at a
   * camera-scale half-life. Built once per take — it is a pure function of
   * telemetry, which is what keeps preview and export showing one camera.
   */
  const cameraPath = useMemo(() => followPath(bundle.telemetry), [bundle.telemetry]);

  /** Plan on load, then merge so pinned edits survive a config change. */
  const applyPlan = useCallback(
    (config: ZoomConfig, existing: Project) => {
      const planCtx = {
        source: { w: manifest.video.width, h: manifest.video.height },
        // The zoom ceiling derives from the output size, so a re-plan after an
        // aspect change must see the new shape or it plans for the old one.
        output: outputSizeFor(existing.output, {
          w: manifest.video.width,
          h: manifest.video.height,
        }),
        paddingFactor: existing.style.paddingFactor,
        durationMs: manifest.durationMs,
      };

      const segments = replanSegments(
        existing.zoom.segments,
        planZoom(bundle.telemetry, config, planCtx),
      );

      return {
        segments,
        keyframes: replan(
          existing.zoom.keyframes,
          segmentsToKeyframes(segments, config, planCtx, cameraPath),
        ),
      };
    },
    [
      bundle.telemetry,
      cameraPath,
      manifest.video.width,
      manifest.video.height,
      manifest.durationMs,
    ],
  );

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
        renderer.drawFrame({
          screen: frame,
          zoom: zoomAt(p.zoom.keyframes, tSource),
          style: p.style,
          outputSize: c.output,
          sourceSize: c.source,
          cursor: sample === null ? undefined : { sample, style: p.style.cursor },
          ripples: ripplesAt(clicks, tSource, RIPPLE_DURATION_MS),
          backgroundImageUrl,
        });
      } finally {
        frame.close();
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
    );
    playerRef.current = player;

    void (async () => {
      try {
        const source = await VideoSource.open(bundle.media.screen);
        if (disposed) {
          source.close();
          return;
        }

        sourceRef.current = source;

        setProject((prev) => {
          const next = {
            ...prev,
            zoom: { ...prev.zoom, ...applyPlan(prev.zoom.config, prev) },
          };
          live.current = { ...live.current, project: next };
          return next;
        });

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

        // Test hooks for tools/verify-parity.ts. renderAt is awaited directly
        // rather than going through the player, so a screenshot is guaranteed
        // to be taken after the frame has actually been drawn.
        window.__zc = {
          renderAt: async (tOutputMs: number) => {
            await renderAt(tOutputMs);
            return canvas.toDataURL("image/png");
          },
          exportTo: async (outFile: string) => {
            await exportClip({
              manifest,
              project: live.current.project,
              cursorPath: live.current.cursorPath,
              clicks: live.current.clicks,
              backgroundImageUrl: live.current.backgroundImageUrl,
              mediaDir: bundle.dir.replace(/\\/g, "/"),
              renderer,
              source,
              outFile,
              encoder: "libx264",
              onProgress: () => undefined,
            });
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
  }, [bundle, manifest, applyPlan]);

  // Space toggles playback. preventDefault matters twice over: it stops the
  // page scrolling, and it stops Space from re-activating whichever button was
  // last clicked, which would otherwise fight this handler.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || event.repeat) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
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

  const onConfigChange = (config: ZoomConfig): void => {
    setProject((prev) => {
      const withConfig = { ...prev, zoom: { ...prev.zoom, config } };
      const next = {
        ...withConfig,
        zoom: { ...withConfig.zoom, config, ...applyPlan(config, withConfig) },
      };
      live.current = { ...live.current, project: next };
      return next;
    });
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
    setProject((prev) => {
      const withOutput = { ...prev, output };
      const next = {
        ...withOutput,
        zoom: {
          ...withOutput.zoom,
          ...applyPlan(withOutput.zoom.config, withOutput),
        },
      };
      live.current = { ...live.current, project: next };
      return next;
    });
  };

  const addCut = (): void => {
    const start = playheadMs;
    const end = Math.min(start + 500, outDuration);
    if (end <= start) return;

    const srcStart = outputToSource(start, manifest.durationMs, project.cuts);
    const srcEnd = outputToSource(end, manifest.durationMs, project.cuts);
    const cut: Cut = { startMs: srcStart, endMs: srcEnd };

    setProject((prev) => {
      const next = { ...prev, cuts: [...prev.cuts, cut] };
      live.current = { ...live.current, project: next };
      return next;
    });
  };

  const runExport = (): void => {
    const renderer = rendererRef.current;
    const source = sourceRef.current;
    if (renderer === null || source === null || exporting !== null) return;

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

      try {
        await exportClip({
          manifest,
          project,
          cursorPath: live.current.cursorPath,
          clicks: live.current.clicks,
          backgroundImageUrl: live.current.backgroundImageUrl,
          mediaDir: bundle.dir.replace(/\\/g, "/"),
          renderer,
          source,
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
          <button type="button" style={button} onClick={addCut}>
            cut 0.5s here
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

        <Timeline
          durationMs={manifest.durationMs}
          outputDurationMs={outDuration}
          cuts={project.cuts}
          keyframes={project.zoom.keyframes}
          playheadMs={playheadMs}
          playheadRef={playheadElRef}
          pixelParityZoom={ceiling}
          maxZoom={project.zoom.config.maxZoom}
          onSeek={(t) => playerRef.current?.seek(t)}
        />
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
            setProject((p) => ({ ...p, style: { ...p.style, cursor } }))
          }
          style={project.style}
          output={project.output}
          dir={bundle.dir}
          onStyleChange={(style) => setProject((p) => ({ ...p, style }))}
          onOutputChange={onOutputChange}
        />
      </div>
    </div>
  );
}
