import { EventEmitter } from "node:events";
import type { MessagePortMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import { ExportFrameStream } from "./exportFrameStream";

class Port extends EventEmitter {
  postMessage = vi.fn();
  close = vi.fn(() => this.emit("close"));
  start = vi.fn();
  receive(data: unknown): void { this.emit("message", { data }); }
}
const frame = new Uint8Array([1, 2, 3, 4]);
const setup = (write: (frame: Uint8Array) => Promise<void> = async () => {}) => {
  const port = new Port();
  const disconnected = vi.fn();
  const stream = new ExportFrameStream(port as unknown as MessagePortMain, 4, write, disconnected);
  return { port, stream, disconnected };
};

describe("export frame stream", () => {
  it("acknowledges only after the encoder consumes each frame, in order", async () => {
    let consume: (() => void) | undefined;
    const write = vi.fn(() => new Promise<void>(resolve => { consume = resolve; }));
    const { port, stream } = setup(write);
    port.receive({ sequence: 0, frame });
    expect(write).toHaveBeenCalledWith(frame);
    expect(port.postMessage).not.toHaveBeenCalled();
    consume?.();
    await Promise.resolve();
    expect(port.postMessage).toHaveBeenLastCalledWith({ sequence: 0 });
    port.receive({ sequence: 1, frame });
    consume?.();
    await Promise.resolve();
    expect(port.postMessage).toHaveBeenLastCalledWith({ sequence: 1 });
    stream.close();
  });

  it.each([
    { sequence: 1, frame },
    { sequence: 0, frame: new Uint8Array(3) },
    { sequence: 0, frame: [1, 2, 3, 4] },
    null,
  ])("rejects malformed or out-of-order frames before writing", async data => {
    const write = vi.fn(async () => {});
    const { port, disconnected } = setup(write);
    port.receive(data);
    expect(write).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledWith({ sequence: 0, error: expect.stringContaining("invalid or overlapping export frame") });
    expect(disconnected).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("rejects overlapping writes and ignores completion after cancellation", async () => {
    let consume: (() => void) | undefined;
    const write = vi.fn(() => new Promise<void>(resolve => { consume = resolve; }));
    const { port, disconnected } = setup(write);
    port.receive({ sequence: 0, frame });
    port.receive({ sequence: 1, frame });
    expect(write).toHaveBeenCalledOnce();
    consume?.();
    await Promise.resolve();
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it("reports encoder failure and tears down the session", async () => {
    const { port, disconnected } = setup(async () => { throw new Error("encoder stopped"); });
    port.receive({ sequence: 0, frame });
    await Promise.resolve();
    expect(port.postMessage).toHaveBeenCalledWith({ sequence: 0, error: "encoder stopped" });
    expect(disconnected).toHaveBeenCalledWith(expect.objectContaining({ message: "encoder stopped" }));
    expect(disconnected).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("remote disconnect triggers cleanup once", () => {
    const { port, disconnected } = setup();
    port.emit("close");
    port.emit("close");
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it("normal completion closes the port without cancelling the finished export", () => {
    const { port, stream, disconnected } = setup();
    stream.close();
    stream.close();
    expect(port.close).toHaveBeenCalledOnce();
    expect(disconnected).not.toHaveBeenCalled();
  });
});
