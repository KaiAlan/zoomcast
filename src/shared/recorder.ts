import type { Cut } from "./project/types";
import { normalizeCuts } from "./project/cuts";

export type RecorderOptions = {
  sourceId: string;
  countdown: 0 | 3 | 5 | 10;
  mic: boolean;
  system: boolean;
  webcam: boolean;
  webcamDeviceId: string;
  folderId?: string | null;
};
export type RecorderSource = { id: string; name: string; kind: "screen" | "window"; thumbnail?: string; isPrimary?: boolean };
export type RecorderState = {
  phase: "idle" | "countdown" | "starting" | "recording" | "stopping";
  paused: boolean;
  cutting: boolean;
  elapsedMs: number;
  countdownLeft: number;
  error: string | null;
  folderId?: string | null;
  folderName?: string;
};
export type RecorderAction = "start" | "stop" | "pause" | "cut" | "cancel" | "hide" | "editor";
export type RecorderApi = {
  resize: (height: number) => Promise<void>;
  state: () => Promise<RecorderState>;
  sources: () => Promise<RecorderSource[]>;
  action: (action: RecorderAction, options?: RecorderOptions) => Promise<void>;
  onState: (fn: (state: RecorderState) => void) => () => void;
};
/** Pauses and marked removals share source time across every media track. */
export function recorderCuts(cuts: Cut[], durationMs: number): Cut[] {
  return normalizeCuts(cuts, durationMs);
}
