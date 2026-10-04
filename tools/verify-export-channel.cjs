/** Native guard for the dedicated frame channel's failure and ownership paths. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = process.cwd();
const profile = path.join(root, 'tmp', 'export-channel-profile');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
process.env.LOCALAPPDATA = path.join(profile, 'local');
process.env.ZOOMCAST_UI_SHOT = path.join(root, 'tests', 'fixtures', 'basic');
process.env.ZOOMCAST_UI_SHOT_DELAY = '120000';
const checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (ok, error) => fs.writeFileSync(path.join(root, 'tmp', 'export-channel-validation.json'), JSON.stringify({ ok, error, checks }, null, 2));
const assert = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
const timer = setTimeout(() => { save(false, 'timeout'); app.exit(1); }, 90000);
let attached = false;
app.on('browser-window-created', (_, editor) => {
  if (attached) return;
  attached = true;
  editor.webContents.once('did-finish-load', async () => {
    const js = code => editor.webContents.executeJavaScript(code);
    const options = encoder => ({ width: 32, height: 32, fps: 10, bitrateMbps: 2, durationMs: 100, cuts: [], audio: [], syncNudgeMs: 0, encoder, outFile: path.join(profile, `${encoder}.mp4`) });
    const connect = id => js(`new Promise((resolve, reject) => {
      const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(Error('channel setup timeout')); }, 10000);
      const receive = event => {
        if (event.source !== window || event.data?.type !== 'zoomcast:export-port' || event.data.id !== ${JSON.stringify(id)}) return;
        clearTimeout(timer); window.removeEventListener('message', receive);
        window.__exportTestPort = event.ports[0]; window.__exportTestPort.start(); resolve(true);
      };
      window.addEventListener('message', receive);
      window.zoomcast.exportConnect(${JSON.stringify(id)}).catch(error => { clearTimeout(timer); window.removeEventListener('message', receive); reject(error); });
    })`);
    const send = (bytes, sequence = 0) => js(`new Promise((resolve, reject) => {
      const port = window.__exportTestPort;
      const timer = setTimeout(() => reject(Error('frame acknowledgement timeout')), 10000);
      const closed = () => { clearTimeout(timer); resolve({ error: 'channel closed' }); };
      port.onmessage = event => { clearTimeout(timer); port.removeEventListener('close', closed); resolve(event.data); };
      port.addEventListener('close', closed, { once: true });
      port.postMessage({ sequence: ${sequence}, frame: new Uint8Array(${bytes}).fill(255) });
    })`);
    try {
      const id = await js(`window.zoomcast.exportStart(${JSON.stringify(options('libx264'))})`);
      const outsider = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'out', 'preload', 'index.mjs'), contextIsolation: true, sandbox: false } });
      await outsider.loadURL('zc://app/index.html');
      const wrongOwner = await outsider.webContents.executeJavaScript(`window.zoomcast.exportConnect(${JSON.stringify(id)}).then(() => false, () => true)`);
      assert(wrongOwner, 'another renderer cannot acquire the session channel');
      const wrongCancel = await outsider.webContents.executeJavaScript(`window.zoomcast.exportCancel(${JSON.stringify(id)}, 'wrong owner').then(() => false, () => true)`);
      assert(wrongCancel, 'another renderer cannot cancel the session');
      outsider.destroy();
      assert(await connect(id), 'owner receives the channel in its main world');
      assert(await js(`window.zoomcast.exportConnect(${JSON.stringify(id)}).then(() => false, () => true)`), 'duplicate channel connection is rejected');
      assert(await js(`window.zoomcast.exportFrame(${JSON.stringify(id)},new Uint8Array(4096)).then(() => false, () => true)`), 'legacy IPC cannot interleave writes with a dedicated channel');
      const reply = await send(4096);
      assert(reply.sequence === 0 && !reply.error, 'valid frame receives an encoder acknowledgement');
      await js(`window.zoomcast.exportFinish(${JSON.stringify(id)})`);
      const count = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', options('libx264').outFile], { encoding: 'utf8', timeout: 10000 }).trim();
      assert(count === '1', 'acknowledged frame survives finalization');
      const malformedId = await js(`window.zoomcast.exportStart(${JSON.stringify({ ...options('libx264'), outFile: path.join(profile, 'malformed.mp4') })})`);
      await connect(malformedId);
      const malformed = await send(3);
      assert(typeof malformed.error === 'string', 'malformed frame fails promptly without entering encoder');
      assert(await js(`window.zoomcast.exportConnect(${JSON.stringify(malformedId)}).then(() => false, () => true)`), 'malformed frame removes its session');
      const failingId = await js(`window.zoomcast.exportStart(${JSON.stringify(options('zoomcast_missing_encoder'))})`);
      await connect(failingId);
      // Pipe writes can complete while ffmpeg is still initializing. Wait for
      // the actual failure, rather than assuming the process exited after a delay.
      let failure;
      for (let sequence = 0; sequence < 200; sequence++) {
        failure = await send(4096, sequence);
        if (failure.error) break;
        await delay(50);
      }
      assert(typeof failure.error === 'string', 'encoder failure rejects frame acknowledgement');
      await delay(100);
      const log = fs.readFileSync(path.join(profile, 'main-error.log'), 'utf8');
      assert(log.includes('export:channel-closed:') && log.includes("Unknown encoder 'zoomcast_missing_encoder'"), 'encoder failure retains the actual ffmpeg diagnostic');
      save(true, null); clearTimeout(timer); app.exit(0);
    } catch (error) { save(false, String(error)); clearTimeout(timer); app.exit(1); }
  });
});
import('../out/main/index.js').catch(error => { save(false, String(error)); clearTimeout(timer); app.exit(1); });
