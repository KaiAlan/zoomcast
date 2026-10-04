import type { MessagePortMain } from "electron";

/** Bound the port to one export and never acknowledge data before stdin consumes it. */
export class ExportFrameStream {
  private sequence = 0;
  private writing = false;
  private closed = false;

  constructor(
    private readonly port: MessagePortMain,
    frameBytes: number,
    write: (frame: Uint8Array) => Promise<void>,
    disconnected: (reason: Error) => void,
  ) {
    port.on("close", () => {
      if (this.closed) return;
      this.closed = true;
      disconnected(new Error("export frame channel disconnected"));
    });
    port.on("message", event => {
      if (this.closed) return;
      const data = event.data;
      if (this.writing || data?.sequence !== this.sequence || !(data.frame instanceof Uint8Array) || data.frame.byteLength !== frameBytes) {
        const error = new Error("invalid or overlapping export frame");
        port.postMessage({ sequence: this.sequence, error: error.message });
        this.close();
        disconnected(error);
        return;
      }
      this.writing = true;
      void write(data.frame).then(() => {
        if (this.closed) return;
        this.writing = false;
        port.postMessage({ sequence: this.sequence++ });
      }, error => {
        if (this.closed) return;
        const reason = error instanceof Error ? error : new Error(String(error));
        port.postMessage({ sequence: this.sequence, error: reason.message });
        this.close();
        disconnected(reason);
      });
    });
    port.start();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.port.close();
  }
}
