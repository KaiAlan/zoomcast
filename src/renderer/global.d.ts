import type { ZoomcastApi } from "../shared/api";

declare global {
  interface Window {
    zoomcast: ZoomcastApi;
    /** Test hooks installed by the editor; see tools/verify-parity.ts. */
    __zc?: {
      renderAt: (tOutputMs: number) => Promise<string>;
      benchDecode: (sequential: boolean) => Promise<{ frames: number; elapsedMs: number }>;
      exportUI: (outFile: string) => Promise<void>;
      exportTo: (outFile: string) => Promise<void>;
      /** Play for a while and report what the preview actually achieved. */
      benchPreview: (ms: number) => Promise<{
        frames: number;
        seconds: number;
        fps: number;
        p50DeltaMs: number;
        p95DeltaMs: number;
        worstDeltaMs: number;
        droppedTicks: number;
      }>;
    };
  }
}
