import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportFrameWriter } from "./ExportFrameWriter";

class Port extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  start = vi.fn();
  receive(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
}
const frame = new Uint8Array([1, 2, 3, 4]);
const setup = () => {
  const port = new Port();
  return { port, writer: new ExportFrameWriter(port as unknown as MessagePort) };
};
afterEach(() => vi.useRealTimers());

describe("export frame writer", () => {
  it("snapshots pixels before the renderer reuses the readback buffer", async () => {
    const { port1, port2 } = new MessageChannel();
    const writer = new ExportFrameWriter(port1 as unknown as MessagePort);
    const pixels = new Uint8Array([1, 2, 3, 4]);
    const received = new Promise<{ sequence: number; frame: Uint8Array }>(resolve => port2.once("message", resolve));
    const written = writer.write(pixels);
    void written.catch(() => undefined);
    try {
      pixels.fill(99);
      const message = await received;
      expect([...message.frame]).toEqual([1, 2, 3, 4]);
      expect(message.frame.buffer).not.toBe(pixels.buffer);
      port2.postMessage({ sequence: message.sequence });
      await written;
    } finally {
      writer.close();
      port2.close();
    }
  });

  it("waits for acknowledgement before sending another frame", async () => {
    const { port, writer } = setup();
    const resolved = vi.fn();
    const first = writer.write(frame).then(resolved);
    expect(port.postMessage).toHaveBeenCalledWith({ sequence: 0, frame });
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    await expect(writer.write(frame)).rejects.toThrow("already being written");
    port.receive({ sequence: 0 });
    await first;
    const next = new Uint8Array([9, 2, 3, 4]);
    const second = writer.write(next);
    expect(port.postMessage).toHaveBeenLastCalledWith({ sequence: 1, frame: next });
    port.receive({ sequence: 1 });
    await second;
    writer.close();
  });

  it("propagates encoder failures and rejects subsequent writes", async () => {
    const { port, writer } = setup();
    const pending = expect(writer.write(frame)).rejects.toThrow("broken pipe");
    port.receive({ sequence: 0, error: "broken pipe" });
    await pending;
    await expect(writer.write(frame)).rejects.toThrow("broken pipe");
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("rejects an out-of-order acknowledgement", async () => {
    const { port, writer } = setup();
    const pending = expect(writer.write(frame)).rejects.toThrow("unexpected");
    port.receive({ sequence: 1 });
    await pending;
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("rejects a pending write if the other end disconnects", async () => {
    const { port, writer } = setup();
    const pending = expect(writer.write(frame)).rejects.toThrow("channel closed");
    port.dispatchEvent(new Event("close"));
    await pending;
  });

  it("bounds the wait if the encoder stops responding", async () => {
    vi.useFakeTimers();
    const { writer } = setup();
    const pending = expect(writer.write(frame)).rejects.toThrow("timed out");
    vi.advanceTimersByTime(30_000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects serialization errors without leaving a timer or outstanding frame", async () => {
    vi.useFakeTimers();
    const { port, writer } = setup();
    port.postMessage.mockImplementationOnce(() => { throw new Error("cannot serialize"); });
    await expect(writer.write(frame)).rejects.toThrow("cannot serialize");
    expect(vi.getTimerCount()).toBe(0);
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("closing a writer rejects its outstanding write and is idempotent", async () => {
    const { port, writer } = setup();
    const pending = expect(writer.write(frame)).rejects.toThrow("writer closed");
    writer.close();
    writer.close();
    await pending;
    expect(port.close).toHaveBeenCalledOnce();
  });
});
