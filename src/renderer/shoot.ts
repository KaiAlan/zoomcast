import { defaultProject } from "../shared/project/defaults";
import type { StyleConfig } from "../shared/project/types";
import type { ZoomState } from "../shared/zoom/interpolate";
import type { Size } from "../shared/zoom/types";
import { Renderer } from "./gl/Renderer";
import { VideoSource } from "./media/VideoSource";

export type ShotSpec = {
  zoom: ZoomState;
  outputSize?: Size;
  sourceSize?: Size;
  style?: Partial<StyleConfig>;
  /** Which built-in test image to composite. */
  image?: "grid" | "solid";
  /** Decode this mp4 instead of drawing a test image. */
  video?: string;
  /** Source time to decode, in ms. */
  tMs?: number;
};

declare global {
  interface Window {
    __shoot?: (spec: ShotSpec) => Promise<string>;
  }
}

/**
 * A synthetic screen texture with a visible grid and corner markers, so a
 * still frame is enough to judge placement, cropping and orientation.
 */
function makeTestImage(size: Size, kind: "grid" | "solid"): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size.w;
  c.height = size.h;

  const ctx = c.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");

  ctx.fillStyle = "#2b6cb0";
  ctx.fillRect(0, 0, size.w, size.h);

  if (kind === "grid") {
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    for (let x = 0; x <= size.w; x += size.w / 12) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.h);
      ctx.stroke();
    }
    for (let y = 0; y <= size.h; y += size.h / 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.w, y);
      ctx.stroke();
    }

    // Corner markers: unique colour per corner proves orientation
    const corners: Array<[string, number, number]> = [
      ["#f6e05e", 0, 0],
      ["#f56565", size.w - 160, 0],
      ["#48bb78", 0, size.h - 160],
      ["#ed64a6", size.w - 160, size.h - 160],
    ];
    for (const [color, x, y] of corners) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 160, 160);
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.round(size.h / 10)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TOP LEFT = YELLOW", size.w / 2, size.h / 2);
  }

  return c;
}

export function installShootHook(canvas: HTMLCanvasElement): void {
  const renderer = new Renderer(canvas);
  const baseStyle = defaultProject("shoot").style;

  const sources = new Map<string, VideoSource>();

  window.__shoot = async (spec: ShotSpec): Promise<string> => {
    const outputSize = spec.outputSize ?? { w: 1280, h: 720 };
    const style: StyleConfig = { ...baseStyle, ...spec.style };

    let screen: TexImageSource;
    let sourceSize: Size;
    let frame: VideoFrame | null = null;

    if (spec.video !== undefined) {
      let source = sources.get(spec.video);
      if (source === undefined) {
        source = await VideoSource.open(spec.video);
        sources.set(spec.video, source);
      }

      frame = await source.frameAt(spec.tMs ?? 0);
      screen = frame;
      sourceSize = { w: source.width, h: source.height };
    } else {
      sourceSize = spec.sourceSize ?? { w: 1920, h: 1080 };
      screen = makeTestImage(sourceSize, spec.image ?? "grid");
    }

    try {
      renderer.drawFrame({
        screen,
        zoom: spec.zoom,
        style,
        outputSize,
        sourceSize,
      });
      return canvas.toDataURL("image/png");
    } finally {
      frame?.close();
    }
  };
}
