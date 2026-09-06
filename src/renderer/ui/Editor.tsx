import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OpenedBundle } from "../../shared/api";
import { buildCursorPath, cursorAt } from "../../shared/cursor/path";
import { RIPPLE_DURATION_MS, ripplesAt } from "../../shared/cursor/ripples";
import { outputDurationMs, outputToSource } from "../../shared/project/timeline";
import { outputSizeFor } from "../../shared/style/aspect";
import { bundleAssetUrl } from "../media/assetUrl";
import type { Cut, Project } from "../../shared/project/types";
import { maxComfortableZoom } from "../../shared/zoom/geometry";
import { zoomAt } from "../../shared/zoom/interpolate";
import { planZoom } from "../../shared/zoom/planner";
import { replan } from "../../shared/zoom/replan";
import type { PlanContext, ZoomConfig } from "../../shared/zoom/types";
import { Renderer } from "../gl/Renderer";
import { exportClip } from "../media/exportClip";
import { PreviewPlayer } from "../media/PreviewPlayer";
import { VideoSource } from "../media/VideoSource";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";

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
    () => maxComfortableZoom(ctx.source, ctx.output, ctx.paddingFactor),
    [ctx],
  );

  const outDuration = outputDurationMs(manifest.durationMs, project.cuts);

  // Built once per bundle: pure and cheap, but rebuilding per frame would be
  // wasteful. Depends on smoothing because that changes the resulting path.
  const cursorPath = useMemo(
    () =>
      buildCursorPath(bundle.telemetry, {
        smoothing: project.style.cursor.smoothing,
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

  /** Plan on load, then merge so pinned edits survive a config change. */
  const applyPlan = useCallback(
    (config: ZoomConfig, existing: Project) => {
      const generated = planZoom(bundle.telemetry, config, {
        source: { w: manifest.video.width, h: manifest.video.height },
        // The zoom ceiling derives from the output size, so a re-plan after an
        // aspect change must see the new shape or it plans for the old one.
        output: outputSizeFor(existing.output, {
          w: manifest.video.width,
          h: manifest.video.height,
        }),
        paddingFactor: existing.style.paddingFactor,
        durationMs: manifest.durationMs,
      });

      return replan(existing.zoom.keyframes, generated);
    },
    [
      bundle.telemetry,
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

    const player = new PreviewPlayer(
      renderAt,
      () => outputDurationMs(manifest.durationMs, live.current.project.cuts),
      (t, isPlaying) => {
        setPlayheadMs(t);
        setPlaying(isPlaying);
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
            zoom: { ...prev.zoom, keyframes: applyPlan(prev.zoom.config, prev) },
          };
          live.current = { ...live.current, project: next };
          return next;
        });

        setStatus(`${manifest.video.width}×${manifest.video.height} · ${manifest.video.fps}fps`);

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

  // PreviewPlayer draws only on play/seek/toggle and nothing watches `project`,
  // so a style or output edit is invisible on a paused preview without this.
  // It is an effect rather than a seek inside each handler because both
  // `cursorPath` and `ctx` are useMemos on these values: only the re-render
  // rebuilds them, so a synchronous seek would redraw with the old ones.
  //
  // Widened from style.cursor to the whole style deliberately — a third
  // redraw idiom in this file is the thing HANDOVER warns against, and every
  // style field reaches the renderer the same way.
  useEffect(() => {
    playerRef.current?.seek(playerRef.current.playheadMs);
  }, [project.style, project.output]);

  const onConfigChange = (config: ZoomConfig): void => {
    setProject((prev) => {
      const withConfig = { ...prev, zoom: { ...prev.zoom, config } };
      const next = {
        ...withConfig,
        zoom: { config, keyframes: applyPlan(config, withConfig) },
      };
      live.current = { ...live.current, project: next };
      return next;
    });

    playerRef.current?.seek(playerRef.current.playheadMs);
  };

  /**
   * Output changes must re-plan, not just re-render.
   *
   * `maxComfortableZoom` is derived from the output size, so every keyframe's
   * scale belongs to the output it was planned against. Changing the aspect
   * with a bare setProject updated the context, the ceiling and the timeline
   * readout while leaving every keyframe carrying a scale computed for the old
   * shape — which is precisely what applyPlan's own comment says must not
   * happen. The same applies to paddingFactor if a control for it ever lands,
   * since it feeds the ceiling too.
   */
  const onOutputChange = (output: Project["output"]): void => {
    setProject((prev) => {
      const withOutput = { ...prev, output };
      const next = {
        ...withOutput,
        zoom: {
          ...withOutput.zoom,
          keyframes: applyPlan(withOutput.zoom.config, withOutput),
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
          maxComfortableZoom={ceiling}
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
