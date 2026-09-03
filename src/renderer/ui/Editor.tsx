import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OpenedBundle } from "../../shared/api";
import { outputDurationMs, outputToSource } from "../../shared/project/timeline";
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

export function Editor({ bundle }: { bundle: OpenedBundle }) {
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
      output: { w: project.output.width, h: project.output.height },
      paddingFactor: project.style.paddingFactor,
    }),
    [manifest, project.output, project.style.paddingFactor],
  );

  const ceiling = useMemo(
    () => maxComfortableZoom(ctx.source, ctx.output, ctx.paddingFactor),
    [ctx],
  );

  const outDuration = outputDurationMs(manifest.durationMs, project.cuts);

  // Latest values for the render loop, which must not be re-created per frame.
  const live = useRef({ project, ctx });
  live.current = { project, ctx };

  /** Plan on load, then merge so pinned edits survive a config change. */
  const applyPlan = useCallback(
    (config: ZoomConfig, existing: Project) => {
      const generated = planZoom(bundle.telemetry, config, {
        source: { w: manifest.video.width, h: manifest.video.height },
        output: { w: existing.output.width, h: existing.output.height },
        paddingFactor: existing.style.paddingFactor,
      });

      return replan(existing.zoom.keyframes, generated);
    },
    [bundle.telemetry, manifest.video.width, manifest.video.height],
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

      const { project: p, ctx: c } = live.current;
      const tSource = outputToSource(tOutputMs, manifest.durationMs, p.cuts);

      const frame = await source.frameAt(tSource);
      try {
        renderer.drawFrame({
          screen: frame,
          zoom: zoomAt(p.zoom.keyframes, tSource),
          style: p.style,
          outputSize: c.output,
          sourceSize: c.source,
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

      playerRef.current?.pause();
      setExporting("starting…");

      try {
        await exportClip({
          manifest,
          project,
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
          <span style={{ fontSize: 15 }}>{manifest.id}</span>
          <span style={{ fontSize: 12, opacity: 0.5 }}>{status}</span>
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
        <Inspector config={project.zoom.config} onChange={onConfigChange} />
      </div>
    </div>
  );
}
