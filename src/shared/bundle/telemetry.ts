import type { TelemetryEvent } from "./types";

/**
 * Parse an `input.jsonl` telemetry stream.
 *
 * Malformed lines are skipped rather than thrown on: a crash mid-recording
 * leaves a half-written final line, and a parser that threw would make every
 * crashed recording unopenable.
 */
export function parseTelemetry(text: string): TelemetryEvent[] {
  const out: TelemetryEvent[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (typeof value !== "object" || value === null) continue;

    const e = value as Record<string, unknown>;
    if (typeof e.t !== "number" || typeof e.k !== "string") continue;

    out.push(e as unknown as TelemetryEvent);
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}
