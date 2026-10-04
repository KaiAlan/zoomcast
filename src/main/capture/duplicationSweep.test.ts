import { describe, expect, it, vi } from "vitest";
import { classifyProbe, sweepDuplication, type ProbeOutcome } from "./duplicationSweep";

/** The exact stderr this machine produced on 2026-09-08. */
const NO_ADAPTER = "[D3D11VA @ 0x1] Failed to create Direct3D device (887a0004)";
const NO_OUTPUT = "[Parsed_ddagrab_0 @ 0x1] Failed to enumerate DXGI output 0";
const REFUSED = "[Parsed_ddagrab_0 @ 0x1] Selected output not supported";

describe("classifyProbe", () => {
  it("reads exit 0 as a working pair", () => {
    expect(classifyProbe(0, "")).toEqual({ kind: "ok" });
  });

  it("distinguishes a missing adapter from a missing output", () => {
    expect(classifyProbe(1, NO_ADAPTER)).toEqual({ kind: "no-adapter" });
    expect(classifyProbe(1, NO_OUTPUT)).toEqual({ kind: "no-output" });
  });

  it("treats a refusal as specific to that output, and keeps the wording", () => {
    expect(classifyProbe(1, REFUSED)).toEqual({
      kind: "refused",
      detail: "Selected output not supported",
    });
  });

  it("still reports something when ffmpeg fails in an unfamiliar way", () => {
    const outcome = classifyProbe(1, "some other disaster");
    expect(outcome.kind).toBe("refused");
  });
});

const ok = async (): Promise<ProbeOutcome> => ({ kind: "ok" });

describe("sweepDuplication", () => {
  it("returns the first pair that duplicates", async () => {
    const probe = vi.fn(
      async (a: number, o: number): Promise<ProbeOutcome> =>
        a === 1 && o === 2 ? { kind: "ok" } : { kind: "refused", detail: "no" },
    );

    const { pair } = await sweepDuplication(probe, { maxAdapters: 3, maxOutputs: 3 });

    expect(pair).toEqual({ adapterIndex: 1, outputIndex: 2 });
  });

  it("stops probing an adapter once its outputs run out", async () => {
    const probe = vi.fn(
      async (a: number, o: number): Promise<ProbeOutcome> =>
        a === 0 && o === 0 ? { kind: "no-output" } : { kind: "ok" },
    );

    const { pair } = await sweepDuplication(probe, { maxAdapters: 2, maxOutputs: 8 });

    // dx:0 output 0 says there are no outputs, so dx:0 output 1..7 is skipped.
    expect(pair).toEqual({ adapterIndex: 1, outputIndex: 0 });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("stops entirely once the adapters run out", async () => {
    const probe = vi.fn(async (): Promise<ProbeOutcome> => ({ kind: "no-adapter" }));

    const { pair } = await sweepDuplication(probe, { maxAdapters: 8, maxOutputs: 8 });

    expect(pair).toBeNull();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("keeps every refusal, which is the diagnostic the old probe threw away", async () => {
    const probe = async (a: number, o: number): Promise<ProbeOutcome> =>
      a === 0 && o === 0
        ? { kind: "refused", detail: "Selected output not supported" }
        : { kind: "no-output" };

    const { pair, refusals } = await sweepDuplication(probe, {
      maxAdapters: 1,
      maxOutputs: 4,
    });

    expect(pair).toBeNull();
    expect(refusals).toEqual(["dx:0 output 0: Selected output not supported"]);
  });

  it("reproduces the 2026-09-08 hybrid-graphics machine", async () => {
    // dx:0 is the NVIDIA once Optimus has rewritten enumeration: it owns the
    // output but will not duplicate it. dx:1 is the AMD that actually
    // composites the desktop and reports no outputs at all.
    const probe = async (a: number, o: number): Promise<ProbeOutcome> => {
      if (a >= 2) return { kind: "no-adapter" };
      if (a === 0 && o === 0) return { kind: "refused", detail: "Selected output not supported" };
      return { kind: "no-output" };
    };

    const { pair, refusals } = await sweepDuplication(probe);

    expect(pair).toBeNull();
    expect(refusals).toEqual(["dx:0 output 0: Selected output not supported"]);
  });

  it("takes dx:0 output 0 when the machine is healthy", async () => {
    expect((await sweepDuplication(ok)).pair).toEqual({ adapterIndex: 0, outputIndex: 0 });
  });
});
