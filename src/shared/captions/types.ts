export type CaptionCue = { id: string; startMs: number; endMs: number; text: string };
export type CaptionStyle = {
  visible: boolean;
  font: "Segoe UI" | "Arial";
  /** Percentage of output height; identical at every export resolution. */
  sizePct: number;
  position: "top" | "bottom";
  color: string;
  background: boolean;
};
export type CaptionDocument = {
  cues: CaptionCue[];
  style: CaptionStyle;
  language: string;
};
export type CaptionSource = "mic" | "system" | "mix";
export type CaptionState = {
  installed: boolean;
  busy: boolean;
  phase: "idle" | "downloading" | "preparing" | "transcribing";
  progress: number | null;
  message: string;
  downloadBytes: number;
  diskBytes: number;
};
export type CaptionApi = {
  state: () => Promise<CaptionState>;
  install: () => Promise<void>;
  remove: () => Promise<void>;
  cancel: () => Promise<void>;
  generate: (request: { dir: string; source: CaptionSource; language: string }) => Promise<CaptionCue[]>;
  exportSubtitles: (request: { dir: string; project: import("../project/types").Project; format: "srt" | "vtt" }) => Promise<boolean>;
  onChanged: (callback: (state: CaptionState) => void) => () => void;
};
