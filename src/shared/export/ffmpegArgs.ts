import { normalizeCuts } from "../project/cuts";
import type { Cut } from "../project/types";

export type AudioInput = {
  file: string;
  gainDb: number;
  startOffsetMs: number;
};

export type ExportArgsOptions = {
  width: number;
  height: number;
  fps: number;
  bitrateMbps: number;
  encoder: string;
  durationMs: number;
  cuts: Cut[];
  audio: AudioInput[];
  syncNudgeMs: number;
  outFile: string;
};

/** Spans of source time that survive the cuts, in seconds. `null` end = to EOF. */
function keptSpans(
  durationMs: number,
  cuts: Cut[],
): Array<[number, number | null]> {
  const spans: Array<[number, number | null]> = [];
  let cursor = 0;

  for (const c of normalizeCuts(cuts, durationMs)) {
    if (c.startMs > cursor) spans.push([cursor / 1000, c.startMs / 1000]);
    cursor = c.endMs;
  }

  spans.push([cursor / 1000, null]);
  return spans;
}

/**
 * Build the filter chain for one audio input.
 *
 * `asplit` is mandatory before multiple `atrim`s: a filter output pad may be
 * consumed only once, so `[1:a]` cannot feed three trims directly.
 */
function audioChain(
  inputIndex: number,
  a: AudioInput,
  spans: Array<[number, number | null]>,
  label: string,
): string[] {
  const src = `${inputIndex}:a`;

  if (spans.length === 1) {
    return [`[${src}]volume=${a.gainDb}dB[${label}]`];
  }

  const parts: string[] = [];
  const splitLabels = spans.map((_, i) => `${label}s${i}`);
  const trimLabels = spans.map((_, i) => `${label}t${i}`);

  parts.push(
    `[${src}]asplit=${spans.length}${splitLabels.map((l) => `[${l}]`).join("")}`,
  );

  spans.forEach(([start, end], i) => {
    const trim =
      end === null ? `atrim=start=${start}` : `atrim=start=${start}:end=${end}`;
    parts.push(`[${splitLabels[i]}]${trim},asetpts=PTS-STARTPTS[${trimLabels[i]}]`);
  });

  parts.push(
    `${trimLabels.map((l) => `[${l}]`).join("")}concat=n=${spans.length}:v=0:a=1[${label}c]`,
  );
  parts.push(`[${label}c]volume=${a.gainDb}dB[${label}]`);

  return parts;
}

export function buildExportArgs(o: ExportArgsOptions): string[] {
  const args: string[] = [
    "-y",
    "-hide_banner",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${o.width}x${o.height}`,
    "-r",
    String(o.fps),
    "-i",
    "pipe:0",
  ];

  // -itsoffset shifts each audio input onto the source timeline, so the atrim
  // filters below can work in plain source time. Same sign convention as
  // toStreamLocalMs: startOffsetMs is how much LATER this stream started.
  for (const a of o.audio) {
    const delaySec = (a.startOffsetMs - o.syncNudgeMs) / 1000;
    args.push("-itsoffset", String(delaySec), "-i", a.file);
  }

  if (o.audio.length > 0) {
    const spans = keptSpans(o.durationMs, o.cuts);
    const graph: string[] = [];
    const labels: string[] = [];

    o.audio.forEach((a, i) => {
      const label = `a${i}`;
      graph.push(...audioChain(i + 1, a, spans, label));
      labels.push(`[${label}]`);
    });

    graph.push(
      o.audio.length > 1
        ? `${labels.join("")}amix=inputs=${o.audio.length}:duration=longest:normalize=0[aout]`
        : `${labels[0]}anull[aout]`,
    );

    args.push("-filter_complex", graph.join(";"));
    args.push("-map", "0:v", "-map", "[aout]");
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-map", "0:v");
  }

  args.push(
    // The canvas hands over sRGB RGBA. Left to itself swscale converts to YUV
    // with BT.601 coefficients and writes no colour tags, so players — which
    // assume BT.709 for HD — decoded the chroma slightly wrong and the export
    // no longer matched the preview. Convert with 709 and tag it as such.
    //
    // The tags ride on the frames (setparams), not on -colorspace and
    // friends: on ffmpeg 9 the encoder takes colour from the frames it is
    // handed, and those output options left primaries and transfer "unknown"
    // for both libx264 and h264_amf. Measured 2026-09-26.
    //
    // A plain -vf is legal here: the video is mapped straight from input 0
    // and is not a -filter_complex output.
    "-vf",
    "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p," +
      "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv",
    "-c:v",
    o.encoder,
    "-b:v",
    `${o.bitrateMbps}M`,
    "-pix_fmt",
    "yuv420p",
    o.outFile,
  );

  return args;
}
