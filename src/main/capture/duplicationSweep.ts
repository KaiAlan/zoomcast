/**
 * Which adapter and output can Desktop Duplication actually be opened on?
 *
 * Pure logic, kept out of ScreenSource so it can be tested without ffmpeg or
 * Electron. The 2026-09-08 investigation is the reason it exists at all:
 * `probeBackend` hardcoded `output_idx=0`, was called with a single hardcoded
 * adapter index, and swallowed the error with `catch { return "gdigrab" }`.
 * Every take on that machine was captured through the CPU-bound GDI fallback
 * and nothing in the logs said why.
 */

export type DuplicationPair = { adapterIndex: number; outputIndex: number };

/**
 * What one ddagrab probe said.
 *
 * The three failure kinds are distinguishable from stderr and mean different
 * things for the sweep: a missing adapter ends it, a missing output ends this
 * adapter, and a refusal is specific to one output and worth recording.
 */
export type ProbeOutcome =
  | { kind: "ok" }
  | { kind: "no-adapter" }
  | { kind: "no-output" }
  | { kind: "refused"; detail: string };

/**
 * ffmpeg's own wording. `Failed to create Direct3D device` is DXGI_ERROR_NOT_FOUND
 * from EnumAdapters — the index is past the end. `Failed to enumerate DXGI output`
 * is the same, one level down. Anything else got as far as DuplicateOutput and
 * was turned down, which is a property of that output rather than of the index.
 */
export function classifyProbe(exitCode: number | null, stderr: string): ProbeOutcome {
  if (exitCode === 0) return { kind: "ok" };
  if (/Failed to create Direct3D device/i.test(stderr)) return { kind: "no-adapter" };
  if (/Failed to enumerate DXGI output/i.test(stderr)) return { kind: "no-output" };

  const detail =
    /\[Parsed_ddagrab[^\]]*\]\s*(.+)/.exec(stderr)?.[1]?.trim() ??
    stderr.trim().split("\n").at(-1)?.trim() ??
    `exit ${exitCode}`;

  return { kind: "refused", detail };
}

export type SweepResult = {
  pair: DuplicationPair | null;
  /** Every output that existed and still refused, for the diagnostic log. */
  refusals: string[];
};

/**
 * Walk adapters and their outputs until one duplicates.
 *
 * Both index spaces are contiguous, so a missing index is the end of that loop
 * rather than a hole to step over — which is what keeps this to a handful of
 * probes instead of a fixed grid.
 */
export async function sweepDuplication(
  probe: (adapterIndex: number, outputIndex: number) => Promise<ProbeOutcome>,
  limits: { maxAdapters?: number; maxOutputs?: number } = {},
): Promise<SweepResult> {
  const maxAdapters = limits.maxAdapters ?? 8;
  const maxOutputs = limits.maxOutputs ?? 8;
  const refusals: string[] = [];

  for (let adapterIndex = 0; adapterIndex < maxAdapters; adapterIndex += 1) {
    let adapterMissing = false;

    for (let outputIndex = 0; outputIndex < maxOutputs; outputIndex += 1) {
      const outcome = await probe(adapterIndex, outputIndex);

      if (outcome.kind === "ok") {
        return { pair: { adapterIndex, outputIndex }, refusals };
      }
      if (outcome.kind === "no-adapter") {
        adapterMissing = true;
        break;
      }
      if (outcome.kind === "no-output") break;

      refusals.push(`dx:${adapterIndex} output ${outputIndex}: ${outcome.detail}`);
    }

    if (adapterMissing) break;
  }

  return { pair: null, refusals };
}
