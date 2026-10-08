/** Native device tests with Chromium's deterministic camera and PCM microphone.
 * Uses an isolated profile and recordings directory; never opens the installed app.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = process.cwd();
const dir = path.join(root, "tmp", "audio-device-validation");
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
app.setPath("userData", path.join(dir, "profile"));
process.env.LOCALAPPDATA = path.join(dir, "local");
const wav = path.join(dir, "microphone.wav");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "60", "-c:a", "pcm_s16le", wav]);
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-audio-capture", wav);
const checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = (ok, error) => fs.writeFileSync(path.join(dir, "validation.json"), JSON.stringify({ ok, error, checks }, null, 2));
const assert = (value, message) => { if (!value) throw new Error(message); checks.push(message); report(true); };
const timeout = setTimeout(() => { report(false, "Timed out"); app.exit(1); }, 150000);
const instrument = `(()=>{
 if(!navigator.mediaDevices)return;
 const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 window.deviceTestStreams=[]; window.deviceTestConstraints=[];
 navigator.mediaDevices.getUserMedia=async constraints=>{window.deviceTestConstraints.push(constraints); const stream=await original(constraints);window.deviceTestStreams.push(stream);return stream;};
})()`;
let attached = false;
app.on("browser-window-created", (_, win) => {
  win.webContents.on("dom-ready", () => { void win.webContents.executeJavaScript(instrument).catch(() => {}); });
  if (attached) return; attached = true;
  win.webContents.once("did-finish-load", async () => {
    const wc = win.webContents;
    const js = code => wc.executeJavaScript(code, true);
    const wait = async (fn, label) => { for (let i = 0; i < 200; i++) { if (await fn()) return; await delay(100); } throw new Error(`Timed out: ${label}`); };
    const click = (target, text) => target.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click(); undefined`, true);
    try {
      await delay(500);
      await js("window.zoomcast.openSettings()");
      await wait(() => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith("#settings")), "settings");
      const settings = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#settings"));
      const swc = settings.webContents;
      const sjs = code => swc.executeJavaScript(code, true);
      swc.setBackgroundThrottling(false);
      const screenshot = async (name, selector) => {
        settings.show(); settings.focus();
        await sjs(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'}); undefined`);
        swc.invalidate(); await delay(350);
        for (let attempt=0;attempt<3;attempt++) {
          try { fs.writeFileSync(path.join(dir,name),(await swc.capturePage()).toPNG()); return; }
          catch { await delay(250); }
        }
      };
      await wait(() => sjs("!!document.querySelector('.settings-sidebar nav')"), "settings mounted");
      await click(swc, "Recording"); await delay(300);
      assert(await sjs("window.deviceTestStreams.length===0"), "Settings requests no microphone or camera until a test is clicked");
      assert(await sjs("!!document.querySelector('[aria-label=\"Microphone device\"]') && [...document.querySelectorAll('button')].some(b=>b.textContent==='Microphone permissions')"), "Settings exposes microphone selection and Windows permission controls");
      await click(swc, "Check camera");
      await wait(() => sjs("document.querySelector('video')?.readyState>=2 && document.querySelector('video').videoWidth>0"), "camera live frames");
      await screenshot("camera-preview.png", "video");
      assert(await sjs("window.deviceTestStreams[0].getAudioTracks().length===0"), "Camera test shows live frames without opening microphone");
      await click(swc, "Stop camera preview");
      assert(await sjs("window.deviceTestStreams[0].getTracks().every(t=>t.readyState==='ended')"), "Stopping camera preview releases device");
      const devices = await sjs("navigator.mediaDevices.enumerateDevices().then(ds=>ds.map(d=>({id:d.deviceId,kind:d.kind})))");
      const mic = devices.find(d => d.kind === "audioinput" && !["default", "communications"].includes(d.id));
      assert(Boolean(mic), "Deterministic microphone is enumerated after permission");
      await sjs(`window.zoomcast.getSettings().then(s=>window.zoomcast.setSettings({...s,microphoneDeviceId:${JSON.stringify(mic.id)},noiseSuppression:true,echoCancellation:true,autoGainControl:true}))`);
      await delay(300);
      await click(swc, "Record microphone test");
      await wait(() => sjs("document.querySelector('[aria-label=\"Microphone input level\"]').value>0.01"), "live mic level");
      await delay(900);
      assert(await sjs(`window.deviceTestConstraints.at(-1).audio.deviceId.exact===${JSON.stringify(mic.id)} && window.deviceTestConstraints.at(-1).audio.noiseSuppression && window.deviceTestConstraints.at(-1).audio.echoCancellation && window.deviceTestConstraints.at(-1).audio.autoGainControl`), "Microphone test uses exact selected device and saved processing preferences");
      await click(swc, "Stop test");
      await wait(() => sjs("!!document.querySelector('audio')"), "audio sample");
      const sample = await sjs("(async()=>{const b=await (await fetch(document.querySelector('audio').src)).arrayBuffer();return Array.from(new Uint8Array(b));})()");
      fs.writeFileSync(path.join(dir, "sample.webm"), Buffer.from(sample));
      await sjs("document.querySelector('audio').play()");
      await wait(() => sjs("document.querySelector('audio').currentTime>0.2"), "sample playback");
      assert(await sjs("window.deviceTestStreams.at(-1).getTracks().every(t=>t.readyState==='ended')"), "Microphone test stops device and recorded sample plays back");
      await screenshot("microphone-test.png", "audio");
      await sjs("window.samplePlaybackElement=document.querySelector('audio'); undefined");
      await click(swc, "General"); await delay(200);
      assert(await sjs("window.samplePlaybackElement.paused && !window.samplePlaybackElement.getAttribute('src')"), "Leaving Settings section stops sample playback and clears its object URL");
      await click(swc, "Recording");
      await click(swc, "Check camera"); await click(swc, "Record microphone test"); await delay(500);
      await click(swc, "General"); await delay(300);
      assert(await sjs("window.deviceTestStreams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))"), "Leaving Recording settings stops all test devices and timers");
      await click(swc, "Recording");
      await sjs("window.originalDeviceTestGetUserMedia=navigator.mediaDevices.getUserMedia; navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await window.originalDeviceTestGetUserMedia(constraints);window.lateTestStream=stream;return new Promise(resolve=>{window.releaseTestStream=()=>resolve(stream)});}; undefined");
      for (const [begin, cancel] of [["Record microphone test", "Cancel microphone check"], ["Check camera", "Cancel camera check"]]) {
        await sjs("window.releaseTestStream=null; undefined");
        await click(swc, begin);
        await wait(() => sjs("typeof window.releaseTestStream==='function'"), "delayed device permission");
        await click(swc, cancel);
        await sjs("window.releaseTestStream(); undefined"); await delay(200);
        assert(await sjs("window.lateTestStream.getTracks().every(t=>t.readyState==='ended')"), `Cancelled ${begin} releases a device even when permission resolves late`);
      }
      await sjs("navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError')}; undefined");
      await click(swc, "Record microphone test"); await delay(200);
      assert(await sjs("document.body.innerText.includes('Microphone access denied') && document.body.innerText.includes('desktop apps')"), "Denied microphone access shows actionable Windows permission guidance");
      settings.hide(); win.show(); win.focus();
      await js("document.querySelector('[aria-label=\"More options\"]').click(); undefined"); await delay(200);
      assert(await js(`document.querySelector('[aria-label="Microphone device"]').value===${JSON.stringify(mic.id)} && !!document.querySelector('[aria-label="Camera device"]')`), "Widget three-dot menu includes microphone and camera selectors synchronized with Settings");
      await js("document.querySelector('[aria-label=\"More options\"]').click(); undefined");
      const options = {sourceId:"",countdown:0,mic:true,system:false,webcam:false,webcamDeviceId:"",microphoneDeviceId:mic.id};
      await js(`window.zoomcast.recorder.action('start',${JSON.stringify({...options,system:true})})`);
      await wait(() => js("window.zoomcast.recorder.state().then(s=>s.phase==='recording' && s.audioHealth?.mic?.status==='recording' && s.audioHealth.mic.level>0.01)"), "captured mic health");
      assert(await js("!!document.querySelector('.recorder-mic-health.recording')"), "Recording widget shows microphone status and live input level");
      fs.writeFileSync(path.join(dir,"recording-layout.json"),JSON.stringify(await js("[...document.querySelectorAll('.recorder-bar>*')].map(el=>({class:el.className,x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width}))"),null,2));
      assert(await js("[...document.querySelectorAll('.recorder-bar button,.recorder-mic-health')].every(el=>{const r=el.getBoundingClientRect(),bar=document.querySelector('.recorder-bar').getBoundingClientRect();return r.right<=bar.right && r.left>=bar.left})"), "Microphone health indicator fits compact toolbar without clipping");
      assert(await sjs("!document.querySelector('[aria-label=\"Microphone input level\"]') && document.body.innerText.includes('Finish the current recording')"), "Settings tests stop and stay unavailable during an actual recording");
      const audio = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#audio"));
      assert(await audio.webContents.executeJavaScript(`window.deviceTestConstraints.at(-1).audio.deviceId.exact===${JSON.stringify(mic.id)} && window.deviceTestConstraints.at(-1).audio.noiseSuppression`), "Actual hidden capture uses selected microphone and the same processing as Settings test");
      await audio.webContents.executeJavaScript("const track=window.deviceTestStreams[0].getAudioTracks()[0]; track.stop();track.dispatchEvent(new Event('ended')); undefined");
      await wait(() => js("!!document.querySelector('.recorder-mic-health.failed') && document.body.innerText.includes('disconnected')"), "disconnected warning");
      assert(true, "Disconnected microphone triggers red icon badge and visible recording alert");
      await js("window.zoomcast.recorder.action('stop')");
      const recordings = await js("window.zoomcast.listRecordings()");
      const manifest = JSON.parse(fs.readFileSync(path.join(recordings[0].dir,"manifest.json"),"utf8"));
      assert(manifest.audio.some(a=>a.role==='mic'), "Finalized recording retains successfully captured microphone audio after disconnect");
      assert(manifest.audio.some(a=>a.role==='system'), "Microphone and system audio record together as separate saved tracks");
      execFileSync("ffmpeg", ["-v","error","-i",path.join(recordings[0].dir,"system.webm"),"-f","null","-"], {timeout:15000});
      assert(true, "System audio track decodes cleanly after simultaneous capture and stop");
      const captured = path.join(recordings[0].dir, "mic.webm");
      execFileSync("ffmpeg", ["-v","error","-i",captured,"-f","null","-"], {timeout:15000});
      execFileSync("ffmpeg", ["-v","error","-i",path.join(dir,"sample.webm"),"-f","null","-"], {timeout:15000});
      for (const file of [captured, path.join(dir,"sample.webm")]) {
        const pcm = execFileSync("ffmpeg", ["-v","error","-i",file,"-t","2","-f","f32le","-ac","1","-ar","16000","pipe:1"], {timeout:15000});
        let energy=0;
        for(let offset=0;offset<pcm.length;offset+=4) energy+=pcm.readFloatLE(offset)**2;
        assert(pcm.length>0 && Math.sqrt(energy/(pcm.length/4))>0.0001, `Recorded ${path.basename(file)} contains non-silent decoded audio`);
      }
      assert(true, "Settings sample and real recording microphone tracks decode cleanly including final chunks");
      await delay(1100);
      await js(`window.zoomcast.recorder.action('start',${JSON.stringify({...options,microphoneDeviceId:"device-that-is-not-connected"})})`);
      await wait(() => js("window.zoomcast.recorder.state().then(s=>s.phase==='recording' && s.audioHealth?.mic?.status==='failed')"), "missing-device state");
      assert(await js("!!document.querySelector('.recorder-mic-health.failed') && document.body.innerText.includes('unavailable')"), "Missing selected microphone never silently falls back and exposes red recording warning");
      await delay(400); await js("window.zoomcast.recorder.action('stop')");
      const second = (await js("window.zoomcast.listRecordings()"))[0];
      assert(JSON.parse(fs.readFileSync(path.join(second.dir,"manifest.json"),"utf8")).audio.length===0, "Failed microphone is not advertised as an audio track in saved recording");
      await delay(1100);
      await js(`window.zoomcast.recorder.action('start',${JSON.stringify(options)})`);
      await wait(() => js("window.zoomcast.recorder.state().then(s=>s.audioHealth?.mic?.status==='recording')"), "third microphone recording");
      const thirdAudio = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#audio"));
      await thirdAudio.webContents.executeJavaScript("Object.defineProperty(window.deviceTestStreams[0].getAudioTracks()[0],'muted',{configurable:true,value:true}); undefined");
      await wait(() => js("!!document.querySelector('.recorder-mic-health.muted') && !!document.querySelector('.recorder-error')"), "muted track warning");
      assert(true, "Muted-input signal displays red microphone badge and warning");
      await thirdAudio.webContents.executeJavaScript("delete window.deviceTestStreams[0].getAudioTracks()[0].muted;window.deviceTestStreams[0].getAudioTracks()[0].enabled=false; undefined");
      await wait(() => js("window.zoomcast.recorder.state().then(s=>s.audioHealth?.mic?.status==='quiet')"), "sustained silence advisory");
      assert(await js("!!document.querySelector('.recorder-audio-hint') && !document.querySelector('.recorder-error') && !!document.querySelector('.recorder-mic-health.quiet')"), "Sustained silence shows an amber advisory while encoded audio continues, rather than a capture failure");
      await thirdAudio.webContents.executeJavaScript("window.deviceTestStreams[0].getAudioTracks()[0].enabled=true; undefined");
      await wait(() => js("window.zoomcast.recorder.state().then(s=>s.audioHealth?.mic?.status==='recording' && s.audioHealth.mic.level>0.01)"), "sound returns");
      assert(await js("!document.querySelector('.recorder-audio-hint')"), "Microphone sound clears the quiet advisory automatically");
      await thirdAudio.webContents.executeJavaScript("window.__audio.stop()");
      await wait(() => js("window.zoomcast.recorder.state().then(s=>s.audioHealth?.mic?.status==='failed')"), "stalled recorder watchdog");
      assert(await js("document.body.innerText.includes('stopped responding')"), "Main-process watchdog warns when the audio renderer stops reporting");
      await js("window.zoomcast.recorder.action('stop')");
      report(true); clearTimeout(timeout); app.exit(0);
    } catch (error) { report(false, String(error.stack ?? error)); clearTimeout(timeout); app.exit(1); }
  });
});
import("../out/main/index.js");
