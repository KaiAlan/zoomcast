/**
 * Loads a background image into a GL texture, cached by URL.
 *
 * Decode is asynchronous but `drawFrame` is not, so `get` returns null until
 * the image is ready and the caller falls back to the solid colour for those
 * few frames. Blocking the render loop on a decode would stall preview and
 * export alike; a couple of fallback frames in the preview is the cheaper
 * failure. Export must not take that trade — see `preload`.
 */
export class BackgroundTextureCache {
  private readonly textures = new Map<string, WebGLTexture>();
  private readonly pending = new Map<string, Promise<void>>();

  /** Null until the image has decoded. Never throws, never blocks. */
  get(gl: WebGL2RenderingContext, url: string): WebGLTexture | null {
    const held = this.textures.get(url);
    if (held !== undefined) return held;

    if (!this.pending.has(url)) this.pending.set(url, this.load(gl, url));
    return null;
  }

  /**
   * Resolve once the image is decoded, or immediately if it already is.
   *
   * Export renders every frame in a loop with no repaint afterwards, so a
   * frame that fell back to the solid colour is baked into the file. The
   * export path awaits this before its loop starts; the preview does not need
   * to, because it redraws.
   */
  async preload(gl: WebGL2RenderingContext, url: string): Promise<void> {
    if (this.textures.has(url)) return;

    const inflight = this.pending.get(url) ?? this.load(gl, url);
    this.pending.set(url, inflight);
    await inflight;
  }

  private async load(gl: WebGL2RenderingContext, url: string): Promise<void> {
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`could not load ${url}`));
        img.src = url;
      });

      const tex = gl.createTexture();
      if (tex === null) return;

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      // Mipmaps ARE the blur: the shader samples an explicit LOD. Trilinear
      // min-filtering so a fractional level interpolates between two mip
      // levels instead of stepping between them, which lets "moderate" sit
      // between whole halvings.
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.textures.set(url, tex);
      this.sizes.set(url, { w: img.naturalWidth, h: img.naturalHeight });
    } catch {
      // A missing or corrupt image is a degraded background, not a crash: the
      // renderer keeps falling back to the solid colour.
    } finally {
      this.pending.delete(url);
    }
  }

  private readonly sizes = new Map<string, { w: number; h: number }>();

  /** Natural size of a decoded image, for cover fit. Null before it loads. */
  sizeOf(url: string): { w: number; h: number } | null {
    return this.sizes.get(url) ?? null;
  }

  /** Releases every texture. Call once, from the owning Renderer's dispose. */
  dispose(gl: WebGL2RenderingContext): void {
    for (const tex of this.textures.values()) gl.deleteTexture(tex);
    this.textures.clear();
    this.pending.clear();
    this.sizes.clear();
  }
}
