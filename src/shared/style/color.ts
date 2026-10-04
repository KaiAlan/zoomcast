/**
 * Hex colour parsing for the renderer's uniforms.
 *
 * Lives in `src/shared/` rather than beside the GL code so it can be tested in
 * plain node — the values it produces go straight into `uniform3f`/`uniform4f`,
 * where a NaN is undefined behaviour rather than a wrong colour, and the style
 * panel feeds it every partial string a user types.
 */

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

const HEX = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** The digits of a valid colour, expanded to 6 or 8, or null if malformed. */
function digits(hex: string): string | null {
  if (!HEX.test(hex)) return null;

  const h = hex.replace("#", "");
  return h.length === 3
    ? h
        .split("")
        .map((c) => c + c)
        .join("")
    : h;
}

/** Black when malformed — a visible, stable colour rather than a NaN uniform. */
export function hexToRgb(hex: string): Rgb {
  const full = digits(hex);
  if (full === null) return [0, 0, 0];

  const n = Number.parseInt(full.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Fully transparent when malformed, so a half-typed border colour makes the
 * border vanish for a keystroke instead of painting a black ring over the
 * frame's rounded edge.
 */
export function hexToRgba(hex: string): Rgba {
  const full = digits(hex);
  if (full === null) return [0, 0, 0, 0];

  const [r, g, b] = hexToRgb(hex);
  const a = full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1;
  return [r, g, b, a];
}
