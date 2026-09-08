import { describe, expect, it } from "vitest";
import { REQUIRED_CAPTURE_FILTERS } from "./ffmpeg";

/**
 * Regression guard for 2026-09-08.
 *
 * ffmpeg-static's 6.1.1 "essentials" build was bundled after probing only for
 * `ddagrab`. It has ddagrab and does NOT have scale_d3d11, so capture broke on
 * a machine where it had been working, and said so only as "capture produced
 * no frame within 10s" ten seconds after the hotkey.
 *
 * The capture filter chain is the contract, not one filter in it.
 */
describe("REQUIRED_CAPTURE_FILTERS", () => {
  it("lists every filter the capture chain uses", () => {
    // Keep in step with buildCaptureArgs in ScreenSource.ts.
    expect([...REQUIRED_CAPTURE_FILTERS]).toEqual(["ddagrab", "scale_d3d11"]);
  });

  it("includes scale_d3d11, which the essentials builds lack", () => {
    expect(REQUIRED_CAPTURE_FILTERS).toContain("scale_d3d11");
  });
});
