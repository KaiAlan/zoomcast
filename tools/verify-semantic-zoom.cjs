/** Native Windows accessibility integration. Isolated profile, no installed app changes. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const scratch = path.join(process.cwd(), 'tmp', 'semantic-zoom-validation');
fs.mkdirSync(scratch, { recursive: true });
app.setPath('userData', path.join(scratch, 'profile'));
buildSync({ entryPoints: ['src/main/capture/SemanticTargetReader.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(scratch, 'reader.cjs') });
const { SemanticTargetReader } = require(path.join(scratch, 'reader.cjs'));
const checks = [];
const assert = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let reader;
let native;
const report = (ok, error) => fs.writeFileSync(path.join(scratch, 'result.json'), JSON.stringify({ ok, error, checks }, null, 2));
const timer = setTimeout(() => { reader?.stop(); native?.kill(); report(false, 'Timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  const win = new BrowserWindow({ width: 1000, height: 740, x: 40, y: 40, frame: false, show: true, webPreferences: { contextIsolation: true } });
  try {
    const html = `<!doctype html><style>body{margin:0;font:18px sans-serif;background:white}button{width:80px;height:40px}#toolbar{position:absolute;left:30px;top:30px;width:760px;height:50px;background:#ddd}#message{position:absolute;left:130px;top:200px;width:620px;height:160px}#menu{position:absolute;left:780px;top:180px;width:160px;height:180px;background:#eee}#group{position:absolute;left:20px;top:460px;width:550px;height:180px;background:#ccd}#private{position:absolute;left:100px;top:390px;width:600px;height:35px}</style><div id="toolbar" role="toolbar" aria-label="Tools"><button id="tool">Select</button><button>Pen</button><button>Shape</button></div><textarea id="message" aria-label="Message">A full message box for framing.</textarea><div id="menu" role="menu"><button id="item" role="menuitem">Open</button><button role="menuitem">Save</button></div><div id="group" role="group" aria-label="Settings"><button id="option">Option</button></div><input id="private" type="password" value="private-value-never-collected" aria-label="Secret">`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    win.show(); win.focus(); await delay(700);
    const content = win.getContentBounds();
    const { screen } = require('electron');
    const physical = screen.dipToScreenRect(win, content);
    const scale = physical.width / content.width;
    const capture = { x: physical.x, y: physical.y, w: physical.width, h: physical.height };
    const bounds = id => win.webContents.executeJavaScript(`JSON.parse(JSON.stringify(document.getElementById(${JSON.stringify(id)}).getBoundingClientRect()))`);
    const query = async (id, focus = false) => {
      const r = await bounds(id);
      if (focus) { await win.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)}).focus()`); await delay(100); }
      return reader.query(capture.x + (r.x + r.width / 2) * scale, capture.y + (r.y + r.height / 2) * scale, focus, capture);
    };
    const matches = (context, expected) => context && Math.abs(context.rect.x - expected.x * scale) < 4
      && Math.abs(context.rect.y - expected.y * scale) < 4
      && Math.abs(context.rect.w - expected.width * scale) < 4 && Math.abs(context.rect.h - expected.height * scale) < 4;
    reader = SemanticTargetReader.start();
    assert(Boolean(reader), 'Windows built-in accessibility reader starts');
    const toolbar = await query('tool');
    fs.writeFileSync(path.join(scratch, 'contexts.json'), JSON.stringify({ toolbar, capture, scale }, null, 2));
    assert(toolbar?.role === 'ToolBar', 'browser toolbar button resolves to its whole toolbar');
    assert(matches(toolbar, await bounds('toolbar')), 'toolbar bounds match physical capture pixels, including DPI');
    const message = await query('message', true);
    assert(message?.role === 'Edit' && matches(message, await bounds('message')), 'focused multiline browser field retains the whole input area');
    const menu = await query('item');
    assert(menu?.role === 'Menu' && matches(menu, await bounds('menu')), 'browser menu item resolves to whole popup menu');
    const group = await query('option');
    assert(group?.role === 'Group' && matches(group, await bounds('group')), 'settings control resolves to its relevant group');
    const secret = await query('private', true);
    assert(secret?.role === 'Edit', 'password field can be framed without reading its value');
    assert(!JSON.stringify(secret).includes('private') && Object.keys(secret).sort().join(',') === 'rect,role', 'semantic metadata contains only role and rectangle');
    const outside = await reader.query(capture.x + 300, capture.y + 300, false, { x: capture.x + 3000, y: capture.y, w: capture.w, h: capture.h });
    assert(outside === null, 'outside-capture controls contribute no metadata');
    // Exercise the real recorder pipeline as well as standalone provider reads.
    buildSync({ entryPoints: ['src/main/capture/TelemetryRecorder.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'koffi', 'uiohook-napi'], outfile: path.join(scratch, 'telemetry.cjs') });
    const { TelemetryRecorder } = require(path.join(scratch, 'telemetry.cjs'));
    const { uIOhook } = require('uiohook-napi');
    const log = path.join(scratch, 'input.jsonl'); fs.writeFileSync(log, '');
    const recorder = TelemetryRecorder.start(log, Date.now(), () => ({ x: capture.x, y: capture.y, width: capture.w, height: capture.h }), reader);
    const tool = await bounds('tool');
    uIOhook.emit('mousedown', { x: capture.x + (tool.x + 10) * scale, y: capture.y + (tool.y + 10) * scale, button: 1 });
    await delay(250);
    await win.webContents.executeJavaScript("document.getElementById('message').focus()"); await delay(100);
    uIOhook.emit('keydown', { keycode: 30 }); await delay(350);
    await recorder.stop();
    const events = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const click = events.find(e => e.k === 'down');
    assert(click && Math.abs(click.x - (tool.x + 10) * scale) < 1, 'recorder maps physical click coordinates into the selected capture');
    assert(events.some(e => e.k === 'context' && e.trigger === 'down' && e.t === click.t && e.target.role === 'ToolBar'), 'recorder stores full toolbar bounds at the original click timestamp');
    assert(events.some(e => e.k === 'context' && e.trigger === 'key' && e.target.role === 'Edit'), 'typing telemetry records focused-field bounds');
    assert(!fs.readFileSync(log, 'utf8').includes('message box') && !fs.readFileSync(log, 'utf8').includes('private-value'), 'capture stores no accessible text or input values');
    // A real Win32/.NET app supplies different providers from Chromium.
    win.hide();
    const nativeScript = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type 'using System; using System.Runtime.InteropServices; public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'
[Dpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Zoomcast Native Validation'
$form.TopMost = $true
$form.StartPosition = 'Manual'
$form.Location = [System.Drawing.Point]::new(100,100)
$form.ClientSize = [System.Drawing.Size]::new(780,460)
$text = New-Object System.Windows.Forms.TextBox
$text.Location = [System.Drawing.Point]::new(30,60)
$text.Size = [System.Drawing.Size]::new(600,140)
$text.Multiline = $true
$form.Controls.Add($text)
$combo = New-Object System.Windows.Forms.ComboBox
$combo.Location = [System.Drawing.Point]::new(30,230)
$combo.Size = [System.Drawing.Size]::new(400,28)
$combo.Items.Add('First') | Out-Null
$form.Controls.Add($combo)
$form.Add_Shown({
  [Dpi]::ShowWindow($form.Handle,5) | Out-Null
  [Dpi]::SetForegroundWindow($form.Handle) | Out-Null
  $text.Focus() | Out-Null
  $capture = $form.RectangleToScreen($form.ClientRectangle)
  $a = $text.RectangleToScreen($text.ClientRectangle)
  $b = $combo.RectangleToScreen($combo.ClientRectangle)
  [Console]::Out.WriteLine((@{ capture=@{x=$capture.X;y=$capture.Y;w=$capture.Width;h=$capture.Height}; text=@{x=$a.X;y=$a.Y;w=$a.Width;h=$a.Height}; combo=@{x=$b.X;y=$b.Y;w=$b.Width;h=$b.Height} } | ConvertTo-Json -Depth 4 -Compress))
})
$form.ShowDialog() | Out-Null
`;
    native = spawn(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(nativeScript, 'utf16le').toString('base64')], { windowsHide: true });
    native.stderr.resume();
    const positions = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Native fixture did not start')), 8000);
      createInterface({ input: native.stdout }).once('line', line => { clearTimeout(timeout); try { resolve(JSON.parse(line)); } catch (err) { reject(err); } });
      native.once('error', err => { clearTimeout(timeout); reject(err); });
    });
    await delay(300);
    // The recorder above owns/stops its reader; use a fresh reader here.
    reader = SemanticTargetReader.start();
    const textbox = await reader.query(positions.text.x + 40, positions.text.y + 40, false, positions.capture);
    fs.writeFileSync(path.join(scratch, 'native-contexts.json'), JSON.stringify({ positions, textbox }, null, 2));
    assert(textbox?.role === 'Edit' && Math.abs(textbox.rect.x - (positions.text.x - positions.capture.x)) < 4 && Math.abs(textbox.rect.y - (positions.text.y - positions.capture.y)) < 4 && textbox.rect.w >= 595 && textbox.rect.h >= 135, 'native Windows multiline field retains its full bounds');
    const combo = await reader.query(positions.combo.x + 40, positions.combo.y + 10, false, positions.capture);
    fs.writeFileSync(path.join(scratch, 'native-contexts.json'), JSON.stringify({ positions, textbox, combo }, null, 2));
    assert(combo?.role === 'ComboBox' && combo.rect.w >= 395, 'native dropdown frames the entire control including its arrow');
    native.kill(); native = null;
    reader.stop();
    assert(await query('tool') === null, 'stopped reader does not leak work or wait on new requests');
    const abort = SemanticTargetReader.start();
    const pending = abort.query(0, 0, false, capture); abort.stop();
    assert(await pending === null, 'shutdown resolves cold-start queries and kills its helper');
    report(true); console.log(`Passed ${checks.length} native semantic checks`);
    clearTimeout(timer); win.destroy(); app.exit(0);
  } catch (error) { reader?.stop(); native?.kill(); report(false, String(error.stack || error)); clearTimeout(timer); win.destroy(); console.error(error); app.exit(1); }
});
