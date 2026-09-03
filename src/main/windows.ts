import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Path to the built preload script.
 *
 * This lives in one place because the source tree and the build output do not
 * have the same shape: everything under `src/main/**` bundles down into
 * `out/main/index.js`, so a module nested one level deeper in source must still
 * resolve the preload as `../preload`. Computing it per-file gets that wrong,
 * and the symptom is a window where `window.zoomcast` is silently undefined.
 */
export function preloadPath(): string {
  return join(here, "../preload/index.mjs");
}

/** The renderer entry, honouring the dev server when one is running. */
export function rendererUrl(route = ""): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  return devUrl === undefined ? `zc://app/index.html${route}` : `${devUrl}${route}`;
}
