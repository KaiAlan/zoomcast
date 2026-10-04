export type WebcamStart = {
  startedAtUnixMs: number;
  mimeType: string;
  width: number;
  height: number;
  fps: number;
};

export const WEBCAM_MIME_TYPES = ["video/webm;codecs=vp9", "video/mp4;codecs=avc1.42001E"] as const;
