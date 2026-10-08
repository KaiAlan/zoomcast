import type { ControlContext } from "../zoom/context";

export type CursorShape =
  | "arrow"
  | "ibeam"
  | "hand"
  | "ns"
  | "ew"
  | "nwse"
  | "nesw"
  | "wait";

export type TelemetryEvent =
  | { t: number; k: "move"; x: number; y: number }
  | { t: number; k: "down"; x: number; y: number; b: number }
  | { t: number; k: "up"; x: number; y: number; b: number }
  | { t: number; k: "key"; d: "down" | "up"; c: string }
  | { t: number; k: "wheel"; x: number; y: number; dy: number }
  | { t: number; k: "cursor"; shape: CursorShape }
  | { t: number; k: "context"; trigger: "down" | "key" | "wheel"; target: ControlContext };
