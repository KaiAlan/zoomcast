import { useEffect, useRef } from "react";
import type { ExportJobUpdate } from "../../shared/export/jobs";
import { buildCursorPath, smoothingToHalfLife } from "../../shared/cursor/path";
import { Renderer } from "../gl/Renderer";
import { DecodedFrameSource } from "../media/VideoSource";
import { exportClip } from "../media/exportClip";
import { bundleAssetUrl } from "../media/assetUrl";

/** A dedicated renderer owns the frozen export; editors can keep changing. */
export function ExportWindow() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cancelled = useRef({ cancelled: false });
  const id = new URLSearchParams(window.location.search).get("job") ?? "";
  useEffect(() => {
    let renderer: Renderer | undefined;
    let source: DecodedFrameSource | undefined;
    let camera: DecodedFrameSource | undefined;
    let disposed = false;
    const unsubscribe = window.zoomcast.exports.onCancelled(jobId => { if (jobId === id) cancelled.current.cancelled = true; });
    const smallPreview = document.createElement("canvas");
    let previewAt = 0;
    const publish = async (update: ExportJobUpdate): Promise<void> => {
      await window.zoomcast.exports.update(id, update);
    };
    void (async () => {
      try {
        const { request } = await window.zoomcast.exports.job(id);
        const bundle = await window.zoomcast.openBundle(request.bundleDir);
        const project = request.project;
        const element = canvas.current;
        if (!element || disposed) return;
        renderer = new Renderer(element);
        source = await DecodedFrameSource.open(bundle.media.screen, { sequential: true });
        if (bundle.media.webcam && project.webcam.visible) camera = await DecodedFrameSource.open(bundle.media.webcam, { sequential: true });
        const completed = await exportClip({
          manifest: bundle.manifest, project,
          cursorPath: buildCursorPath(bundle.telemetry, { halfLifeMs: smoothingToHalfLife(project.style.cursor.smoothing), sampleHz: 120 }),
          clicks: bundle.telemetry.filter(event => event.k === "down"),
          backgroundImageUrl: project.style.background.kind === "image" ? bundleAssetUrl(bundle.dir, project.style.background.imageFile) : undefined,
          mediaDir: bundle.dir.replace(/\\/g, "/"), renderer, source, webcamSource: camera,
          outFile: request.outFile, encoder: "auto", signal: cancelled.current,
          onTimings: timings => console.info(`zoomcast:export-timings ${JSON.stringify({ jobId: id, ...timings })}`),
          onProgress: progress => {
            let preview: string | undefined;
            const from = canvas.current;
            if (from && (performance.now() - previewAt > 500 || progress.phase === "done")) {
              smallPreview.width = 480; smallPreview.height = Math.round(480 * from.height / from.width);
              smallPreview.getContext("2d")?.drawImage(from, 0, 0, smallPreview.width, smallPreview.height);
              preview = smallPreview.toDataURL("image/jpeg", 0.7); previewAt = performance.now();
            }
            void window.zoomcast.exports.update(id, { ...progress, preview }).catch(error => console.error(error));
          },
        });
        await publish({ phase: completed ? "done" : "cancelled", done: completed ? 1 : 0, total: 1 });
      } catch (error) {
        await publish({ phase: "failed", done: 0, total: 1, error: error instanceof Error ? error.message : String(error) });
      } finally { camera?.close(); source?.close(); }
    })();
    return () => { unsubscribe(); disposed = true; cancelled.current.cancelled = true; renderer?.dispose(); };
  }, [id]);
  return <canvas ref={canvas} style={{display:"none"}} />;
}
