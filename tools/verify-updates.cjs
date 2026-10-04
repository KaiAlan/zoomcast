/** Native updater UI/IPC guard. Simulates provider events; never installs or publishes. */
const { app, BrowserWindow, dialog, net, safeStorage } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const profile = path.join(root, "tmp", "updates-validation-profile");
const bundle = path.join(profile, "bundle");
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
fs.cpSync(path.join(root, "tests", "fixtures", "basic"), bundle, { recursive: true });
app.setPath("userData", profile);
process.env.LOCALAPPDATA = path.join(profile, "local");
process.env.ZOOMCAST_UI_SHOT = bundle;
process.env.ZOOMCAST_UI_SHOT_DELAY = "120000";
const checks = [];
const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = (ok, error) => fs.writeFileSync(path.join(root, "tmp", "updates-validation.json"), JSON.stringify({ ok, error, checks }, null, 2));
const timer = setTimeout(() => { result(false, "timeout"); app.exit(1); }, 60000);
let installs = 0;
let downloads = 0;
let accessRequests = 0;
let allowAccess = true;
const originalFetch = net.fetch.bind(net);
net.fetch = async (url, options) => {
  if (String(url).startsWith("https://api.github.com/repos/KaiAlan/zoomcast/releases")) {
    accessRequests++;
    return new Response("[]", { status: allowAccess ? 200 : 403 });
  }
  return originalFetch(url, options);
};
autoUpdater.quitAndInstall = () => { installs++; };
autoUpdater.downloadUpdate = async () => {
  downloads++;
  autoUpdater.emit("download-progress", { percent: 42 });
  return ["simulated-installer.exe"];
};
dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
let attached = false;
app.on("browser-window-created", (_event, editor) => {
  if (attached) return;
  attached = true;
  editor.webContents.once("did-finish-load", async () => {
    const js = code => editor.webContents.executeJavaScript(code);
    const wait = async code => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await delay(50); }
      throw Error(`Wait failed: ${code}`);
    };
    try {
      await wait("Boolean(window.__zc && document.querySelector('.editor-shell'))");
      assert((await js("window.zoomcast.updates.state()")).status === "disabled", "development/headless startup does not contact update feed");
      const access = await js("window.zoomcast.updates.access()");
      assert(access.configured === false && access.canStore === true, "native Windows encrypted credential storage is available");
      assert(Object.keys(access).sort().join("|") === "canStore|configured", "credential API never returns the token");
      const bad = await js("window.zoomcast.updates.setAccess('bad').then(()=>false,()=>true)");
      assert(bad, "invalid credential is rejected before network or storage");
      assert(!fs.existsSync(path.join(profile, "update-access.bin")), "invalid credential is not persisted");
      assert(accessRequests === 0, "malformed credentials do not make an access request");
      const encrypted = safeStorage.encryptString("synthetic-validation-credential");
      assert(!encrypted.includes(Buffer.from("synthetic-validation-credential")) && safeStorage.decryptString(encrypted) === "synthetic-validation-credential", "Windows protection encrypts credentials and round-trips correctly");
      await js("window.zoomcast.updates.setAccess('synthetic-validation-credential')");
      const stored = fs.readFileSync(path.join(profile, "update-access.bin"));
      assert(!stored.includes(Buffer.from("synthetic-validation-credential")) && safeStorage.decryptString(stored) === "synthetic-validation-credential", "verified credential is persisted encrypted by the app");
      assert((await js("window.zoomcast.updates.access()")).configured === true, "saved access reports only configured status");
      allowAccess = false;
      assert(await js("window.zoomcast.updates.setAccess('synthetic-rejected-credential').then(()=>false,()=>true)"), "repository access failure rejects a replacement credential");
      assert(fs.readFileSync(path.join(profile, "update-access.bin")).equals(stored), "rejected replacement preserves existing encrypted access");
      await js("window.zoomcast.updates.setAccess(null)");
      assert(!fs.existsSync(path.join(profile, "update-access.bin")) && !(await js("window.zoomcast.updates.access()")).configured, "removing update access deletes the saved credential");
      autoUpdater.emit("update-available", { version: "0.1.2" });
      await wait("Boolean([...document.querySelectorAll('.update-notice button')].find(e=>e.textContent==='Update'))");
      assert(downloads === 0, "new release shows Update without automatically downloading");
      await js("window.zoomcast.toggleRecording()");
      const widget = BrowserWindow.getAllWindows().find(win => win !== editor);
      assert(Boolean(widget), "normal app launch surface opens the recorder widget");
      for (let i=0;i<100;i++) {
        if (!widget.webContents.isLoading() && await widget.webContents.executeJavaScript("Boolean(document.querySelector('.recorder-update button'))")) break;
        await delay(50);
      }
      await delay(200);
      assert(await widget.webContents.executeJavaScript("document.querySelector('.recorder-update button')?.textContent==='Update'"), "Update is also visible on the floating recorder at app launch");
      assert(await widget.webContents.executeJavaScript("document.querySelector('.recorder-shell').scrollHeight") <= widget.getSize()[1], "recorder window expands to fit the update action");
      widget.hide();
      await js("document.querySelector('.update-notice button').click()");
      await wait("Boolean(document.querySelector('.update-notice progress'))");
      assert(downloads === 1 && await js("document.querySelector('.update-notice progress').value===42"), "Update click downloads once and displays progress");
      autoUpdater.emit("update-downloaded", { version: "0.1.2" });
      await wait("document.querySelector('.update-notice button')?.textContent==='Restart to update'");
      assert(installs === 0, "download completion waits for explicit restart");
      const exportId = await js(`(async()=>{const b=await window.zoomcast.openBundle(${JSON.stringify(bundle)});return window.zoomcast.exports.start({bundleDir:b.dir,project:b.project,outFile:${JSON.stringify(path.join(profile, "update-blocked-export.mp4"))}})})()`);
      await js("window.zoomcast.updates.install()");
      assert(installs === 0 && (await js("window.zoomcast.updates.state()")).message.includes("exports"), "restart is refused while a real background export is active");
      await js(`window.zoomcast.exports.cancel(${JSON.stringify(exportId)})`);
      await wait(`window.zoomcast.exports.list().then(jobs=>jobs.find(job=>job.id===${JSON.stringify(exportId)})?.phase==='cancelled')`);
      assert(installs === 0, "cancelling an export does not automatically restart for update");
      const countdown = js("window.zoomcast.recorder.action('start',{sourceId:'',countdown:3,mic:false,system:false,webcam:false,webcamDeviceId:''})");
      await wait("window.zoomcast.recorder.state().then(s=>s.phase==='countdown')");
      await js("window.zoomcast.updates.install()");
      assert(installs === 0 && (await js("window.zoomcast.updates.state()")).message.includes("recording"), "restart is refused during recording countdown");
      await js("window.zoomcast.recorder.action('cancel')");
      await countdown;
      // Change the project without pressing Save, then exercise the real
      // main -> preload -> editor -> saved acknowledgment before restart.
      await js("document.querySelector('.tool-rail [aria-label=\"Appearance\"]').click()");
      await delay(100);
      await js("[...document.querySelectorAll('button')].find(e=>e.textContent==='Color').click()");
      await delay(100);
      await js("document.querySelector('[aria-label=\"Sand color background\"]').click()");
      await delay(100);
      assert(!fs.existsSync(path.join(bundle, "project.json")) || JSON.parse(fs.readFileSync(path.join(bundle, "project.json"))).style.background.color !== "#eee5d9", "edited project is unsaved before restart");
      await js("window.zoomcast.updates.install()");
      assert(JSON.parse(fs.readFileSync(path.join(bundle, "project.json"))).style.background.color === "#eee5d9", "restart saves current editor project through preload acknowledgment");
      assert(installs === 1 && (await js("window.zoomcast.updates.state()")).status === "installing", "saved idle app hands restart to updater exactly once");
      await js("window.zoomcast.updates.install()");
      assert(installs === 1, "repeated restart cannot invoke another installation");
      fs.writeFileSync(path.join(root, "tmp", "updates-ui.png"), (await editor.webContents.capturePage()).toPNG());
      result(true); clearTimeout(timer); app.exit(0);
    } catch (error) { result(false, String(error)); clearTimeout(timer); app.exit(1); }
  });
});
import("../out/main/index.js");
