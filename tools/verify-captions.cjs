/** Real opt-in download, offline recognition, editor save/reopen and captioned export. */
const { app, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = process.cwd();
const scratch = path.join(root, "tmp", "caption-validation");
const fixture = path.join(scratch, "recording");
app.setPath("userData", path.join(scratch, "profile"));
process.env.LOCALAPPDATA = path.join(scratch, "local");
process.env.ZOOMCAST_UI_SHOT = fixture;
process.env.ZOOMCAST_UI_SHOT_DELAY = "900000";
const checks = [];
const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const report = (ok, error, stage) => fs.writeFileSync(path.join(scratch, "report.json"), JSON.stringify({ ok, error, stage, checks }, null, 2));
report(false, undefined, "Starting native editor");
const timer = setTimeout(() => { report(false, "Timed out"); app.exit(1); }, 850000);
let attached = false;
app.on("browser-window-created", (_, win) => {
  if (attached) return;
  attached = true;
  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  wc.once("did-finish-load", async () => {
    const js = code => wc.executeJavaScript(code);
    const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); report(false, undefined, label); };
    const waitFor = async (code, timeout = 15000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { if (await js(code)) return; await pause(150); }
      throw Error(`Timed out: ${code}`);
    };
    const clickButton = async label => js(`(()=>{ const e=Array.from(document.querySelectorAll('button')).find(e=>(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(label)}); if(!e||e.disabled)throw Error('Unavailable button: '+${JSON.stringify(label)}); e.click(); })()`);
    const readProject = () => JSON.parse(fs.readFileSync(path.join(fixture, "project.json"), "utf8"));
    try {
      await waitFor("Boolean(window.__zc)");
      win.show(); win.focus();
      await clickButton("Captions"); await pause(200);
      const initial = await js("window.zoomcast.captions.state()");
      if (!initial.installed) {
        const speechRoot = path.join(app.getPath("userData"), "speech");
        assert(!fs.existsSync(speechRoot) || fs.readdirSync(speechRoot).length === 0, "Opening Captions does not download anything");
        report(false, undefined, "Downloading real pinned engine and model");
        await js("window.__captionInstall=window.zoomcast.captions.install().then(()=>true,e=>String(e)); undefined");
        await waitFor("window.zoomcast.captions.state().then(s=>s.busy)");
        await js("window.__busyError=window.zoomcast.captions.remove().then(()=>'',e=>String(e)); undefined");
        assert((await js("window.__busyError")).includes("Cancel"), "Removing speech files is blocked during an active download");
        await waitFor("window.zoomcast.captions.state().then(s=>!s.busy)", 650000);
        const result = await js("window.__captionInstall");
        assert(result === true, `Verified download completed (${result})`);
      }
      assert((await js("window.zoomcast.captions.state()")).installed, "Speech engine and model are installed outside the application");
      // After installation, disable network to prove generation is offline.
      const originalFetch = global.fetch;
      global.fetch = async () => { throw Error("Network forbidden during recognition"); };
      report(false, undefined, "Running real offline recognition");
      await clickButton("Generate transcript");
      await waitFor("document.querySelectorAll('.caption-cue').length>0", 180000);
      const recognized = await js("Array.from(document.querySelectorAll('.caption-cue')).map(e=>e.textContent).join(' ')");
      assert(/caption|screen recorder/i.test(recognized), "Real offline recognition transcribes the spoken caption test");
      global.fetch = originalFetch;
      assert(await js("document.querySelector('[aria-label=\"Show captions\"]').checked"), "Generated captions are enabled in the video");
      // A real input event exercises the transient history and Ctrl+S path.
      await js("(()=>{const e=document.querySelector('#caption-text');e.focus();const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(e,'Corrected Zoomcast caption.');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await pause(200);
      wc.sendInputEvent({ type: "keyDown", keyCode: "S", modifiers: ["control"] });
      wc.sendInputEvent({ type: "keyUp", keyCode: "S", modifiers: ["control"] });
      await waitFor("document.querySelector('.editor-status').textContent==='Project saved'");
      assert(readProject().captions.cues[0].text === "Corrected Zoomcast caption.", "Ctrl+S saves a caption correction while the text field has focus");
      await js("document.querySelector('#caption-text').blur()");
      const firstCue = readProject().captions.cues[0];
      const visibleTime = Math.max(firstCue.startMs + 100, (firstCue.startMs + firstCue.endMs) / 2);
      const enabled = await js(`window.__zc.renderAt(${visibleTime})`);
      await js("document.querySelector('[aria-label=\"Show captions\"]').click()"); await pause(200);
      const disabled = await js(`window.__zc.renderAt(${visibleTime})`);
      assert(enabled !== disabled, "Caption visibility changes the actual WebGL preview");
      await js("document.querySelector('[aria-label=\"Show captions\"]').click()"); await pause(200);
      await clickButton("Save project"); await pause(200);
      fs.writeFileSync(path.join(scratch, "preview.png"), Buffer.from(enabled.split(",")[1], "base64"));
      // Apply a crossing cut and explicit reordered clips via the saved document.
      const project = readProject();
      project.output = { ...project.output, width: 640, height: 360, fps: 30, bitrateMbps: 3 };
      project.clips = [{ id: "later", startMs: 2500, endMs: 5000 }, { id: "earlier", startMs: 0, endMs: 2000 }];
      fs.writeFileSync(path.join(fixture, "project.json"), JSON.stringify(project));
      await wc.loadURL(wc.getURL()); await waitFor("Boolean(window.__zc)");
      await clickButton("Captions"); await pause(200);
      assert(await js("document.querySelector('#caption-text').value==='Corrected Zoomcast caption.'"), "Corrected captions survive a full editor reopen");
      const originalDialog = dialog.showSaveDialog;
      for (const format of ["srt", "vtt"]) {
        const target = path.join(scratch, `captions.${format}`);
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
        await clickButton(`Export ${format.toUpperCase()}`);
        await waitFor(`document.querySelector('.caption-message')?.textContent===${JSON.stringify(`${format.toUpperCase()} subtitles exported.`)}`);
        const text = fs.readFileSync(target, "utf8");
        assert(text.includes("Corrected Zoomcast caption.") && / --> /.test(text), `${format.toUpperCase()} exports use the current corrected transcript`);
      }
      dialog.showSaveDialog = originalDialog;
      const video = path.join(scratch, "captioned.mp4");
      await js(`window.__zc.exportTo(${JSON.stringify(video)})`);
      assert(fs.statSync(video).size > 1000, "Captioned MP4 exports through the shared renderer");
      const probe = process.env.ZOOMCAST_FFPROBE || (app.isPackaged ? path.join(process.resourcesPath, "ffmpeg", "ffprobe.exe") : "ffprobe");
      const info = JSON.parse(execFileSync(probe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", video], { encoding: "utf8" }));
      assert(Math.abs(Number(info.format.duration) - 4.5) < 0.1, "Captioned export honors the reordered clip duration");
      assert(info.streams.some(s=>s.codec_type==='audio'), "Captioned export retains recorded audio");
      const workerVideo = path.join(scratch, "captioned-worker.mp4");
      await js(`window.__zc.exportUI(${JSON.stringify(workerVideo)})`);
      await waitFor(`window.zoomcast.exports.list().then(jobs=>jobs.some(j=>j.file===${JSON.stringify(workerVideo)} && j.phase==='done'))`, 90000);
      assert(fs.statSync(workerVideo).size > 1000, "The production export worker includes saved captions");
      await js("window.zoomcast.captions.remove()");
      assert(!(await js("window.zoomcast.captions.state()")).installed, "Speech download can be removed to reclaim storage");
      assert(readProject().captions.cues[0].text === "Corrected Zoomcast caption.", "Removing speech files preserves saved captions");
      assert(fs.existsSync(video) && fs.existsSync(path.join(scratch, "captions.srt")), "Removing speech files preserves exported video and subtitles");
      report(true, undefined, "Complete"); clearTimeout(timer); app.exit(0);
    } catch (error) { report(false, String(error), "Failed"); clearTimeout(timer); app.exit(1); }
  });
});
import("../out/main/index.js");
