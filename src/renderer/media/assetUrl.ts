/**
 * Resolve a file inside a bundle to a URL the renderer can actually load.
 *
 * A `file://` page cannot fetch a custom scheme at all — Chromium rejects it
 * before the handler runs, so CORS headers do not help — which is why the app
 * is served from `zc://app` and disk media is addressed as `zc://app/@fs/`.
 *
 * This exists as one function rather than an expression at each call site
 * because there are two `drawFrame` call sites, preview and export, and a
 * visual feature wired into only one of them is this project's most repeated
 * bug.
 */
export function bundleAssetUrl(dir: string, file: string | null): string | undefined {
  if (file === null || file === "") return undefined;
  return `zc://app/@fs/${dir.replace(/\\/g, "/")}/${file}`;
}
