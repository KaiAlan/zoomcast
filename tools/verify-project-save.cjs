/** Save/reopen and recording-switch regressions through the real Windows UI and IPC. */
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const scratch = path.join(root, "tmp", "project-save-validation");
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });
app.setPath("userData", path.join(scratch, "profile"));
process.env.LOCALAPPDATA = path.join(scratch, "local");
const first = path.join(scratch, "first");
const second = path.join(scratch, "second");
for (const [dir, id] of [[first, "save-first"], [second, "save-second"]]) {
  fs.cpSync(path.join(root, "tests", "fixtures", "basic"), dir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  manifest.id = id;
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  fs.rmSync(path.join(dir, "project.json"), { force: true });
}
process.env.ZOOMCAST_UI_SHOT = first;
process.env.ZOOMCAST_UI_SHOT_DELAY = "180000";
const checks = [];
const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const report = (ok, error) => fs.writeFileSync(path.join(root, "tmp", "project-save-validation.json"), JSON.stringify({ ok, error, checks }, null, 2));
const timer = setTimeout(() => { report(false, "Timed out"); app.exit(1); }, 60000);
let attached = false;
app.on("browser-window-created", (_, win) => {
  if (attached) return;
  attached = true;
  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  wc.once("did-finish-load", async () => {
    const js = code => wc.executeJavaScript(code);
    const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
    const waitFor = async code => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(); }
      throw Error(`Timed out: ${code}`);
    };
    const button = name => `Array.from(document.querySelectorAll('button')).find(e=>(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(name)})`;
    const click = async expr => {
      const point = await js(`(()=>{const e=${expr};if(!e)throw Error('missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      wc.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
      wc.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
      await pause(200);
    };
    const read = dir => JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
    try {
      await waitFor("Boolean(window.__zc) && document.querySelectorAll('.timeline-segment').length>0");
      win.show(); win.focus(); await pause(300);
      const original = await js("document.querySelectorAll('.timeline-segment').length");
      await click("document.querySelector('.timeline-segment')");
      await click(button("Delete timeline selection"));
      await click(button("Save project"));
      assert(read(first).zoom.segments.length === original - 1, "Save writes the deleted-shot edit to disk");
      const savedIds = read(first).zoom.segments.map(s => s.id);
      await wc.loadURL(wc.getURL());
      await waitFor("Boolean(window.__zc)"); await pause(300);
      assert(await js("document.querySelectorAll('.timeline-segment').length") === savedIds.length, "Reopening does not regenerate a deleted automatic shot");
      await click(button("Audio"));
      await click("document.querySelector('input[aria-label=\"Microphone\"]')");
      wc.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
      wc.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
      await wc.insertText("6"); await pause(200);
      wc.sendInputEvent({ type: "keyDown", keyCode: "S", modifiers: ["control"] });
      wc.sendInputEvent({ type: "keyUp", keyCode: "S", modifiers: ["control"] });
      await waitFor("document.querySelector('.editor-status').textContent==='Project saved'");
      assert(read(first).audio.micGainDb === 6, "Save writes the latest audio edit");
      assert(await js("document.querySelector('input[aria-label=\"Microphone\"]')===document.activeElement"), "Ctrl+S saves while an inspector field has focus");
      await wc.loadURL(wc.getURL()); await waitFor("Boolean(window.__zc)"); await pause(300);
      await click(button("Audio"));
      assert(await js("document.querySelector('input[aria-label=\"Microphone\"]').value==='6'"), "Audio edits survive a full editor reload");
      const projectPath = path.join(first, "project.json");
      const previous = fs.readFileSync(projectPath, "utf8");
      fs.renameSync(projectPath, `${projectPath}.previous`);
      fs.mkdirSync(projectPath);
      await click(button("Save project"));
      assert(await js("document.querySelector('.editor-status').textContent.includes('Could not save project')"), "A failed save shows a clear error");
      fs.rmdirSync(projectPath);
      fs.renameSync(`${projectPath}.previous`, projectPath);
      assert(fs.readFileSync(projectPath, "utf8") === previous, "Failed save leaves the previous project intact");
      await click(button("Save project"));
      assert(await js("document.querySelector('.editor-status').textContent==='Project saved'"), "Save can retry successfully after a disk failure");
      wc.send("recording:stopped", { dir: second, backend: "ddagrab", durationMs: 5000, unclean: false });
      await waitFor("document.querySelector('.project-name')?.textContent==='save-second' && Boolean(window.__zc)");
      await pause(300); await click(button("Save project"));
      assert(read(second).bundleId === "save-second", "A newly opened recording saves its own project identity");
      assert(read(second).audio.micGainDb === 0, "New recordings do not inherit the previous recording's edits");
      assert(read(first).audio.micGainDb === 6, "Switching recordings preserves the previous saved project");
      // Empty is a deliberate saved plan, not a request to plan again.
      for (let i = 0; i < 20 && await js("document.querySelectorAll('.timeline-segment').length>0"); i++) {
        await click("document.querySelector('.timeline-segment')"); await click(button("Delete timeline selection"));
      }
      await click(button("Save project"));
      assert(read(second).zoom.segments.length === 0, "Save retains an intentionally empty zoom timeline");
      const url = new URL(wc.getURL()); url.searchParams.set("bundle", second);
      await wc.loadURL(url.toString()); await waitFor("Boolean(window.__zc)"); await pause(300);
      assert(await js("document.querySelectorAll('.timeline-segment').length===0"), "An intentionally empty zoom timeline survives reopening");
      report(true); clearTimeout(timer); app.exit(0);
    } catch (error) { report(false, String(error)); clearTimeout(timer); app.exit(1); }
  });
});
import("../out/main/index.js");
