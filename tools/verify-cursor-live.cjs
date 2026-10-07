/** Verify ordinary paused UI repainting; never force a render after an edit. */
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const scratch = path.join(root, "tmp", "cursor-live-validation");
const bundle = path.join(scratch, "bundle");
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(bundle, { recursive: true });
fs.cpSync(process.env.ZOOMCAST_VERIFY_BUNDLE || path.join(root, "tests", "fixtures", "basic"), bundle, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json"), "utf8"));
if (!process.env.ZOOMCAST_VERIFY_BUNDLE) {
  const telemetryFile = path.join(bundle, manifest.telemetry.file);
  const events = fs.readFileSync(telemetryFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
  for (const event of events) if ("x" in event) event.t += 1800;
  events.sort((a, b) => a.t - b.t);
  fs.writeFileSync(telemetryFile, `${events.map(event => JSON.stringify(event)).join("\n")}\n`);
}
const telemetry = fs.readFileSync(path.join(bundle, manifest.telemetry.file), "utf8").trim().split("\n").map(line => JSON.parse(line));
fs.writeFileSync(path.join(bundle, "project.json"), JSON.stringify({ version: 1, bundleId: manifest.id, zoom: { segments: [] }, style: { cursor: { sizePct: 250 } } }));
app.setPath("userData", path.join(scratch, "profile"));
process.env.LOCALAPPDATA = path.join(scratch, "local");
process.env.ZOOMCAST_UI_SHOT = bundle;
process.env.ZOOMCAST_UI_SHOT_DELAY = "180000";
const checks = [];
const report = (ok, error) => fs.writeFileSync(path.join(scratch, "result.json"), JSON.stringify({ ok, error, checks }, null, 2));
const timer = setTimeout(() => { report(false, "Timed out"); app.exit(1); }, 120000);
let attached = false;
app.on("browser-window-created", (_, win) => {
  if (attached) return;
  attached = true;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once("did-finish-load", async () => {
    const js = code => win.webContents.executeJavaScript(code);
    const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
    const frame = () => js("document.querySelector('.preview-canvas').toDataURL()");
    const click = async name => { await js(`[...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(name)}).click()`); };
    const setNumber = async (label, value) => {
      const point = await js(`(()=>{const input=document.querySelector(${JSON.stringify(`input[aria-label=${JSON.stringify(label)}]`)});input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "a", modifiers: ["control"] });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "a", modifiers: ["control"] });
      await win.webContents.insertText(String(value)); await pause(150);
    };
    const seek = async ms => {
      const box = await js("(()=>{const r=document.querySelector('.timeline-ruler').getBoundingClientRect();return {x:r.x,y:Math.round(r.y+r.height/2),width:r.width}})()");
      const point = { x: Math.min(Math.floor(box.x + box.width - 1), Math.round(box.x + box.width * Math.min(1, Math.max(0, ms / manifest.durationMs)))), y: box.y };
      win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
      await pause(400);
    };
    const assert = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
    const changed = async (before, label) => {
      for (let i = 0; i < 50; i++) { await pause(); if (await frame() !== before) { checks.push(label); return frame(); } }
      throw Error(label);
    };
    try {
      for (let i = 0; i < 150 && !await js("Boolean(window.__zc)"); i++) await pause();
      win.show(); win.focus(); await pause(500);
      await click("Cursor"); await pause();
      const styles = new Set([await frame()]);
      for (const name of ["Dot", "Outline", "Classic", "Rounded", "Filled"]) {
        const before = await frame(); await click(`${name} cursor`);
        styles.add(await changed(before, `${name} repaints the paused opening frame without a forced render`));
      }
      assert(styles.size === 5, "five distinct cursor styles on a recording whose first position arrives late");
      let before = await frame();
      await js("[...document.querySelectorAll('.cursor-panel-header label')].find(e=>e.textContent==='Show Cursor').querySelector('input').click()");
      await changed(before, "Show Cursor off repaints immediately");
      before = await frame();
      await js("[...document.querySelectorAll('.cursor-panel-header label')].find(e=>e.textContent==='Show Cursor').querySelector('input').click()");
      await changed(before, "Show Cursor on repaints immediately");
      before = await frame(); await click("Reset cursor"); await changed(before, "Reset cursor repaints immediately");
      before = await frame(); await click("Undo"); await changed(before, "Undo restores visible cursor settings immediately");
      before = await frame(); await setNumber("Cursor Size", 4); await changed(before, "Cursor Size changes the paused preview");
      const down = telemetry.find(event => event.k === "down");
      if (down) {
        await seek(down.t + 120); before = await frame();
        await setNumber("Cursor Click Bounce", 3.5); await changed(before, "Click bounce visibly changes a recorded click frame");
        before = await frame(); await setNumber("Bounce Speed", 700); await changed(before, "Bounce Speed changes the active bounce");
        await setNumber("Cursor Click Bounce", 0);
      }
      const moves = telemetry.filter(event => event.k === "move");
      const moving = moves.find((event, i) => i > 0 && Math.hypot(event.x - moves[i - 1].x, event.y - moves[i - 1].y) > 50);
      if (moving) {
        await seek(moving.t + 60); before = await frame();
        await setNumber("Cursor Motion Blur", 1); await changed(before, "Cursor Motion Blur visibly changes a moving frame");
        before = await frame(); await setNumber("Cursor Sway", 2); await changed(before, "Cursor Sway visibly rotates a moving cursor");
        before = await frame(); await setNumber("Smoothing", 0); await changed(before, "Smoothing changes the recorded cursor path");
        await setNumber("Cursor Motion Blur", 0); await setNumber("Cursor Sway", 0);
      }
      await seek(manifest.durationMs - 1000 / 60); before = await frame();
      await js("[...document.querySelectorAll('.cursor-panel-header label')].find(e=>e.textContent==='Loop Cursor').querySelector('input').click()");
      await changed(before, "Loop Cursor changes the final frame");
      await seek(0);
      await click("Appearance"); await click("Gradient");
      const gradients = new Set();
      for (let i = 0; i < 24; i++) {
        before = await frame(); await js(`document.querySelectorAll('.gradient-swatch')[${i}].click()`);
        if (i > 0) await changed(before, `Gradient ${i + 1} repaints immediately`); else await pause(300);
        gradients.add(await frame());
      }
      assert(gradients.size === 24, "all 24 gradients change preview pixels");
      await click("Image");
      await js("Promise.all([...document.querySelectorAll('.image-preset img')].map(image=>image.decode()))");
      const images = new Set();
      for (let i = 0; i < 24; i++) {
        before = await frame(); await js(`document.querySelectorAll('.image-preset')[${i}].click()`);
        await changed(before, `Image ${i + 1} repaints after decoding without a forced render`);
        for (let n = 0; n < 50 && await js("document.querySelector('.background-upload').disabled"); n++) await pause();
        await pause(400); images.add(await frame());
      }
      assert(images.size === 24, "all 24 bundled backgrounds visibly render");
      await click("Color"); before = await frame(); await click("Sand color background"); await changed(before, "Color background changes the paused preview");
      before = await frame(); await setNumber("Padding", 35); await changed(before, "Padding changes the paused composition");
      fs.writeFileSync(path.join(scratch, "preview.png"), (await win.webContents.capturePage()).toPNG());
      report(true); clearTimeout(timer); app.exit(0);
    } catch (error) { report(false, String(error)); clearTimeout(timer); app.exit(1); }
  });
});
import("../out/main/index.js");
