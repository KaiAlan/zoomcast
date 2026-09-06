import type { ExportArgsOptions } from "./ffmpegArgs";

/** Keep the log line bounded; ffmpeg's real error is always at the end. */
const MAX_STDERR_CHARS = 2000;

/**
 * One line describing everything an export was made from.
 *
 * This exists because the app used to record nothing about an export. When a
 * real export produced a truncated file on 2026-09-05, the only surviving
 * evidence was the user's memory: `runExport` put the failure into React state
 * and nowhere else, and the bundle carried no project.json, so the settings
 * that produced the file were gone.
 *
 * The output path is deliberately omitted. It is chosen by the user, can carry
 * a real name, and says nothing about why an export behaved as it did.
 */
export function formatExportStart(o: ExportArgsOptions): string {
  const offsets = o.audio.map((a) => a.startOffsetMs).join(",");

  return [
    `encoder=${o.encoder}`,
    `${o.width}x${o.height}@${o.fps}`,
    `bitrate=${o.bitrateMbps}M`,
    `durationMs=${o.durationMs}`,
    `cuts=${o.cuts.length}`,
    `audio=${o.audio.length}`,
    `offsets=${offsets}`,
    `syncNudgeMs=${o.syncNudgeMs}`,
  ].join(" ");
}

/** The reason a session was cancelled, with whatever ffmpeg last said. */
export function formatExportFailure(reason: string, stderrTail: string): string {
  const tail =
    stderrTail.length > MAX_STDERR_CHARS
      ? stderrTail.slice(stderrTail.length - MAX_STDERR_CHARS)
      : stderrTail;

  return tail === "" ? reason : `${reason}\nffmpeg stderr (tail):\n${tail}`;
}
