import { hexToRgb } from "./color";

export type Hsv = { h: number; s: number; v: number };
export type Rgb255 = [number, number, number];
export const bounded = (n: number, max: number): number => Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;

export function rgbHex(rgb: Rgb255): string {
  return `#${rgb.map(n => Math.round(bounded(n, 255)).toString(16).padStart(2, "0")).join("")}`;
}
export function colorRgb(hex: string): Rgb255 {
  return hexToRgb(hex).map(n => Math.round(n * 255)) as Rgb255;
}
export function pickerHex(text: string): string | null {
  const trimmed = text.trim();
  return /^#?(?:[\da-f]{3}|[\da-f]{6})$/i.test(trimmed) ? rgbHex(colorRgb(trimmed)) : null;
}
export function hsvRgb({ h, s, v }: Hsv): Rgb255 {
  const hue = bounded(h, 360) / 60;
  const saturation = bounded(s, 100) / 100;
  const value = bounded(v, 100) / 100;
  const c = value * saturation;
  const x = c * (1 - Math.abs(hue % 2 - 1));
  const m = value - c;
  const sectors: Rgb255[] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  return (sectors[Math.floor(hue) % 6] ?? [c, x, 0]).map(n => Math.round((n + m) * 255)) as Rgb255;
}
/** Retain the last hue on gray, and saturation on black, so those can be edited back into color. */
export function rgbHsv(rgb: Rgb255, previous: Hsv = { h: 0, s: 0, v: 0 }): Hsv {
  const [r, g, b] = rgb.map(n => bounded(n, 255) / 255) as Rgb255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = previous.h;
  if (delta) {
    h = max === r ? 60 * ((g - b) / delta % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
    if (h < 0) h += 360;
  }
  return { h, s: max ? delta / max * 100 : previous.s, v: max * 100 };
}
