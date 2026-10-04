/**
 * Generate build/icon.ico.
 *
 * Drawn rather than vendored, for the same reason the tray icon is: there is
 * no design asset to ship, and a checked-in binary nobody can regenerate is
 * worse than sixty lines that produce it. Pure node — zlib is enough to write
 * a PNG, and an .ico is just PNGs behind a small index.
 *
 * Run: npm run icon
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Rendered at 4x and box-filtered down, which is all the antialiasing we need. */
const SS = 4;
const SIZES = [16, 24, 32, 48, 64, 128, 256];

type RGB = [number, number, number];

const INK: RGB = [232, 232, 234];
const GROUND: RGB = [23, 23, 26];
const RECORD: RGB = [229, 72, 77];

/** Signed distance to a rounded rectangle centred on the origin. */
function roundedRect(x: number, y: number, halfW: number, halfH: number, r: number): number {
  const dx = Math.abs(x) - (halfW - r);
  const dy = Math.abs(y) - (halfH - r);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

/** One L-shaped corner bracket: two arms meeting at (cx, cy). */
function bracket(
  x: number,
  y: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const arm = 0.19;
  const t = 0.036;

  const horizontal = roundedRect(x - (cx + (dx * arm) / 2), y - cy, arm / 2, t, t);
  const vertical = roundedRect(x - cx, y - (cy + (dy * arm) / 2), t, arm / 2, t);

  return Math.min(horizontal, vertical);
}

/**
 * A recording frame: two corner brackets around a record dot. The brackets
 * carry the "zoom" idea and survive being shrunk to 16px far better than a
 * magnifier does, because they stay near the edges where there are pixels.
 */
function shade(px: number, py: number, n: number): [RGB, number] {
  // Work in a -0.5..0.5 square so the drawing is resolution-independent.
  const x = px / n - 0.5;
  const y = py / n - 0.5;

  if (roundedRect(x, y, 0.5, 0.5, 0.18) > 0) return [GROUND, 0];

  if (Math.hypot(x, y) <= 0.11) return [RECORD, 1];

  const corner = Math.min(
    bracket(x, y, -0.29, -0.29, 1, 1),
    bracket(x, y, 0.29, 0.29, -1, -1),
  );

  if (corner <= 0) return [INK, 1];

  return [GROUND, 1];
}

function render(n: number): Buffer {
  const big = n * SS;
  const out = Buffer.alloc(n * n * 4);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [c, alpha] = shade(x * SS + sx + 0.5, y * SS + sy + 0.5, big);
          r += c[0] * alpha;
          g += c[1] * alpha;
          b += c[2] * alpha;
          a += alpha;
        }
      }

      const n2 = SS * SS;
      const i = (y * n + x) * 4;
      out[i] = a > 0 ? Math.round(r / a) : 0;
      out[i + 1] = a > 0 ? Math.round(g / a) : 0;
      out[i + 2] = a > 0 ? Math.round(b / a) : 0;
      out[i + 3] = Math.round((a / n2) * 255);
    }
  }

  return out;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(rgba: Buffer, n: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0;
    rgba.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ico(images: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;

  images.forEach((img, i) => {
    const at = i * 16;
    dir[at] = img.size === 256 ? 0 : img.size; // 0 means 256
    dir[at + 1] = img.size === 256 ? 0 : img.size;
    dir[at + 2] = 0; // palette
    dir[at + 3] = 0;
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(img.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += img.data.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

const images = SIZES.map((size) => ({ size, data: png(render(size), size) }));
const out = join(process.cwd(), "build", "icon.ico");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, ico(images));

// A 512px PNG too: electron-builder wants one for any non-Windows target, and
// it is the only way to actually look at the thing.
writeFileSync(join(process.cwd(), "build", "icon.png"), png(render(512), 512));

console.log(`wrote ${out} (${SIZES.join(", ")}px) and build/icon.png`);
