/** Native startup -> updater -> IPC -> UI/history guard; no real downloads/toasts. */
const { app, BrowserWindow, Notification, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const profile = path.join(root, 'tmp', 'update-notices-validation-profile');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'update-history.json'), JSON.stringify({ seenVersion: 'previous-version' }));
app.setPath('userData', profile);
app.getVersion = () => require('../package.json').version;
Object.defineProperty(app, 'isPackaged', { value: true });
process.env.LOCALAPPDATA = path.join(profile, 'local');
process.env.ZOOMCAST_FFMPEG = path.join(root, 'vendor', 'ffmpeg', 'ffmpeg.exe');
process.env.ZOOMCAST_FFPROBE = path.join(root, 'vendor', 'ffmpeg', 'ffprobe.exe');
const { autoUpdater } = require('electron-updater');
const notes = require('./release-notes.cjs').loadRelease();
const [major, minor, patch] = notes.version.split('.').map(Number);
const remoteVersion = `${major}.${minor}.${patch + 1}`;
const laterVersion = `${major}.${minor}.${patch + 2}`;
const remoteNotes = `# Zoomcast ${remoteVersion}\n\n## Highlights\n\n- Split and reorder video clips.\n- Customize cursor styles and effects.\n\n## Fixed\n\n- Longer technical details remain on GitHub.\n`;
const checks = [], notifications = [], opened = [];
let providerChecks = 0, downloads = 0;
const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (condition, label) => {
  for (let i = 0; i < 200; i++) { if (await condition()) return; await delay(50); }
  throw Error(`Timed out: ${label}`);
};
const result = (ok, error) => fs.writeFileSync(path.join(root, 'tmp', 'update-notices-validation.json'), JSON.stringify({ ok, error, checks }, null, 2));
const timer = setTimeout(() => { result(false, 'timeout'); app.exit(1); }, 60000);
autoUpdater.checkForUpdates = async () => {
  providerChecks++;
  autoUpdater.emit('checking-for-update');
  autoUpdater.emit('update-available', { version: remoteVersion, releaseNotes: remoteNotes });
  return null;
};
autoUpdater.downloadUpdate = async () => { downloads++; return []; };
Notification.isSupported = () => true;
Notification.prototype.show = function () { notifications.push(this); };
Notification.prototype.close = () => undefined;
shell.openExternal = async url => { opened.push(url); };

import('../out/main/index.js').then(async () => {
  try {
    await wait(() => BrowserWindow.getAllWindows().some(win => win.webContents.getURL().endsWith('#recorder')), 'recorder startup');
    const widget = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#recorder'));
    const js = code => widget.webContents.executeJavaScript(code);
    await wait(() => js("Boolean(document.querySelector('.recorder-whats-new'))"), 'post-upgrade summary');
    assert(await js(`document.querySelector('.recorder-whats-new').textContent.includes(${JSON.stringify(notes.version)})`), 'upgraded version shows its short summary on the normal launch surface');
    assert(await js("document.querySelectorAll('.recorder-whats-new li').length") === notes.highlights.length, 'installed summary comes from the reviewed release highlights');
    assert(!await js("document.querySelector('.recorder-whats-new').textContent.includes('reopening a recording')"), 'technical GitHub details stay out of the short app summary');
    await wait(() => js("window.zoomcast.updates.state().then(s=>s.status==='available')"), 'automatic startup check');
    assert(providerChecks === 1, 'installed app checks automatically without clicking Check for updates');
    assert(downloads === 0 && notifications.length === 1, 'new version creates one notification without downloading');
    assert(await js(`document.querySelector('.recorder-update').textContent.includes(${JSON.stringify(remoteVersion)})`), 'new version is visible on the floating recorder');
    await js("document.querySelector('.recorder-update summary').click()");
    assert(await js("document.querySelector('.recorder-update').textContent.includes('Split and reorder video clips.')"), 'update availability can show the incoming short highlights');
    await delay(200);
    assert(await js("document.querySelector('.recorder-shell').scrollHeight") <= widget.getSize()[1], 'expanded update and installed summaries fit the recorder window');
    await js("document.querySelector('.recorder-whats-new button').click()");
    await wait(() => opened.length === 1, 'release notes browser link');
    assert(opened[0] === notes.url, 'installed summary opens the exact version release on GitHub');
    await js("document.querySelector('.recorder-update details button').click()");
    await wait(() => opened.length === 2, 'incoming release notes browser link');
    assert(opened[1].endsWith(`/tag/v${remoteVersion}`), 'available update links to its own detailed GitHub notes');
    for (const version of ['https://other.test', '../../bad', '99.0.0']) {
      assert(await js(`window.zoomcast.updates.openReleaseNotes(${JSON.stringify(version)}).then(()=>false,()=>true)`), 'release notes IPC refuses an unknown version');
    }
    assert(opened.length === 2, 'invalid release links never reach the browser');
    notifications[0].emit('click');
    await wait(() => BrowserWindow.getAllWindows().some(win => win.webContents.getURL().endsWith('#settings')), 'notification opens App updates');
    const settings = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#settings'));
    await wait(() => settings.webContents.executeJavaScript("Boolean(document.querySelector('.update-whats-new'))"), 'Settings summary');
    assert(await settings.webContents.executeJavaScript(`document.querySelector('.update-settings').textContent.includes(${JSON.stringify(remoteVersion)})`), 'notification click opens Settings with the available update');
    settings.hide();
    await js("window.zoomcast.updates.check()");
    assert(notifications.length === 1, 'repeat automatic/manual checks do not repeat the same notification');
    await js("[...document.querySelectorAll('.recorder-whats-new button')].find(b=>b.textContent==='Got it').click()");
    await wait(() => js("!document.querySelector('.recorder-whats-new')"), 'dismissal');
    assert(JSON.parse(fs.readFileSync(path.join(profile, 'update-history.json'), 'utf8')).seenVersion === notes.version, 'Got it persists the installed version for the next launch');
    assert(await settings.webContents.executeJavaScript("!window.document.querySelector('.update-whats-new button:last-of-type')?.textContent.includes('Got it')"), 'dismissal reaches other open windows');
    assert(await settings.webContents.executeJavaScript("Boolean(document.querySelector('.update-whats-new'))"), 'Settings retains release highlights after dismissing the launch notice');
    const countdown = js("window.zoomcast.recorder.action('start',{sourceId:'',countdown:3,mic:false,system:false,webcam:false,webcamDeviceId:''})");
    await wait(() => js("window.zoomcast.recorder.state().then(s=>s.phase==='countdown')"), 'recording countdown');
    autoUpdater.emit('update-available', { version: laterVersion });
    assert(notifications.length === 1, 'recording countdown defers the Windows notification');
    assert(!await js("document.querySelector('.recorder-whats-new') || document.querySelector('.recorder-update')"), 'update cards stay hidden during recording countdown');
    await js("window.zoomcast.recorder.action('cancel')");
    await countdown;
    autoUpdater.emit('update-available', { version: laterVersion });
    assert(notifications.length === 2, 'a later release receives a new notification');
    assert(JSON.parse(fs.readFileSync(path.join(profile, 'update-history.json'), 'utf8')).notifiedVersion === laterVersion, 'notification deduplication survives restarting the app');
    fs.writeFileSync(path.join(root, 'tmp', 'update-notices-ui.png'), (await widget.webContents.capturePage()).toPNG());
    result(true); clearTimeout(timer); app.exit(0);
  } catch (error) { result(false, String(error)); clearTimeout(timer); app.exit(1); }
}).catch(error => { result(false, String(error)); clearTimeout(timer); app.exit(1); });
