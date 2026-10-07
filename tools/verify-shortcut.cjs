/** Real NSIS clean install/upgrade, Explorer hotkey, single-instance routing and uninstall.
 * Separate app identity and Ctrl+Alt+F12 keep the user's installed Zoomcast untouched.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { uIOhook, UiohookKey } = require("uiohook-napi");
const root = path.resolve(__dirname, "..");
const scratch = path.join(root, "tmp", "shortcut-smoke");
const profile = path.join(scratch, "profile");
const identity = "zoomcast-shortcut-smoke";
const product = "Zoomcast Shortcut Smoke";
const installDir = path.join(process.env.LOCALAPPDATA, "Programs", identity);
const executable = path.join(installDir, `${identity}.exe`);
const checks = [];
const pids = new Set();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
const ps = code => execFileSync("powershell.exe", ["-NoProfile", "-Command", code], { encoding: "utf8" }).trim();
const registry = () => ps("Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^zoomcast(?: [0-9]|$)' } | Select-Object PSChildName,DisplayVersion,InstallLocation | ConvertTo-Json -Compress");
const wait = async (predicate, label, ms = 45000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await predicate()) return; await pause(100); }
  throw Error(`Timed out: ${label}`);
};
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: "inherit" });
  const timer = setTimeout(() => { child.kill(); reject(Error("Process timed out")); }, 300000);
  child.once("error", error => { clearTimeout(timer); reject(error); });
  child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)); });
});
let sequence = 0;
const command = async (action) => {
  const seq = ++sequence;
  const temporary = path.join(profile, "command.tmp");
  fs.writeFileSync(temporary, JSON.stringify({ seq, action }));
  fs.renameSync(temporary, path.join(profile, "command.json"));
  let result;
  await wait(() => {
    try { result = JSON.parse(fs.readFileSync(path.join(profile, "response.json"))); return result.seq === seq; } catch { return false; }
  }, action);
  if (result.error) throw Error(result.error);
  pids.add(result.pid);
  return result;
};
const press = () => uIOhook.keyTap(UiohookKey.F12, [UiohookKey.Ctrl, UiohookKey.Alt]);
const quit = async () => {
  const { pid } = await command("quit");
  await wait(() => ps(`if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) {'running'}`) !== "running", "app quits");
  pids.delete(pid);
};
const writeBootstrap = () => {
  const file = path.join(root, "out", "main", "shortcut-smoke.cjs");
  fs.writeFileSync(file, `
const {app,BrowserWindow,globalShortcut}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const profile=${JSON.stringify(profile)};
app.setPath('userData',profile);
const setAppId=app.setAppUserModelId.bind(app);
app.setAppUserModelId=()=>setAppId('dev.zoomcast.shortcut-smoke');
process.env.LOCALAPPDATA=path.join(profile,'local');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const ready=async()=>{for(let i=0;i<300;i++){const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#recorder'));if(w&&await w.webContents.executeJavaScript('Boolean(window.zoomcast)'))return w;await pause(100)}throw Error('No recorder')};
app.whenReady().then(()=>{
 let busy=false,last=0;
 setInterval(async()=>{
  if(busy)return;
  let cmd;try{cmd=JSON.parse(fs.readFileSync(path.join(profile,'command.json')))}catch{return}
  if(cmd.seq===last)return;last=cmd.seq;busy=true;
  try{
   const w=await ready();const js=c=>w.webContents.executeJavaScript(c);let extra={};
   if(cmd.action==='hide')for(const win of BrowserWindow.getAllWindows())win.hide();
   if(cmd.action==='theme')await js('window.zoomcast.getSettings().then(s=>window.zoomcast.setSettings({...s,theme:"dark"}))');
   if(cmd.action==='startup-on')extra.startup=await js('window.zoomcast.setStartWithWindows(true)');
   if(cmd.action==='startup-off')extra.startup=await js('window.zoomcast.setStartWithWindows(false)');
   if(cmd.action==='invalid')extra.rejected=await js('window.zoomcast.setStartWithWindows("yes").then(()=>false,()=>true)');
   if(cmd.action==='settings'){
    await js('window.zoomcast.openSettings()');
    for(let i=0;i<100;i++){const s=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('#settings'));if(s&&await s.webContents.executeJavaScript('document.body.innerText.includes("Recording shortcut")&&document.body.innerText.includes("Ctrl+Alt+F12")')){extra.settingsText=await s.webContents.executeJavaScript('document.body.innerText');extra.startupDisabled=await s.webContents.executeJavaScript('document.querySelector("section input").disabled');fs.writeFileSync(path.join(profile,'settings.png'),(await s.webContents.capturePage()).toPNG());break}await pause(100)}
   }
   const state=await js('window.zoomcast.shortcutState()');
   const result={seq:cmd.seq,pid:process.pid,state,settings:await js('window.zoomcast.getSettings()'),recorderVisible:w.isVisible(),recorderCount:BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('#recorder')).length,competingRegistration:globalShortcut.isRegistered('Control+Alt+F12'),...extra};
   fs.writeFileSync(path.join(profile,'response.json'),JSON.stringify(result));
   if(cmd.action==='quit')app.quit();
  }catch(error){fs.writeFileSync(path.join(profile,'response.json'),JSON.stringify({seq:cmd.seq,pid:process.pid,error:String(error)}))}
  finally{busy=false}
 },100);
});
import('./index.js');
`);
  execFileSync(process.execPath, ["--check", file]);
  return file;
};

(async () => {
  if (process.platform !== "win32") throw Error("Run with Windows Node");
  assert(!fs.existsSync(installDir), "Isolated installation starts absent");
  fs.mkdirSync(scratch, { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true }); fs.mkdirSync(profile);
  const originalRegistry = registry();
  writeBootstrap();
  const empty = path.join(scratch, "old-installer.nsh"); fs.writeFileSync(empty, "; No persistent shortcut before this fix\n");
  const installers = {};
  for (const [kind, version] of [["old", "0.1.3"], ["new", "0.1.4"]]) {
    const config = path.join(scratch, `${kind}.json`);
    fs.writeFileSync(config, JSON.stringify({ extends: path.join(root, "electron-builder.yml"), compression: "store", appId: "dev.zoomcast.shortcut-smoke", productName: product, executableName: identity, artifactName: `shortcut-${kind}.\${ext}`, directories: { output: path.join(scratch, kind) }, extraMetadata: { name: identity, version, main: "./out/main/shortcut-smoke.cjs" }, files: ["out/**/*", "package.json"], nsis: { differentialPackage: false, include: kind === "old" ? empty : path.join(root, "build", "installer.nsh"), shortcutName: product, runAfterFinish: false, createDesktopShortcut: false, createStartMenuShortcut: false } }, null, 2));
    await run(process.execPath, [path.join(root, "node_modules", "electron-builder", "cli.js"), "--config", config, "--win", "--x64", "--publish", "never"]);
    installers[kind] = path.join(scratch, kind, `shortcut-${kind}.exe`);
  }
  await run(installers.old, ["/S"]);
  spawn(executable, [], { cwd: root, stdio: "ignore" });
  await command("theme"); await quit();
  await run(installers.new, ["/S"]);
  const marker = path.join(installDir, "record-shortcut.path");
  const [link, label] = fs.readFileSync(marker, "utf16le").replace(/^\uFEFF/, "").split(/\r?\n/);
  assert(fs.existsSync(link) && label === "Ctrl+Alt+F12", "Upgrade automatically creates the persistent Windows launcher");
  const quoted = link.replace(/'/g, "''");
  const details = JSON.parse(ps(`$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut('${quoted}'); @{Target=$s.TargetPath;Args=$s.Arguments;Hotkey=$s.Hotkey} | ConvertTo-Json -Compress`));
  assert(details.Target.toLowerCase() === executable.toLowerCase() && details.Args === "--record" && details.Hotkey.includes("F12"), "Installed shortcut targets the recorder and contains launch keys");
  await pause(2000); press();
  const cold = await command("state");
  assert(cold.state.mode === "launcher" && cold.recorderVisible, "Actual Windows hotkey cold-launches the upgraded app and shows its recorder");
  assert(cold.settings.theme === "dark", "Upgrade preserves existing settings");
  assert(!cold.competingRegistration, "Electron does not steal the Windows launcher keys");
  await command("hide"); await pause(300); press();
  let warm;
  await wait(async () => { warm = await command("state"); return warm.recorderVisible; }, "running recorder responds to Windows shortcut");
  assert(warm.pid === cold.pid && warm.recorderVisible && warm.recorderCount === 1, "Hotkey brings the running recorder forward without a second instance");
  const ui = await command("settings");
  assert(ui.settingsText?.includes("even after Quit") && !ui.startupDisabled, "Settings shows the real launcher keys and enabled startup control");
  assert((await command("invalid")).rejected, "Startup IPC rejects non-boolean input");
  assert((await command("startup-on")).state.startWithWindows, "Start with Windows can be enabled through native IPC");
  assert(!(await command("startup-off")).state.startWithWindows, "Startup preference can be turned off again");
  await quit(); await pause(400); press();
  const afterQuit = await command("state");
  assert(afterQuit.pid !== warm.pid && afterQuit.recorderVisible, "The same hotkey restarts Zoomcast after explicit Quit");
  await quit();
  const uninstall = fs.readdirSync(installDir).find(name => /^Uninstall.*\.exe$/i.test(name));
  await run(path.join(installDir, uninstall), ["/S"]);
  await wait(() => !fs.existsSync(executable), "uninstall");
  assert(!fs.existsSync(link), "Uninstall removes the Windows launch shortcut");
  assert(fs.existsSync(path.join(profile, "settings.json")), "Uninstall preserves user settings");
  fs.rmSync(profile, { recursive: true, force: true }); fs.mkdirSync(profile);
  await run(installers.new, ["/S"]);
  assert(fs.existsSync(link), "Clean installation also adds the launcher without setup choices");
  await pause(2000); press();
  const fresh = await command("state");
  assert(fresh.state.mode === "launcher" && fresh.recorderVisible, "Actual launch keys work following a clean installation");
  assert(fresh.settings.theme === "system" && !fresh.state.startWithWindows, "Fresh users get working launch keys without enabling startup or configuring settings");
  await quit(); await run(path.join(installDir, uninstall), ["/S"]);
  await wait(() => !fs.existsSync(executable), "clean-install cleanup");
  assert(registry() === originalRegistry, "Verification leaves the existing Zoomcast installation registration unchanged");
  fs.writeFileSync(path.join(root, "tmp", "shortcut-validation.json"), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(`${checks.length} installed shortcut checks passed`);
})().catch(error => {
  console.error(error);
  fs.writeFileSync(path.join(root, "tmp", "shortcut-validation.json"), JSON.stringify({ ok: false, error: String(error), checks }, null, 2));
  process.exitCode = 1;
}).finally(async () => {
  for (const pid of pids) { try { process.kill(pid); } catch {} }
  // Explorer can finish launching after a failed assertion; only stop this test identity.
  ps("Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'zoomcast-shortcut-smoke.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }");
  if (fs.existsSync(installDir)) {
    const uninstaller = fs.readdirSync(installDir).find(name => /^Uninstall.*\.exe$/i.test(name));
    if (uninstaller) { try { await run(path.join(installDir, uninstaller), ["/S"]); } catch {} }
  }
  fs.rmSync(path.join(root, "out", "main", "shortcut-smoke.cjs"), { force: true });
});
