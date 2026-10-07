/** Native editor story: real pointer/key/wheel input, persistence, repaint, playback and export. */
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = process.cwd();
const scratch = path.join(root, "tmp", "timeline-validation");
const bundle = path.join(scratch, "bundle");
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(bundle, { recursive: true });
fs.cpSync(path.join(root, "tests", "fixtures", "basic"), bundle, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
fs.writeFileSync(path.join(bundle, "project.json"), JSON.stringify({ version: 1, bundleId: manifest.id,
  zoom: { segments: [{ id: "zoom-main", startMs: 0, endMs: manifest.durationMs, origin: "manual", pinned: true,
    position: "fixed", waypoints: [{ id: "focus", tMs: 0, depth: 0.5, cx: 0.5, cy: 0.5 }] }] }, output: { width: 640, height: 360, fps: 30 } }));
app.setPath("userData", path.join(scratch, "profile"));
process.env.LOCALAPPDATA = path.join(scratch, "local");
process.env.ZOOMCAST_UI_SHOT = bundle;
process.env.ZOOMCAST_UI_SHOT_DELAY = "180000";
const checks = [];
const errors = [];
const report = (ok, error) => fs.writeFileSync(path.join(scratch, "result.json"), JSON.stringify({ ok, error, checks, errors }, null, 2));
const timeout = setTimeout(() => { report(false, "Timed out"); app.exit(1); }, 150000);
let attached = false;
app.on("browser-window-created", (_, win) => {
  if (attached) return;
  attached = true;
  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  wc.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  wc.once("did-finish-load", async () => {
    const js = code => wc.executeJavaScript(code);
    const pause = (ms = 220) => new Promise(resolve => setTimeout(resolve, ms));
    const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
    const button = name => `[...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(name)})`;
    const box = expr => js(`(()=>{const e=${expr};if(!e)throw Error('Missing '+${JSON.stringify(expr)});const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    const pointClick = async (x, y) => {
      const point = { x: Math.round(x), y: Math.round(y) };
      wc.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
      wc.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point }); await pause();
    };
    const click = async expr => { const r = await box(expr); await pointClick(r.x + r.width / 2, r.y + r.height / 2); };
    const key = async (keyCode, modifiers = []) => {
      wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      wc.sendInputEvent({ type: "keyUp", keyCode, modifiers }); await pause();
    };
    const save = async () => {
      await click(button("Save project"));
      for (let i = 0; i < 25 && await js("document.querySelector('.editor-status').textContent") !== "Project saved"; i++) await pause(100);
      return JSON.parse(fs.readFileSync(path.join(bundle, "project.json"), "utf8"));
    };
    const seek = async (ms, duration = manifest.durationMs) => {
      const r = await box("document.querySelector('.timeline-ruler')");
      await pointClick(Math.min(r.x + r.width - 1, r.x + r.width * ms / duration), r.y + r.height / 2);
      await pause(300);
    };
    const frame = () => js("document.querySelector('.preview-canvas').toDataURL()");
    const changed = async (before, label) => {
      for (let i = 0; i < 30; i++) { await pause(100); if (await frame() !== before) { checks.push(label); return; } }
      throw Error(label);
    };
    try {
      for (let i = 0; i < 150 && !await js("Boolean(window.__zc)"); i++) await pause(100);
      win.show(); win.focus(); await pause(500);
      assert(await js("Boolean(window.__zc)"), "editor opens native fixture");
      assert(await js("document.querySelectorAll('.timeline-clip').length===1 && !document.querySelector('.timeline-cut-lane')"), "full base clip replaces drag-to-cut lane");
      await seek(3000);
      for (const preset of [0, 5, 1, 4]) {
        await click("document.querySelector('.timeline-segment')");
        const before = await frame();
        await click(`document.querySelectorAll('.segment-depth-presets button')[${preset}]`);
        await changed(before, `preset ${preset + 1} repaints without forced rendering`);
        const label = await js(`document.querySelectorAll('.segment-depth-presets button')[${preset}].textContent`);
        const p = await save();
        assert(Math.abs(Math.max(...p.zoom.keyframes.map(k => k.scale)) - parseFloat(label)) < 0.01, `preset ${preset + 1} persists newly derived zoom`);
      }
      await click("document.querySelector('.timeline-segment')");
      let before = await frame(); await click(button("Follow camera"));
      await changed(before, "follow changes visible camera and regenerates samples");
      let p = await save();
      assert(p.zoom.segments[0].position === "follow" && p.zoom.keyframes.length > 10, "follow mode is persisted with sampled camera");
      await click("document.querySelector('.timeline-segment')");
      before = await frame(); await click(button("Fixed camera"));
      await changed(before, "fixed restores fixed camera after follow");
      p = await save(); assert(p.zoom.segments[0].position === "fixed" && p.zoom.keyframes.length < 10, "fixed drops obsolete follow samples");
      await click("document.querySelector('.timeline-segment')");
      await click("document.querySelectorAll('.segment-depth-presets button')[0]");
      before = await frame(); await click(button("Reset to auto"));
      await changed(before, "reset to auto repaints camera/depth");
      p = await save(); assert(p.zoom.segments[0].position === "follow" && p.zoom.segments[0].waypoints[0].depth !== 0.25, "reset restores telemetry depth and follow mode");
      await click("document.querySelector('.timeline-segment')");
      assert(await js("(()=>{const p=document.querySelector('.segment-popover').getBoundingClientRect();const s=document.querySelector('.timeline-segment').getBoundingClientRect();return p.left>=0 && p.right<=innerWidth && p.top>=0 && p.bottom<=innerHeight && Math.abs(p.left-s.left)<25})()"), "popover anchors beside its segment within viewport");
      fs.writeFileSync(path.join(scratch, "popover.png"), (await wc.capturePage()).toPNG());
      await seek(2000);
      assert(await js("!document.querySelector('.segment-popover')"), "one outside click on ruler dismisses popup");
      await click(button("Add segment")); p = await save();
      const inserted = p.zoom.segments.find(s => s.origin === "manual" && s.position === "fixed" && Math.abs(s.startMs - 2000) < 15);
      assert(Boolean(inserted), "Add segment starts at current playhead, including inside another zoom");
      const ruler = await box("document.querySelector('.timeline-ruler')");
      let shotBox = await box("document.querySelector('.timeline-segment.is-selected')");
      wc.sendInputEvent({ type: "mouseDown", button: "left", x: Math.round(shotBox.x + shotBox.width - 2), y: Math.round(shotBox.y + shotBox.height / 2) });
      wc.sendInputEvent({ type: "mouseMove", x: Math.round(ruler.x + ruler.width * 0.8), y: Math.round(shotBox.y + shotBox.height / 2) }); await pause();
      wc.sendInputEvent({ type: "mouseUp", button: "left", x: Math.round(ruler.x + ruler.width * 0.8), y: Math.round(shotBox.y + shotBox.height / 2) }); await pause();
      p = await save(); assert(Math.abs(p.zoom.segments.find(s => s.id === inserted.id).endMs - 4000) < 15, "zoom edge resize follows pointer and regenerates camera");
      shotBox = await box("document.querySelector('.timeline-segment.is-selected')");
      const from = { x: Math.round(shotBox.x + shotBox.width / 2), y: Math.round(shotBox.y + shotBox.height / 2) };
      const to = { x: Math.round(from.x + ruler.width * 0.08), y: from.y };
      wc.sendInputEvent({ type: "mouseDown", button: "left", ...from });
      wc.sendInputEvent({ type: "mouseMove", ...to }); await pause();
      wc.sendInputEvent({ type: "mouseUp", button: "left", ...to }); await pause();
      p = await save(); assert(Math.abs(p.zoom.segments.find(s => s.id === inserted.id).startMs - 2400) < 15, "zoom drag stays captured through React redraws");
      await click(button("Timeline undo")); await click(button("Timeline undo"));
      await click(button("Timeline undo"));
      await seek(3000); await click("document.querySelector('.timeline-segment')");
      await click(button("Split at playhead")); p = await save();
      assert(p.zoom.segments.length === 2, "scissors splits selected zoom into independent segments");
      assert(p.zoom.segments[0].endMs === p.zoom.segments[1].startMs, "zoom split meets exactly at playhead");
      await click(button("Timeline undo"));
      await seek(1000); await click("document.querySelector('.timeline-clip')");
      await click(button("Split at playhead"));
      assert(await js("document.querySelectorAll('.timeline-clip').length===2"), "scissors splits base video without removing footage");
      await seek(3000); await click("document.querySelectorAll('.timeline-clip')[1]");
      await key("b", ["control"]);
      assert(await js("document.querySelectorAll('.timeline-clip').length===3"), "Ctrl+B splits selected base clip");
      p = await save(); assert(p.clips.length === 3 && Math.abs(p.clips[0].endMs - 1000) < 15 && Math.abs(p.clips[1].endMs - 3000) < 15, "base clip boundaries persist in source time");
      const original = p.clips.map(c => c.id);
      const drag = await box("document.querySelectorAll('.timeline-clip')[2]");
      const target = await box("document.querySelectorAll('.timeline-clip')[0]");
      wc.sendInputEvent({ type: "mouseDown", button: "left", x: Math.round(drag.x + drag.width / 2), y: Math.round(drag.y + drag.height / 2) });
      wc.sendInputEvent({ type: "mouseMove", x: Math.round(target.x + 10), y: Math.round(target.y + target.height / 2) }); await pause();
      wc.sendInputEvent({ type: "mouseUp", button: "left", x: Math.round(target.x + 10), y: Math.round(target.y + target.height / 2) }); await pause();
      p = await save(); assert(p.clips.map(c => c.id).join() === [original[2], original[0], original[1]].join(), "drag reorders last base clip to first");
      await click(button("Timeline undo")); p = await save(); assert(p.clips.map(c => c.id).join() === original.join(), "undo restores clip order");
      await click(button("Timeline redo"));
      await click("document.querySelectorAll('.timeline-clip')[1]"); await click(button("Delete timeline selection"));
      p = await save(); assert(p.clips.length === 2 && !p.clips.some(c => c.id === original[0]), "Delete removes selected base clip and ripples duration");
      assert(await js("document.querySelector('.time-total').textContent==='0:04.0'"), "transport reflects remaining footage duration");
      await click(button("Timeline undo"));
      const footer = await box("document.querySelector('.timeline-footer')");
      const viewport = await box("document.querySelector('.timeline-viewport')");
      wc.sendInputEvent({ type: "mouseWheel", x: Math.round(viewport.x + viewport.width / 2), y: Math.round(viewport.y + 20), deltaY: 120, modifiers: ["control"], canScroll: true }); await pause(400);
      assert(await js("Number(document.querySelector('input[aria-label=\"Timeline zoom\"]').value)>1"), "Ctrl+wheel zooms timeline");
      assert(Math.abs((await box("document.querySelector('.timeline-footer')")).width - footer.width) < 1, "timeline zoom keeps footer at fixed width");
      await js("document.querySelector('.timeline-viewport').scrollLeft=0");
      wc.sendInputEvent({ type: "mouseWheel", x: Math.round(viewport.x + viewport.width / 2), y: Math.round(viewport.y + 20), deltaY: -120, modifiers: ["shift"], canScroll: true }); await pause(400);
      assert(await js("document.querySelector('.timeline-viewport').scrollLeft>0"), "Shift+wheel scrolls timeline horizontally");
      await click(button("Zoom timeline out"));
      await js("document.querySelector('.timeline-viewport').scrollLeft=0"); await pause();
      await js("document.querySelector('.aspect-button').focus()"); await key("Down");
      p = await save(); assert(p.output.aspect === "16:9", "preview aspect dropdown selects and persists ratio");
      await js("document.querySelector('.aspect-button').focus()"); await key("Up");
      p = await save(); assert(p.output.aspect === "native", "aspect dropdown returns to native");
      const duration = p.clips.reduce((sum, c) => sum + c.endMs - c.startMs, 0);
      await seek(duration - 120, duration); await click(button("Play")); await pause(1400);
      assert(await js("Boolean(document.querySelector('button[aria-label=Pause]')) && parseFloat(document.querySelector('.time-readout').textContent.split(':')[1])<2"), "playback loops to start and playhead continues after ordered clips end");
      await click(button("Pause")); await click(button("Restart")); await pause();
      assert(await js("document.querySelector('.time-readout').textContent==='0:00.0'"), "restart restores timer/playhead to zero");
      const outFile = path.join(scratch, "reordered.mp4");
      await js(`window.__zc.exportUI(${JSON.stringify(outFile)})`);
      for (let i = 0; i < 120 && !fs.existsSync(outFile); i++) await pause(300);
      for (let i = 0; i < 120; i++) {
        const jobs = await js("window.zoomcast.exports.list()");
        if (jobs.some(j => j.file === outFile && j.phase === "done")) break;
        if (jobs.some(j => j.file === outFile && j.phase === "failed")) throw Error(JSON.stringify(jobs));
        await pause(300);
      }
      const metadata = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", outFile], { encoding: "utf8" }));
      assert(metadata.streams.some(s => s.codec_type === "video") && metadata.streams.some(s => s.codec_type === "audio"), "user export writes reordered video and audio");
      assert(Math.abs(Number(metadata.format.duration) * 1000 - duration) < 100, "reordered export duration matches edited timeline");
      await click(button("Back to editor"));
      assert(await js("document.querySelector('.timeline-footer').getBoundingClientRect().bottom <= innerHeight - 6"), "timeline footer remains fully visible below both tracks");
      fs.writeFileSync(path.join(scratch, "timeline.png"), (await wc.capturePage()).toPNG());
      assert(errors.length === 0, "no renderer errors during editor story");
      report(true); clearTimeout(timeout); app.exit(0);
    } catch (error) {
      fs.writeFileSync(path.join(scratch, "failure.png"), (await wc.capturePage()).toPNG());
      report(false, String(error)); clearTimeout(timeout); app.exit(1);
    }
  });
});
import("../out/main/index.js");
