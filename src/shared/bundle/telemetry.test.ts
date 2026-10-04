import { describe, expect, it } from "vitest";
import { parseTelemetry } from "./telemetry";

describe("parseTelemetry", () => {
  it("parses one event per line", () => {
    const text = [
      '{"t":100,"k":"move","x":10,"y":20}',
      '{"t":200,"k":"down","x":10,"y":20,"b":1}',
    ].join("\n");
    expect(parseTelemetry(text)).toHaveLength(2);
  });

  it("skips blank lines", () => {
    const text = '\n{"t":100,"k":"move","x":1,"y":2}\n\n';
    expect(parseTelemetry(text)).toHaveLength(1);
  });

  it("skips a truncated final line", () => {
    const text = '{"t":100,"k":"move","x":1,"y":2}\n{"t":200,"k":"mo';
    const out = parseTelemetry(text);
    expect(out).toHaveLength(1);
    expect(out[0]?.t).toBe(100);
  });

  it("skips lines missing t or k", () => {
    const text = '{"x":1}\n{"t":5}\n{"t":100,"k":"move","x":1,"y":2}';
    expect(parseTelemetry(text)).toHaveLength(1);
  });

  it("sorts by timestamp", () => {
    const text = [
      '{"t":300,"k":"move","x":1,"y":2}',
      '{"t":100,"k":"move","x":1,"y":2}',
    ].join("\n");
    expect(parseTelemetry(text).map((e) => e.t)).toEqual([100, 300]);
  });
});
