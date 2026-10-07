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
  // A 4K texture plus mipmaps costs about 44MB. Keep gallery browsing bounded.
  private static readonly MAX_TEXTURES = 3;
  private disposed = false;
  private readonly textures = new Map<string, WebGLTexture>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();

  /** Null until the image has decoded. Never throws, never blocks. */
  get(gl: WebGL2RenderingContext, url: string): WebGLTexture | null {
    const held = this.textures.get(url);
    if (held !== undefined) {
      this.textures.delete(url); this.textures.set(url, held);
      return held;
    }
    if (this.disposed) return null;

    // A failure has to be remembered, because nothing else here stops a retry:
    // `load` records success in `textures` and clears `pending` in a finally,
    // so a URL that cannot decode used to start a fresh Image() on every
    // single get — 60 a second in preview, one per frame in export, all of
    // them long after preload had already resolved.
    if (this.failed.has(url)) return null;

    if (!this.pending.has(url)) this.pending.set(url, this.load(gl, url));
    return null;
  }

  /**
   * Whether this URL was tried and cannot be decoded.
   *
   * Preview treats that as a degraded background and carries on redrawing.
   * Anything that renders once with no repaint — export, and the shoot
   * harness — should treat it as a failure instead, or it bakes the fallback
   * colour into its output and reports success.
   */
  failedToLoad(url: string): boolean {
    return this.failed.has(url);
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
    if (this.disposed) return;
    if (this.textures.has(url)) { this.get(gl, url); return; }

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
      if (this.disposed) return;

      const tex = gl.createTexture();
      // Not a bare return: that skipped the catch below, so the failure was
      // neither recorded nor reported and `get` restarted a fresh Image() on
      // every frame — the exact storm the `failed` set exists to stop.
      if (tex === null) throw new Error(`could not create a texture for ${url}`);

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

      if (this.textures.size >= BackgroundTextureCache.MAX_TEXTURES) {
        const oldest = this.textures.keys().next().value;
        if (oldest !== undefined) {
          const evicted = this.textures.get(oldest);
          if (evicted) gl.deleteTexture(evicted);
          this.textures.delete(oldest); this.sizes.delete(oldest);
        }
      }
      this.textures.set(url, tex);
      this.sizes.set(url, { w: img.naturalWidth, h: img.naturalHeight });
      // preload() deliberately retries a URL that failed before, so a success
      // has to clear the flag — otherwise failedToLoad stays true forever and
      // a caller that checks it rejects a background that decoded fine.
      this.failed.delete(url);
    } catch (err) {
      // A missing or corrupt image is a degraded background, not a crash: the
      // renderer keeps falling back to the solid colour. Recorded so it is not
      // retried, and reported once so a background that silently never appears
      // is diagnosable — spec §5 copies the image into the bundle precisely so
      // this should not happen, which makes it worth hearing about when it does.
      this.failed.add(url);
      console.error("background image failed to load", url, err);
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
    this.disposed = true;
    for (const tex of this.textures.values()) gl.deleteTexture(tex);
    this.textures.clear();
    this.pending.clear();
    this.sizes.clear();
    this.failed.clear();
  }
}
