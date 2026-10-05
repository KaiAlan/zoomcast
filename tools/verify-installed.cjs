/** Native NSIS/install/update smoke test under an isolated app identity.
 * Uses a local feed with real metadata, download and quitAndInstall; no publication.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratch = path.join(root, 'tmp', 'installed-release-smoke');
const profile = path.join(scratch, 'profile');
const identity = 'zoomcast-release-smoke';
const targetVersion = require('../package.json').version;
const installDir = path.join(process.env.LOCALAPPDATA || scratch, 'Programs', identity);
const checks = [];
const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ps = text => execFileSync('powershell.exe', ['-NoProfile', '-Command', text], { encoding: 'utf8' }).trim();
const registry = () => ps("Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^zoomcast(?: [0-9]|$)' } | Select-Object PSChildName,DisplayVersion,InstallLocation | ConvertTo-Json -Compress");
const run = (exe, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(exe, args, { cwd: root, stdio: 'inherit', ...options });
  const timer = setTimeout(() => { child.kill(); reject(Error(`${exe} timed out`)); }, 600000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`${exe} exited ${code}`)); });
});
const waitFor = async (predicate, label) => {
  for (let i = 0; i < 1800; i++) { if (predicate()) return; await delay(100); }
  throw Error(`Timed out: ${label}`);
};
let server;
(async () => {
  if (process.platform !== 'win32') throw Error('Run this test with native Windows Node');
  const originalRegistry = registry();
  assert(!fs.existsSync(installDir), 'test installation starts absent');
  fs.mkdirSync(scratch, { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.rmSync(path.join(root, 'tmp', 'installed-validation.json'), { force: true });
  fs.cpSync(path.join(root, 'tests', 'fixtures', 'basic'), path.join(profile, 'bundle'), { recursive: true });
  server = http.createServer((request, response) => {
    const name = path.basename(new URL(request.url, 'http://localhost').pathname);
    const file = path.join(scratch, 'new', name);
    if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    const size = fs.statSync(file).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : size - 1;
    response.writeHead(range ? 206 : 200, { 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
    fs.createReadStream(file, { start, end }).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const feed = `http://127.0.0.1:${server.address().port}`;
  const bootstrap = path.join(scratch, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `
const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs'); const path = require('node:path');
const profile = ${JSON.stringify(profile)};
if (!process.env.ZOOMCAST_RECORD_TEST) {
app.setPath('userData', profile);
process.env.LOCALAPPDATA = path.join(profile, 'local');
autoUpdater.setFeedURL({ provider: 'generic', url: ${JSON.stringify(feed)} });
// Only automate the confirmation dialog. Updater download/install stays real.
dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const note = value => fs.appendFileSync(path.join(profile, 'events.jsonl'), JSON.stringify(value) + '\\n');
for (const event of ['checking-for-update','update-available','update-downloaded','error']) autoUpdater.on(event, value => note({ event, version: app.getVersion(), value: value instanceof Error ? value.message : value }));
app.whenReady().then(() => {
  setTimeout(async () => {
    try {
      const editor = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../preload/index.mjs'), contextIsolation: true, sandbox: false } });
      await editor.loadURL('zc://app/index.html?bundle=' + encodeURIComponent(path.join(profile, 'bundle')));
      const js = code => editor.webContents.executeJavaScript(code);
      for (let i = 0; i < 300 && !await js('Boolean(window.__zc)'); i++) await delay(100);
      if (!await js('Boolean(window.__zc)')) throw Error('Editor failed to load');
      if (app.getVersion() === '0.1.0') {
        await js('window.zoomcast.getSettings().then(s=>window.zoomcast.setSettings({...s,theme:"dark"}))');
        await js('window.__zc.exportTo(' + JSON.stringify(path.join(profile, 'installed-export.mp4')) + ')');
        await js('window.zoomcast.updates.check()');
        for (let i = 0; i < 200 && (await js('window.zoomcast.updates.state()')).status !== 'available'; i++) await delay(100);
        if ((await js('window.zoomcast.updates.state()')).status !== 'available') throw Error('New version not detected');
        await js('window.zoomcast.updates.download()');
        if ((await js('window.zoomcast.updates.state()')).status !== 'downloaded') throw Error('Installer not downloaded');
        await js(${JSON.stringify('document.querySelector(\'.tool-rail [aria-label="Appearance"]\').click()')});
        await delay(100);
        await js('[...document.querySelectorAll("button")].find(e=>e.textContent==="Color").click()');
        await delay(100);
        await js(${JSON.stringify('document.querySelector(\'[aria-label="Sand color background"]\').click()')});
        await delay(100);
        note({ event: 'requesting-real-install', version: app.getVersion() });
        await js('window.zoomcast.updates.install()');
      } else {
        const settings = await js('window.zoomcast.getSettings()');
        const project = JSON.parse(fs.readFileSync(path.join(profile, 'bundle', 'project.json')));
        if (settings.theme !== 'dark' || project.style.background.color !== '#eee5d9') throw Error('Settings or unsaved edits lost during upgrade');
        fs.writeFileSync(path.join(profile, 'upgrade-result.json'), JSON.stringify({ ok: true, version: app.getVersion(), settings, project }));
        app.exit(0);
      }
    } catch (error) { fs.writeFileSync(path.join(profile, 'upgrade-result.json'), JSON.stringify({ ok: false, error: String(error) })); app.exit(1); }
  }, 1000);
});
}
import('./index.js');
`);
  fs.copyFileSync(bootstrap, path.join(root, 'out', 'main', 'release-smoke.cjs'));
  execFileSync(process.execPath, ['--check', bootstrap]);
  for (const [folder, version] of [['old', '0.1.0'], ['new', targetVersion]]) {
    const config = path.join(scratch, `${folder}.json`);
    fs.writeFileSync(config, JSON.stringify({ extends: path.join(root, 'electron-builder.yml'), appId: `dev.zoomcast.${identity}`, productName: 'Zoomcast Release Smoke', executableName: identity, artifactName: `zoomcast-smoke-${version}.\${ext}`, directories: { output: path.join(scratch, folder) }, extraMetadata: { name: identity, version, main: './out/main/release-smoke.cjs' }, files: ['out/**/*', 'package.json', { from: bootstrap, to: 'out/main/release-smoke.cjs' }], nsis: { shortcutName: 'Zoomcast Release Smoke', runAfterFinish: true, createDesktopShortcut: false, createStartMenuShortcut: false } }, null, 2));
    await run(process.execPath, [path.join(root, 'node_modules', 'electron-builder', 'cli.js'), '--config', config, '--win', '--x64', '--publish', 'never']);
  }
  await run(path.join(scratch, 'old', 'zoomcast-smoke-0.1.0.exe'), ['/S']);
  const executable = path.join(installDir, `${identity}.exe`);
  assert(fs.existsSync(executable), 'NSIS performs a clean per-user installation');
  assert(registry() === originalRegistry, 'isolated install leaves existing Zoomcast registration unchanged');
  const env = { ...process.env, PATH: path.join(process.env.SystemRoot, 'System32') };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [], { cwd: root, env, stdio: 'ignore' });
  child.on('error', error => fs.writeFileSync(path.join(profile, 'upgrade-result.json'), JSON.stringify({ ok: false, error: String(error) })));
  const resultFile = path.join(profile, 'upgrade-result.json');
  await waitFor(() => fs.existsSync(resultFile), 'real update restart');
  const result = JSON.parse(fs.readFileSync(resultFile));
  assert(result.ok, result.error || `installed updater restarts into version ${targetVersion}`);
  assert(result.version === targetVersion, 'restarted installation reports the new version');
  const events = fs.readFileSync(path.join(profile, 'events.jsonl'), 'utf8');
  assert(events.includes('update-available') && events.includes('update-downloaded') && events.includes('requesting-real-install'), 'real provider detection, download and install handoff occur');
  assert(fs.statSync(path.join(profile, 'installed-export.mp4')).size > 10000, 'installed app exports a real MP4 without PATH FFmpeg');
  assert(result.settings.theme === 'dark', 'settings survive installation upgrade');
  assert(result.project.style.background.color === '#eee5d9', 'restart saves unsaved editor changes and preserves them through upgrade');
  await run(process.execPath, [path.join(root, 'tools', 'verify-packaged.cjs')], { env: { ...process.env, ZOOMCAST_VERIFY_EXECUTABLE: executable } });
  const capture = JSON.parse(fs.readFileSync(path.join(root, 'tmp', 'packaged-validation.json')));
  for (const check of capture.checks) assert(capture.ok, `installed capture: ${check}`);
  await delay(2000);
  const uninstall = fs.readdirSync(installDir).find(name => /^Uninstall.*\.exe$/i.test(name));
  assert(Boolean(uninstall), 'NSIS includes an uninstaller');
  await run(path.join(installDir, uninstall), ['/S']);
  await waitFor(() => !fs.existsSync(executable), 'isolated uninstall');
  assert(!fs.existsSync(executable), 'uninstall removes the isolated application');
  assert(fs.existsSync(path.join(profile, 'bundle', 'project.json')) && fs.existsSync(path.join(profile, 'settings.json')), 'uninstall preserves projects and settings');
  assert(registry() === originalRegistry, 'update and uninstall leave existing Zoomcast registration unchanged');
  console.log(`${checks.length} installed release checks passed`);
  fs.writeFileSync(path.join(root, 'tmp', 'installed-validation.json'), JSON.stringify({ ok: true, checks }, null, 2));
})().catch(error => {
  console.error(error);
  fs.writeFileSync(path.join(root, 'tmp', 'installed-validation.json'), JSON.stringify({ ok: false, error: String(error), checks }, null, 2));
  process.exitCode = 1;
}).finally(() => { server?.close(); fs.rmSync(path.join(root, 'out', 'main', 'release-smoke.cjs'), { force: true }); });
