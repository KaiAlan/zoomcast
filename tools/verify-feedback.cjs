/** Native form → preload → IPC → report URL. Browser launch/clipboard are captured; no report is submitted. */
const { app, BrowserWindow, shell, clipboard } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const profile = path.join(root, "tmp", "feedback-validation-profile");
fs.rmSync(profile, { recursive: true, force: true }); fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
process.env.LOCALAPPDATA = path.join(profile, "local");
process.env.ZOOMCAST_UI_SHOT = path.join(root, "tests", "fixtures", "basic");
process.env.ZOOMCAST_UI_SHOT_DELAY = "180000";
const launches = [];
const copies = [];
let failLaunch = false;
shell.openExternal = async url => { if (failLaunch) throw Error("Browser unavailable"); launches.push(url); };
clipboard.writeText = text => copies.push(text);
const checks = [];
const pause = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const report = (ok, error) => fs.writeFileSync(path.join(root, "tmp", "feedback-validation.json"), JSON.stringify({ ok, error, checks }, null, 2));
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
    const click = async expression => {
      const point = await js(`(()=>{const e=${expression};if(!e)throw Error('missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      wc.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
      wc.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point }); await pause(150);
    };
    const button = text => `Array.from(document.querySelectorAll('button')).find(e=>(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(text)})`;
    const key = async keyCode => {
      wc.sendInputEvent({ type: "keyDown", keyCode });
      if (keyCode === "Space") wc.sendInputEvent({ type: "char", keyCode: " " });
      wc.sendInputEvent({ type: "keyUp", keyCode }); await pause(150);
    };
    const fill = async (selector, text) => {
      await click(`document.querySelector(${JSON.stringify(selector)})`);
      wc.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
      wc.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
      await wc.insertText(text); await pause();
    };
    try {
      await waitFor("Boolean(window.__zc)"); win.show(); win.focus(); await pause(300);
      await click(button("Send feedback"));
      assert(await js("document.querySelector('.feedback-dialog').open"), "Editor opens an accessible feedback dialog");
      assert(await js(`${button("Open report on GitHub")}.disabled`), "Blank reports cannot be submitted");
      await fill(".feedback-dialog input", "Saved shots return & timeline resets");
      await fill(".feedback-dialog textarea", "1. Delete a shot\n2. Save\n3. Reopen\nExpected: deletion stays.");
      await click(button("Open report on GitHub"));
      assert(launches.length === 1, "The form reaches the native browser launcher once");
      const url = new URL(launches[0]);
      assert(`${url.origin}${url.pathname}` === "https://github.com/KaiAlan/zoomcast/issues/new", "Reports target the Zoomcast issue tracker");
      assert(url.searchParams.get("title") === "[Bug report] Saved shots return & timeline resets", "Summary is safely encoded in the report");
      assert(url.searchParams.get("body").includes("1. Delete a shot\n2. Save\n3. Reopen"), "Report retains multiline reproduction steps");
      assert(url.searchParams.get("body").includes(`Zoomcast ${app.getVersion()}`), "Native app version accompanies the report");
      assert(await js("document.querySelector('.feedback-status').textContent.includes('Review it and submit')"), "Feedback explains that submission happens on GitHub");
      await js(`${button("Close feedback")}.focus()`); await key("Space");
      assert(await js("!document.querySelector('.feedback-dialog').open"), "Space activates modal controls without toggling the editor player");
      assert(await js("Boolean(document.querySelector('[aria-label=Play]'))"), "Modal keyboard actions do not start video playback");
      await click(button("Send feedback"));
      assert(await js("document.querySelector('.feedback-dialog input').value.includes('Saved shots')"), "Closing and reopening retains the draft");
      const longDetails = "Cursor feedback 🎥\n".repeat(180);
      await fill(".feedback-dialog textarea", longDetails);
      await click(button("Open report on GitHub"));
      assert(launches.at(-1).length <= 2081 && !new URL(launches.at(-1)).searchParams.has("body"), "Long reports respect the Windows browser URL limit");
      assert(copies.at(-1).includes(longDetails.trim()), "Clipboard fallback retains the entire long report");
      assert(await js("document.querySelector('.feedback-status').textContent.includes('Paste it')"), "Long reports explain the clipboard paste step");
      failLaunch = true;
      await click(button("Open report on GitHub"));
      assert(await js("document.querySelector('.feedback-status').textContent.includes('Browser unavailable')"), "Browser failures produce an actionable error");
      assert(await js(`!${button("Open report on GitHub")}.disabled && document.querySelector('.feedback-dialog textarea').value.length>2000`), "Failed launch retains the draft and allows retry");
      failLaunch = false;
      await click(button("Open report on GitHub"));
      assert(await js("document.querySelector('.feedback-status').textContent.includes('Report copied')"), "Browser failure can be retried successfully");
      const before = launches.length;
      assert(await js("window.zoomcast.openFeedback({kind:'bug',title:'',details:'x'}).then(()=>false,()=>true)"), "Main process rejects invalid requests over IPC");
      assert(launches.length === before, "Invalid requests never launch the browser");
      win.setSize(760, 520); await pause(200);
      assert(await js("(()=>{const r=document.querySelector('.feedback-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()"), "Feedback dialog fits a small viewport and scrolls");
      fs.writeFileSync(path.join(root, "tmp", "feedback-ui.png"), (await wc.capturePage()).toPNG());
      await key("Escape");
      assert(await js("!document.querySelector('.feedback-dialog').open"), "Escape closes feedback");
      await js("window.zoomcast.openSettings()");
      let settings;
      for (let i = 0; i < 100; i++) {
        settings = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("#settings"));
        if (settings && await settings.webContents.executeJavaScript("document.body.innerText.includes('Send feedback')")) break;
        await pause();
      }
      assert(Boolean(settings), "Settings opens with a feedback entry point");
      await settings.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Send feedback').click()");
      assert(await settings.webContents.executeJavaScript("document.querySelector('.feedback-dialog').open"), "Settings can open the same feedback form");
      report(true); clearTimeout(timer); app.exit(0);
    } catch (error) { report(false, String(error)); clearTimeout(timer); app.exit(1); }
  });
});
import("../out/main/index.js");
