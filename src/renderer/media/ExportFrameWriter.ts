/** One frame at a time, with an acknowledgement only after the encoder write. */
export class ExportFrameWriter {
  private sequence = 0;
  private pending?: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private stopped?: Error;

  constructor(private readonly port: MessagePort) {
    port.onmessage = event => {
      if (!this.pending || event.data?.sequence !== this.sequence) {
        this.fail(new Error("unexpected export frame acknowledgement"));
        return;
      }
      if (typeof event.data.error === "string") {
        this.fail(new Error(event.data.error));
        return;
      }
      const pending = this.pending;
      this.pending = undefined;
      clearTimeout(pending.timer);
      this.sequence++;
      pending.resolve();
    };
    port.onmessageerror = () => this.fail(new Error("export frame message could not be decoded"));
    port.addEventListener("close", () => this.fail(new Error("export frame channel closed")));
    port.start();
  }

  write(frame: Uint8Array): Promise<void> {
    if (this.stopped) return Promise.reject(this.stopped);
    if (this.pending) return Promise.reject(new Error("an export frame is already being written"));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("export encoder frame write timed out")), 30_000);
      this.pending = { resolve, reject, timer };
      try {
        // Structured clone snapshots the buffer before postMessage returns.
        // Main owns that snapshot while the page reuses its readback buffer for
        // the next frame. The large array never crosses contextBridge.
        this.port.postMessage({ sequence: this.sequence, frame });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  close(): void {
    this.fail(new Error("export frame writer closed"));
  }

  private fail(error: Error): void {
    if (this.stopped) return;
    this.stopped = error;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
    this.port.close();
  }
}

/** Receive a dedicated port via preload; only the small request uses the bridge. */
export function openExportFrameWriter(id: string): Promise<ExportFrameWriter> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
    const receive = (event: MessageEvent): void => {
      if (event.source !== window || event.data?.type !== "zoomcast:export-port" || event.data.id !== id) return;
      const port = event.ports[0];
      cleanup();
      if (!port) { reject(new Error("export frame port missing")); return; }
      resolve(new ExportFrameWriter(port));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("export frame channel setup timed out")); }, 10_000);
    window.addEventListener("message", receive);
    void window.zoomcast.exportConnect(id).catch(error => { cleanup(); reject(error); });
  });
}
