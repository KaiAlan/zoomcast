import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundTextureCache } from "./backgroundTexture";

const loaded: Array<() => void> = [];
class FakeImage {
  naturalWidth = 3840;
  naturalHeight = 2160;
  onload?: () => void;
  onerror?: () => void;
  set src(_url: string) { loaded.push(() => this.onload?.()); }
}
function fakeGl() {
  let id = 0;
  return {
    createTexture: vi.fn(() => ({ id: ++id })), deleteTexture: vi.fn(),
    bindTexture: vi.fn(), texImage2D: vi.fn(), generateMipmap: vi.fn(), texParameteri: vi.fn(),
  } as unknown as WebGL2RenderingContext;
}
afterEach(() => { loaded.length = 0; vi.unstubAllGlobals(); });

describe("background gallery texture lifetime", () => {
  it("evicts old 4K images, retains the current image, and can reload an evicted one", async () => {
    vi.stubGlobal("Image", FakeImage);
    const cache = new BackgroundTextureCache(), gl = fakeGl();
    const load = async (url: string) => { const ready = cache.preload(gl, url); loaded.shift()?.(); await ready; };
    await load("a"); await load("b"); await load("c");
    const current = cache.get(gl, "a");
    await load("d");
    expect(cache.get(gl, "a")).toBe(current);
    expect(cache.sizeOf("b")).toBeNull();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    await load("b");
    expect(cache.sizeOf("b")).toEqual({ w: 3840, h: 2160 });
    expect(gl.createTexture).toHaveBeenCalledTimes(5);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    cache.dispose(gl);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(5);
  });
  it("does not upload a late image after the editor has closed", async () => {
    vi.stubGlobal("Image", FakeImage);
    const cache = new BackgroundTextureCache(), gl = fakeGl();
    const ready = cache.preload(gl, "slow");
    cache.dispose(gl); loaded.shift()?.(); await ready;
    expect(gl.createTexture).not.toHaveBeenCalled();
    expect(cache.get(gl, "slow")).toBeNull();
  });
});
