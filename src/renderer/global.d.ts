import type { ZoomcastApi } from "../shared/api";

declare global {
  interface Window {
    zoomcast: ZoomcastApi;
  }
}

export {};
