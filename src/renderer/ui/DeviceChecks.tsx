import { useEffect, useRef, useState } from "react";
import type { MicrophoneSettings } from "../../shared/settings/types";
import { mediaError, microphoneConstraints, monitorLevel } from "../mediaDevices";

export function MicrophoneCheck({ settings, refreshDevices }: { settings: MicrophoneSettings; refreshDevices: () => void }) {
  const [phase, setPhase] = useState<"idle" | "opening" | "recording">("idle");
  const [message, setMessage] = useState("Record a short sample, then play it back to hear your microphone.");
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState("");
  const resources = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const stopRecording = useRef<(() => void) | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  useEffect(() => () => { generation.current++; resources.current?.(); }, []);
  useEffect(() => {
    const audio = player.current;
    return () => { audio?.pause(); audio?.removeAttribute("src"); audio?.load(); if (clip) URL.revokeObjectURL(clip); };
  }, [clip]);

  const cancel = () => { generation.current++; resources.current?.(); resources.current = null; setPhase("idle"); setLevel(0); setMessage("Microphone check cancelled."); };
  const start = async () => {
    const request = ++generation.current;
    resources.current?.(); player.current?.pause(); setClip(""); setLevel(0); setSeconds(0);
    setPhase("opening"); setMessage("Opening microphone…");
    let stream: MediaStream | undefined;
    let stopMeter = () => {};
    let timer: number | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints(settings));
      if (request !== generation.current) { for (const track of stream.getTracks()) track.stop(); return; }
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128_000 });
      const chunks: Blob[] = [];
      const cleanup = () => {
        window.clearInterval(timer); stopMeter();
        recorder.onstop = null; recorder.onerror = null; recorder.ondataavailable = null;
        if (recorder.state !== "inactive") recorder.stop();
        for (const track of stream?.getTracks() ?? []) track.stop();
      };
      resources.current = cleanup;
      stopMeter = await monitorLevel(stream, value => { if (request === generation.current) setLevel(value); });
      if (request !== generation.current) { cleanup(); return; }
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { cleanup(); setPhase("idle"); setMessage("Microphone recording failed. Try another device."); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType });
        cleanup(); resources.current = null; stopRecording.current = null;
        if (request !== generation.current) return;
        setLevel(0); setPhase("idle");
        if (blob.size) { setClip(URL.createObjectURL(blob)); setMessage("Sample ready. Press play to listen. This test is kept only until you leave this section."); }
        else setMessage("No audio was recorded. Check your microphone and try again.");
      };
      for (const track of stream.getTracks()) track.onended = () => {
        if (request !== generation.current) return;
        cleanup(); setLevel(0); setPhase("idle"); setMessage("Microphone disconnected during the test. Choose another device.");
      };
      stopRecording.current = () => { if (recorder.state !== "inactive") recorder.stop(); };
      recorder.start(250);
      const began = Date.now();
      timer = window.setInterval(() => {
        setSeconds(Math.floor((Date.now() - began) / 1000));
        if (Date.now() - began >= 15000) stopRecording.current?.();
      }, 200);
      setPhase("recording"); setMessage("Speak into your microphone. Recording stops after 15 seconds, or press Stop test.");
      refreshDevices();
    } catch (error) {
      resources.current?.(); stopMeter(); for (const track of stream?.getTracks() ?? []) track.stop();
      if (request !== generation.current) return;
      setLevel(0); setPhase("idle"); setMessage(mediaError(error, "Microphone"));
    }
  };
  return <div className="settings-device-test">
    <div className="settings-test-header"><span>Microphone test</span><span>{phase === "recording" ? `Recording · ${seconds}s / 15s` : phase === "opening" ? "Opening…" : "Not recording"}</span></div>
    <meter aria-label="Microphone input level" min={0} max={1} value={level} />
    <div className="settings-test-actions"><button type="button" className="settings-action" onClick={() => phase === "opening" ? cancel() : phase === "recording" ? stopRecording.current?.() : void start()}>{phase === "opening" ? "Cancel microphone check" : phase === "recording" ? "Stop test" : "Record microphone test"}</button></div>
    {/* biome-ignore lint/a11y/useMediaCaption: this temporary self-recorded microphone sample has no known transcript; the input meter provides visual feedback. */}
    {clip && <audio ref={player} controls src={clip} aria-label="Microphone test playback" />}
    <p className="settings-hint" role="status">{message}</p>
  </div>;
}

export function CameraCheck({ deviceId, refreshDevices }: { deviceId: string; refreshDevices: () => void }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const live = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const stop = () => { generation.current++; for (const track of live.current?.getTracks() ?? []) track.stop(); live.current = null; setStream(null); setOpening(false); setMessage("Camera preview stopped."); };
  useEffect(() => () => { generation.current++; for (const track of live.current?.getTracks() ?? []) track.stop(); }, []);
  useEffect(() => { if (video.current) video.current.srcObject = stream; }, [stream]);
  const start = async () => {
    const request = ++generation.current;
    setOpening(true); setMessage("Opening camera…");
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } }, audio: false });
      if (request !== generation.current) { for (const track of next.getTracks()) track.stop(); return; }
      live.current = next; setStream(next); setOpening(false); setMessage("Live camera preview. Camera audio is off."); refreshDevices();
      for (const track of next.getTracks()) track.onended = () => { stop(); setMessage("Camera disconnected. Choose another device and try again."); };
    } catch (error) { if (request === generation.current) { setOpening(false); setMessage(mediaError(error, "Camera")); } }
  };
  return <div className="settings-device-test">
    {stream && <video ref={video} autoPlay playsInline muted aria-label="Live camera preview" />}
    <button type="button" className="settings-action" onClick={() => opening || stream ? stop() : void start()}>{opening ? "Cancel camera check" : stream ? "Stop camera preview" : "Check camera"}</button>
    {message && <p className="settings-hint" role="status">{message}</p>}
  </div>;
}
