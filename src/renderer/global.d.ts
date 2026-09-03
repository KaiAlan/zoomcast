import type { ZoomcastApi } from "../shared/api";

declare global {
  interface Window {
    zoomcast: ZoomcastApi;
    /** Test hooks installed by the editor; see tools/verify-parity.ts. */
    __zc?: {
      renderAt: (tOutputMs: number) => Promise<string>;
      exportTo: (outFile: string) => Promise<void>;
    };
  }
}

export {};
