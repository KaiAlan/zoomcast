import { describe, expect, it } from "vitest";
import { REQUIRED_CAPTURE_FILTERS } from "./ffmpeg";

/**
 * Regression guard for 2026-09-08.
 *
 * ffmpeg-static's 6.1.1 "essentials" build was bundled after probing only for
 * `ddagrab`. It has ddagrab and did NOT have `scale_d3d11`, which the chain
 * used at the time, so capture broke on a machine where it had been working,
 * and said so only as "capture produced no frame within 10s" ten seconds after
 * the hotkey.
 *
 * The capture filter chain is the contract, not one filter in it. That is still
 * the point, even though the chain no longer uses scale_d3d11.
 */
describe("REQUIRED_CAPTURE_FILTERS", () => {
  it("lists every filter the capture chain uses", () => {
    // Keep in step with buildCaptureArgs in capture/ScreenSource.ts.
    expect([...REQUIRED_CAPTURE_FILTERS]).toEqual(["ddagrab", "hwdownload", "format"]);
  });

  it("no longer demands scale_d3d11, which fails on AMD integrated graphics", () => {
    expect(REQUIRED_CAPTURE_FILTERS).not.toContain("scale_d3d11");
  });
});
