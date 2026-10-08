import type { CaptionStyle } from "../../shared/captions/types";
import type { Size } from "../../shared/zoom/types";

/** Rasterize only when the cue, style or resolution changes, never every frame. */
export class CaptionTexture {
  private key = "";
  private texture: WebGLTexture | null = null;
  private canvas = document.createElement("canvas");
  private height = 0;

  get(gl: WebGL2RenderingContext, text: string, style: CaptionStyle, out: Size): { texture: WebGLTexture; width: number; height: number } {
    const key = JSON.stringify([text, style, out]);
    if (key !== this.key || !this.texture) {
      const ctx = this.canvas.getContext("2d");
      if (!ctx) throw new Error("Caption text rendering is unavailable.");
      const width = Math.max(1, Math.round(out.w * 0.9));
      let fontSize = Math.max(8, out.h * style.sizePct / 100);
      let lines: string[] = [];
      const padding = Math.max(4, out.h * 0.012);
      const wrap = () => {
        ctx.font = `600 ${fontSize}px "${style.font}"`;
        const available = width - padding * 2;
        const result: string[] = [];
        let line = "";
        for (const word of text.split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (ctx.measureText(candidate).width <= available) { line = candidate; continue; }
          if (line) result.push(line);
          line = "";
          for (const char of Array.from(word)) {
            if (line && ctx.measureText(line + char).width > available) { result.push(line); line = ""; }
            line += char;
          }
        }
        if (line) result.push(line);
        return result;
      };
      lines = wrap();
      while (lines.length * fontSize * 1.25 + padding * 2 > out.h * 0.45 && fontSize > 8) { fontSize = Math.max(8, fontSize * 0.9); lines = wrap(); }
      const lineHeight = fontSize * 1.25;
      this.height = Math.ceil(lines.length * lineHeight + padding * 2);
      this.canvas.width = width;
      this.canvas.height = this.height;
      ctx.font = `600 ${fontSize}px "${style.font}"`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (style.background) {
        const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width), 0);
        const boxWidth = Math.min(width, Math.ceil(textWidth + padding * 2));
        ctx.fillStyle = "rgba(0,0,0,0.78)";
        ctx.beginPath();
        ctx.roundRect((width - boxWidth) / 2, 0, boxWidth, this.height, padding);
        ctx.fill();
      }
      ctx.fillStyle = style.color;
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.lineWidth = Math.max(1, fontSize * 0.06);
      ctx.lineJoin = "round";
      lines.forEach((line, i) => {
        const y = padding + (i + 0.5) * lineHeight;
        ctx.strokeText(line, width / 2, y);
        ctx.fillText(line, width / 2, y);
      });
      this.texture ??= gl.createTexture();
      if (!this.texture) throw new Error("Caption texture could not be created.");
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
      this.key = key;
    }
    return { texture: this.texture, width: this.canvas.width, height: this.height };
  }
  dispose(gl: WebGL2RenderingContext): void { gl.deleteTexture(this.texture); this.texture = null; }
}
