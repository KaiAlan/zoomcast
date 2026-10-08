/** Native recording countdown, real Web Audio and capture/cancel lifecycle. */
const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const profile = path.join(root, 'tmp', 'countdown-validation-profile');
const bundle = path.join(profile, 'bundle');
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
fs.cpSync(path.join(root, 'tests', 'fixtures', 'basic'), bundle, { recursive: true });
app.setPath('userData', profile);
process.env.LOCALAPPDATA = path.join(profile, 'local');
process.env.ZOOMCAST_UI_SHOT = bundle;
process.env.ZOOMCAST_UI_SHOT_DELAY = '120000';
const checks = [], cues = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
const result = (ok, error) => fs.writeFileSync(path.join(root, 'tmp', 'countdown-validation.json'), JSON.stringify({ ok, error, checks, cues }, null, 2));
const timer = setTimeout(() => { result(false, 'timeout'); app.exit(1); }, 60000);
const overlay = () => BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.getTitle() === 'zoomcast countdown');
let attached = false;
app.on('browser-window-created', (_event, win) => {
  // Observe native oscillator scheduling without replacing its actual audio.
  if (attached) {
    win.webContents.once('did-finish-load', async () => {
      if (win.getTitle() !== 'zoomcast countdown') return;
      await win.webContents.executeJavaScript(`(() => {
        const original = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function () {
          const oscillator = original.call(this), start = oscillator.start.bind(oscillator);
          oscillator.start = at => { console.log('COUNTDOWN_TONE:' + JSON.stringify({frequency:oscillator.frequency.value,at})); return start(at); };
          return oscillator;
        };
      })()`);
    });
    win.webContents.on('console-message', event => {
      if (event.message.startsWith('COUNTDOWN_TONE:')) cues.push(JSON.parse(event.message.slice('COUNTDOWN_TONE:'.length)));
    });
    return;
  }
  attached = true;
  win.webContents.once('did-finish-load', async () => {
    const js = code => win.webContents.executeJavaScript(code);
    const wait = async (condition, label) => {
      for (let i = 0; i < 200; i++) { if (await condition()) return; await delay(50); }
      throw Error(`Timed out: ${label}`);
    };
    const state = () => js('window.zoomcast.recorder.state()');
    const options = { sourceId: '', countdown: 3, mic: false, system: false, webcam: false, webcamDeviceId: '' };
    try {
      await wait(() => js('Boolean(window.zoomcast)'), 'preload');
      const pending = js(`window.zoomcast.recorder.action('start',${JSON.stringify(options)})`);
      await wait(async () => (await state()).countdownLeft === 3 && overlay(), 'centered countdown');
      const cue = overlay();
      await wait(() => cue.isVisible(), 'countdown becomes visible');
      const display = screen.getPrimaryDisplay().bounds, bounds = cue.getBounds();
      assert(Math.abs(bounds.x + bounds.width / 2 - display.x - display.width / 2) <= 1 && Math.abs(bounds.y + bounds.height / 2 - display.y - display.height / 2) <= 1, 'large countdown is centered on the recorded screen');
      assert(cue.isAlwaysOnTop() && !cue.isFocusable(), 'countdown stays on top without stealing keyboard focus');
      assert(await cue.webContents.executeJavaScript("context?.state==='running'"), 'hotkey countdown can play tones without focus or another click');
      assert(await cue.webContents.executeJavaScript("parseFloat(getComputedStyle(document.querySelector('.countdown-number')).fontSize)>=140"), 'countdown uses a clearly visible large number');
      fs.writeFileSync(path.join(root, 'tmp', 'countdown-ui.png'), (await cue.webContents.capturePage()).toPNG());
      await wait(() => cue.webContents.executeJavaScript("document.querySelector('.countdown-number').textContent==='2'"), 'second digit');
      assert((await state()).countdownLeft === 2, 'centered number stays in sync with the recorder countdown');
      await js("window.zoomcast.recorder.action('cancel')");
      assert(cue.isDestroyed(), 'cancel immediately removes the centered countdown');
      await pending;
      assert((await state()).phase === 'idle' && !await js('window.zoomcast.isRecording()'), 'cancelling creates no recording');
      assert(cues.map(cue => cue.frequency).every(frequency => frequency === 660), 'cancelled countdown plays no start chime');

      cues.length = 0;
      const record = js(`window.zoomcast.recorder.action('start',${JSON.stringify(options)})`);
      await wait(() => state().then(s => s.phase === 'recording'), 'real recording');
      await record;
      assert(!overlay(), 'countdown overlay closes after recording starts');
      assert(cues.map(cue => cue.frequency).join(',') === '660,660,660,784,1047', 'three quiet ticks are followed by one different start chime');
      await delay(500);
      await js("window.zoomcast.recorder.action('stop')");
      assert((await state()).phase === 'idle', 'the actual recording stops and finalizes cleanly');
      assert((await js('window.zoomcast.listRecordings()')).length === 1, 'only the successful countdown produces a recording');

      cues.length = 0;
      const immediate = js(`window.zoomcast.recorder.action('start',${JSON.stringify({ ...options, countdown: 0 })})`);
      await wait(() => state().then(s => s.phase === 'recording'), 'no-delay recording');
      await immediate;
      assert(cues.map(cue => cue.frequency).join(',') === '784,1047', 'No delay skips the numbers and ticks but keeps the soft start chime');
      await delay(400); await js("window.zoomcast.recorder.action('stop')");
      cues.length = 0;
      await js(`window.zoomcast.recorder.action('start',${JSON.stringify({ ...options, sourceId: 'window:1:0' })})`);
      assert((await state()).phase === 'idle' && !overlay(), 'unavailable capture sources leave no stuck countdown window');
      assert(cues.length === 0, 'failed recording attempts play no start chime');
      result(true); clearTimeout(timer); app.exit(0);
    } catch (error) { result(false, String(error)); clearTimeout(timer); app.exit(1); }
  });
});
import('../out/main/index.js');
