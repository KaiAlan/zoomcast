import { describe, expect, it } from "vitest";
import { parseRecognition, recognitionAudioArgs } from "./recognition";
import type { Manifest } from "../../shared/bundle/manifest";

describe("recognition", () => {
  it("reads Whisper millisecond offsets and bounds cues to recording duration", () => {
    expect(parseRecognition({ transcription: [
      { offsets: { from: 250, to: 1250 }, text: " hello world " },
      { offsets: { from: 1500, to: 3000 }, text: " second " },
    ] }, 2000)).toEqual([
      { id: "caption-0", startMs: 250, endMs: 1250, text: "hello world" },
      { id: "caption-1", startMs: 1500, endMs: 2000, text: "second" },
    ]);
  });
  it("handles empty speech and rejects malformed output", () => {
    expect(parseRecognition({ transcription: [] }, 5000)).toEqual([]);
    expect(() => parseRecognition({}, 5000)).toThrow("invalid transcript");
    expect(parseRecognition({ transcription: [null, { text: "no offsets" }] }, 5000)).toEqual([]);
  });
  it("prepares the original audio clock with offsets, including late-starting tracks", () => {
    const manifest = { durationMs: 5000, audio: [{ role: "mic", file: "mic.webm", startOffsetMs: 142 }, { role: "system", file: "system.webm", startOffsetMs: 138 }] } as Manifest;
    const args = recognitionAudioArgs("C:/recording", manifest, "mix", "C:/speech/audio.wav");
    expect(args).toContain("0.142");
    expect(args).toContain("0.138");
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("first_pts=0");
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("amix=inputs=2");
    expect(args).toContain("pcm_s16le");
    expect(args).toContain("16000");
    expect(() => recognitionAudioArgs("C:/recording", { ...manifest, audio: [] }, "mic", "out.wav")).toThrow("no audio");
    expect(() => recognitionAudioArgs("C:/recording", { ...manifest, audio: [{ ...manifest.audio[0]!, file: "../private.wav" }] }, "mic", "out.wav")).toThrow("invalid audio path");
  });
});
