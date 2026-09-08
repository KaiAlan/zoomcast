/**
 * Parse an HTTP Range header against a known file size.
 *
 * Exists because Chromium's media stack seeks by issuing Range requests: a
 * <video> pointed at a range-less URL must buffer the whole file before
 * seeking behaves. The zc:// handler ignored Range entirely, which was
 * invisible while VideoSource read whole files into an ArrayBuffer and became
 * load-bearing the moment the preview moved to a media element.
 *
 * `null`          -> no usable range was asked for; serve the whole file, 200.
 * "unsatisfiable" -> the client asked for bytes that do not exist; reply 416.
 */
export type ByteRange = { start: number; end: number };

export function resolveByteRange(
  header: string | undefined,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (header === undefined || header.trim() === "") return null;

  // Single byte ranges only. A multi-range reply needs multipart/byteranges,
  // which no media element asks for and which is easy to get subtly wrong —
  // so an unrecognised form falls back to serving the whole file rather than
  // serving the wrong bytes.
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (match === null) return null;

  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";
  if (rawStart === "" && rawEnd === "") return null;
  if (size <= 0) return "unsatisfiable";

  // Suffix form: `bytes=-500` means "the last 500 bytes", not "up to 500".
  if (rawStart === "") {
    const suffix = Number.parseInt(rawEnd, 10);
    if (Number.isNaN(suffix) || suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  if (Number.isNaN(start) || start < 0 || start >= size) return "unsatisfiable";

  if (rawEnd === "") return { start, end: size - 1 };

  const end = Number.parseInt(rawEnd, 10);
  if (Number.isNaN(end) || end < start) return "unsatisfiable";

  return { start, end: Math.min(end, size - 1) };
}
