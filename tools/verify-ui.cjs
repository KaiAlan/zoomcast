/** Native Electron UI checks. Run after npm run build with npm run verify:ui. */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = process.cwd();
const dir = path.join(root, "tmp", "ui-validation-bundle");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.cpSync(path.join(root, "tests", "fixtures", "basic"), dir, { recursive: true });
execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "6", "-an", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", path.join(dir, "webcam.mp4")], { stdio: "ignore" });
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
manifest.webcam = { file: "webcam.mp4", width: 640, height: 360, fps: 30, startOffsetMs: 0 };
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
// Keep Settings and library fixtures isolated from the user's recordings.
const profile = path.join(root, "tmp", "ui-validation-profile");
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
process.env.LOCALAPPDATA = path.join(profile, "local");
const libraryRoot = path.join(process.env.LOCALAPPDATA, "zoomcast", "recordings");
fs.rmSync(libraryRoot, { recursive: true, force: true });
fs.mkdirSync(libraryRoot, { recursive: true });
fs.cpSync(dir, path.join(libraryRoot, "2026-10-03T10-00-00"), { recursive: true });
const interrupted = path.join(libraryRoot, "2026-10-03T11-00-00");
fs.cpSync(dir, interrupted, { recursive: true });
fs.writeFileSync(path.join(interrupted, "manifest.json"), JSON.stringify({ ...manifest, status: "unclean" }));
process.env.ZOOMCAST_UI_SHOT = dir;
process.env.ZOOMCAST_UI_SHOT_DELAY = "180000";
const checks = [];
const screenshotFailures = [];
const pause = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const result = (ok, error) => fs.writeFileSync(path.join(root, "tmp", "ui-validation.json"), JSON.stringify({ ok, error, checks, screenshotFailures }, null, 2));
const timer = setTimeout(() => { result(false, "UI validation timed out"); app.exit(1); }, 150000);
let attached = false;
app.on("browser-window-created", (_, win) => {
  if (attached) return;
  attached = true;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once("did-finish-load", async () => {
    const wc = win.webContents;
    const js = (code) => wc.executeJavaScript(code);
    const screenshot = async (name, target = wc) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { fs.writeFileSync(path.join(root,"tmp",name),(await target.capturePage()).toPNG()); return; }
        catch { await pause(250); }
      }
      screenshotFailures.push(name);
    };
    const assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
    const key = async (keyCode, modifiers = []) => {
      wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      if (keyCode === "Enter") wc.sendInputEvent({ type: "char", keyCode: "\r" });
      if (keyCode === "Space") wc.sendInputEvent({ type: "char", keyCode: " " });
      wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      await pause();
    };
    const click = async (expr) => {
      const point = await js(`(()=>{const e=${expr};if(!e)throw Error('missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      wc.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
      wc.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
      await pause();
    };
    const button = (name) => `Array.from(document.querySelectorAll('button')).find(e=>(e.getAttribute('aria-label')||e.textContent.trim())===${JSON.stringify(name)})`;
    const section = (name) => `Array.from(document.querySelectorAll('summary')).find(e=>e.querySelector('span').textContent===${JSON.stringify(name)})`;
    try {
      for (let i = 0; i < 150; i++) { if (await js("Boolean(window.__zc)")) break; await pause(100); }
      assert(await js("Boolean(window.__zc)"), "editor opens camera bundle");
      win.show(); win.focus(); await pause(500);
      assert(await js("document.querySelectorAll('summary').length===6"), "six grouped inspector sections");
      assert(await js(`${section("Appearance")}.parentElement.open`), "appearance opens by default");
      assert(await js(`!${section("Advanced zoom")}.parentElement.open`), "advanced planner starts collapsed");
      assert(await js(`${button("Undo")}.disabled`), "loading does not create undo history");
      assert(await js("getComputedStyle(document.documentElement).colorScheme==='light'"), "light theme is default");
      assert(await js("document.querySelector('.editor-inspector').getBoundingClientRect().right<document.querySelector('.editor-workspace').getBoundingClientRect().right"), "settings panel sits left of preview");
      assert(await js("document.querySelector('.timeline-ruler').innerText.includes('00:00')"), "timeline ruler displays readable time labels");
      assert(await js("getComputedStyle(document.querySelector('.timeline-playhead')).backgroundColor==='rgb(40, 100, 237)'"), "timeline uses blue light-mode playhead");
      for (const button of ["right", "middle"]) {
        const point = await js("(()=>{const r=document.querySelector('.timeline-segment').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
        wc.sendInputEvent({type:"mouseDown",button,clickCount:1,...point});
        wc.sendInputEvent({type:"mouseUp",button,clickCount:1,...point}); await pause();
        assert(await js("!document.querySelector('.timeline-segment.is-selected') && !document.querySelector('[role=dialog][aria-label=\"Zoom segment controls\"]')"), `${button} button does not select or drag timeline segment`);
      }
      const initialSegments = await js("document.querySelectorAll('.timeline-segment').length");
      await click("document.querySelector('.timeline-segment')");
      assert(await js("Boolean(document.querySelector('.timeline-segment.is-selected'))"), "click selects zoom block");
      assert(await js("Boolean(document.querySelector('[role=dialog][aria-label=\"Zoom segment controls\"]'))"), "selected zoom opens redesigned popover");
      assert(await js("document.querySelectorAll('.segment-depth-presets button').length===6 && Boolean(document.querySelector('input[aria-label=\"Zoom amount slider\"]'))"), "zoom popover provides slider and six readable presets");
      await click(button("Follow camera"));
      assert(await js("document.querySelector('[aria-label=\"Follow camera\"]').getAttribute('aria-pressed')==='true'"), "camera mode switch updates selected state");
      await click(button("Timeline undo"));
      await click("document.querySelector('.timeline-segment.is-selected')");
      await click("document.querySelector('.segment-depth-presets button:nth-child(4)')");
      assert(await js("document.querySelector('.segment-depth-presets button:nth-child(4)').getAttribute('aria-pressed')==='true'"), "zoom preset highlights current selection");
      await click(button("Timeline undo"));
      await click("document.querySelector('.timeline-segment.is-selected')");
      assert(await js("(()=>{const r=document.querySelector('.segment-popover').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})()"), "zoom popover fits viewport");
      await screenshot("ui-segment-popover-light.png");
      await js("window.zoomcast.getSettings().then(settings=>window.zoomcast.setSettings({...settings,theme:'dark'}))"); await pause(150);
      assert(await js("getComputedStyle(document.querySelector('.segment-popover')).backgroundColor==='rgb(31, 31, 31)'"), "zoom popover follows dark theme");
      await screenshot("ui-segment-popover-dark.png");
      await js("window.zoomcast.getSettings().then(settings=>window.zoomcast.setSettings({...settings,theme:'light'}))"); await pause(150);
      await click(button("Delete timeline selection"));
      assert(await js("document.querySelectorAll('.timeline-segment').length") === initialSegments - 1, "timeline delete removes selected zoom");
      await click(button("Add segment"));
      assert(await js("document.querySelectorAll('.timeline-segment').length") === initialSegments, "add segment creates editable zoom in surviving gap");
      assert(await js("Boolean(document.querySelector('.timeline-segment.is-selected'))"), "new zoom is selected for editing");
      await click(button("Timeline undo"));
      assert(await js("document.querySelectorAll('.timeline-segment').length") === initialSegments - 1, "timeline undo removes added zoom");
      await click(button("Timeline redo"));
      assert(await js("document.querySelectorAll('.timeline-segment').length") === initialSegments, "timeline redo restores zoom");
      await click(button("Timeline undo")); await click(button("Timeline undo"));
      assert(await js("document.querySelectorAll('.timeline-segment').length") === initialSegments, "undo restores original zoom");
      await click(button("Zoom timeline in"));
      assert(await js("document.querySelector('.timeline-viewport').scrollWidth>document.querySelector('.timeline-viewport').clientWidth"), "timeline scale creates scrollable detail view");
      assert(await js(`${button("Undo")}.disabled`), "timeline scale does not create edit history");
      await click(button("Zoom timeline out"));
      assert(await js("document.querySelector('input[aria-label=\"Timeline zoom\"]').value==='1'"), "timeline scale returns to full take");
      await click(button("Advanced zoom"));
      assert(await js(`${button("Undo")}.disabled`), "switching tools does not create history");
      await js(`${section("Advanced zoom")}.focus()`); await key("Space");
      assert(await js(`!${section("Advanced zoom")}.parentElement.open`), "keyboard closes active panel");
      await key("Enter");
      assert(await js(`${section("Advanced zoom")}.parentElement.open`), "keyboard opens disclosure");
      assert(await js(`${button("Undo")}.disabled`), "opening disclosure does not create history");
      await key("Space");
      assert(await js(`!${section("Advanced zoom")}.parentElement.open`), "Space closes disclosure without toggling playback");
      await click(button("Audio"));
      await click("document.querySelector('input[aria-label=\"Microphone\"]')");
      await key("a", ["control"]); await wc.insertText("6"); await pause();
      await click(button("Undo"));
      assert(await js("document.querySelector('input[aria-label=\"Microphone\"]').value==='0'"), "undo restores audio gain");
      await click(button("Redo"));
      assert(await js("document.querySelector('input[aria-label=\"Microphone\"]').value==='6'"), "redo restores audio gain");
      await click(button("Save project"));
      assert(JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")).audio.micGainDb === 6, "save persists audio controls");
      assert(await js("document.querySelector('.editor-status').textContent==='Project saved'"), "save reports success");
      await click(button("Webcam"));
      const before = await js("window.__zc.renderAt(1000)");
      await click("Array.from(document.querySelectorAll('label')).find(e=>e.querySelector('span')?.textContent==='mirror').querySelector('input')");
      assert(await js("window.__zc.renderAt(1000)") !== before, "webcam control updates composition");
      await click(button("Appearance"));
      await click(button("Color"));
      assert(await js("document.querySelectorAll('.color-preset').length===12"), "appearance offers twelve color presets");
      await click(button("Sand color background")); await click(button("Save project"));
      assert(JSON.parse(fs.readFileSync(path.join(dir,"project.json"),"utf8")).style.background.color==="#eee5d9", "color preset persists to project");
      await click(button("Image"));
      assert(await js("document.querySelectorAll('.image-preset').length===24"), "appearance offers 24 built-in image backgrounds");
      await js("Promise.all([...document.querySelectorAll('.image-preset img')].map(img=>img.decode().catch(error=>{throw Error(img.src+': '+error.message)})))");
      assert(await js("[...document.querySelectorAll('.image-preset img')].every(img=>img.complete && img.naturalWidth>0)"), "image preset thumbnails decode");
      await js("window.__zc.renderAt(0)");
      await click(button("Ribbons image background")); await pause(300); await click(button("Save project"));
      const savedBg = JSON.parse(fs.readFileSync(path.join(dir,"project.json"),"utf8")).style.background;
      assert(savedBg.imageFile==="background-preset-ribbons.jpg" && fs.existsSync(path.join(dir,savedBg.imageFile)), "image preset is copied into portable project bundle");
      const pixel = await js("new Promise(resolve=>{const source=document.querySelector('.preview-canvas');const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);resolve([...ctx.getImageData(Math.round(canvas.width*.02),Math.round(canvas.height*.2),1,1).data]);};image.src=source.toDataURL();})");
      const expectedPixel = await js(`new Promise(resolve=>{const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,1920,1080);resolve([...ctx.getImageData(Math.round(canvas.width*.02),Math.round(canvas.height*.2),1,1).data]);};image.src=${JSON.stringify(`zc://app/@fs/${dir.replace(/\\/g,"/")}/background-preset-ribbons.jpg`)};})`);
      assert(pixel.slice(0,3).every((v,i)=>Math.abs(v-expectedPixel[i])<12), "paused preview repaints when preset image finishes loading");
      const imageSize = await js(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve([image.naturalWidth,image.naturalHeight]);image.onerror=reject;image.src=${JSON.stringify(`zc://app/@fs/${dir.replace(/\\/g,"/")}/${"background-preset-ribbons.jpg"}`)}})`);
      assert(imageSize[0]===3840 && imageSize[1]===2160, "bundled image decodes for preview and export");
      await js("window.__zc.renderAt(0)"); await pause(300);
      const imageFrame = await js("window.__zc.renderAt(0)");
      await screenshot("ui-image-presets.png");
      await click(button("Gradient"));
      assert(await js("window.__zc.renderAt(0)")!==imageFrame, "image preset changes rendered composition");
      assert(await js("document.querySelectorAll('.gradient-swatch').length===24"), "appearance offers 24 gradient presets");
      await click(button("Cursor"));
      assert(await js("document.querySelectorAll('.cursor-style-grid button').length===5"), "cursor panel offers five styles");
      const renderedStyles = new Set();
      for (const name of ["Classic", "Rounded", "Filled", "Dot", "Outline"]) {
        await click(button(`${name} cursor`));
        renderedStyles.add(await js("document.querySelector('.preview-canvas').toDataURL()"));
      }
      assert(renderedStyles.size===5, "every cursor style updates the paused preview without a forced render");
      for (const [label,value] of [["Cursor Size","2.5"],["Cursor Motion Blur","0.4"],["Cursor Click Bounce","3.5"],["Bounce Speed","350"],["Cursor Sway","0.2"]]) {
        await click(`document.querySelector('input[aria-label="${label}"]')`);
        await key("a", ["control"]); await wc.insertText(value); await pause();
      }
      await click("[...document.querySelectorAll('.cursor-panel-header label')].find(e=>e.textContent==='Loop Cursor').querySelector('input')");
      await click(button("Save project"));
      const savedCursor = JSON.parse(fs.readFileSync(path.join(dir,"project.json"),"utf8")).style.cursor;
      assert(savedCursor.appearance==='outline' && savedCursor.loop && savedCursor.sizePct===250 && savedCursor.motionBlur===0.4 && savedCursor.clickBounce===3.5 && savedCursor.bounceDurationMs===350 && savedCursor.sway===0.2, "all reference cursor controls persist to project");
      await screenshot("ui-cursor-effects.png");
      await click(button("Reset cursor")); await click(button("Save project"));
      assert(JSON.parse(fs.readFileSync(path.join(dir,"project.json"),"utf8")).style.cursor.clickBounce===0, "cursor reset restores inert defaults");
      await click(button("Undo")); await click(button("Save project"));
      assert(JSON.parse(fs.readFileSync(path.join(dir,"project.json"),"utf8")).style.cursor.clickBounce===3.5, "cursor reset is undoable");
      await click(button("Redo"));
      await click(button("Advanced zoom"));
      assert(await js("document.querySelectorAll('.zoom-control-group .slider-range').length===19"), "advanced zoom uses grouped sliders");
      await js("window.zoomcast.getSettings().then(settings=>window.zoomcast.setSettings({...settings,theme:'dark'}))"); await pause(200);
      // Wait for the button's CSS background transition, rather than sampling mid-animation.
      await js("Promise.all(document.querySelector('.editor-header .primary-action').getAnimations().map(animation=>animation.finished.catch(()=>undefined)))");
      assert(await js("getComputedStyle(document.querySelector('.timeline-playhead')).backgroundColor==='rgb(255, 122, 26)'"), "dark editor timeline follows ember accent");
      assert(await js("getComputedStyle(document.querySelector('.editor-header .primary-action')).backgroundColor==='rgb(255, 122, 26)'"), "dark primary action follows ember accent");
      assert(await js("getComputedStyle(document.querySelector('.editor-shell')).backgroundColor==='rgb(19, 19, 19)'"), "dark page uses deeper near-black background");
      assert(await js("getComputedStyle(document.querySelector('.slider-fill')).boxShadow!=='none'"), "dark sliders have subtle accent glow");
      await screenshot("ui-editor-dark.png");
      await js("window.zoomcast.getSettings().then(settings=>window.zoomcast.setSettings({...settings,theme:'light'}))"); await pause(200);
      await screenshot("ui-advanced-sliders.png");
      await click(button("Output"));
      assert(await js("Boolean(document.querySelector('input[aria-label=\"Height slider\"]'))"), "output resolution uses slider controls");
      await screenshot("ui-output-sliders.png");
      await click(button("Appearance"));
      await click("document.querySelector('input[aria-label=Padding]')");
      await key("a", ["control"]); await wc.insertText("25"); await pause();
      await click(button("Save project"));
      assert(JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")).style.paddingFactor === 0.75, "padding control persists to project");
      await click(button("Undo"));
      assert(await js("document.querySelector('input[aria-label=Padding]').value==='15'"), "undo restores padding slider value");
      await js("document.querySelector('.editor-inspector').scrollTop=0"); await pause();
      await screenshot("ui-editor.png");
      win.setSize(760, 720); await pause(500);
      assert(await js("document.querySelector('.editor-inspector').getBoundingClientRect().top>document.querySelector('.editor-workspace').getBoundingClientRect().top"), "narrow editor stacks inspector");
      assert(await js("document.querySelector('.editor-inspector').getBoundingClientRect().width<=innerWidth"), "narrow inspector fits window");
      assert(await js("document.querySelector('.editor-shell').scrollHeight>innerHeight"), "narrow editor scrolls to all controls");
      await screenshot("ui-editor-narrow.png");
      win.setSize(1280, 800); await pause();
      await click(button("Library"));
      for (let i = 0; i < 40; i++) { if (await js("document.querySelectorAll('.recording-card').length>0")) break; await pause(100); }
      assert(await js("document.querySelectorAll('.recording-card').length>0"), "library loads recording cards");
      assert(await js("Array.from(document.querySelectorAll('.recording-meta')).some(e=>e.textContent.includes('webcam'))"), "library shows camera metadata");
      assert(await js("Boolean(document.querySelector('.warning-badge'))"), "library marks interrupted recordings");
      await click("document.querySelector('.library-search')"); await wc.insertText("no-recording-matches-this-query"); await pause();
      assert(await js("document.querySelectorAll('.recording-card').length===0 && document.body.innerText.includes('No recordings match')"), "search displays empty result state");
      await key("a", ["control"]); await key("Backspace");
      assert(await js("document.querySelectorAll('.recording-card').length>0"), "clearing search restores recordings");
      await screenshot("ui-library.png");
      await click(button("Settings")); await pause(800);
      const settings = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("#settings"));
      assert(Boolean(settings), "library opens settings window");
      assert(await settings.webContents.executeJavaScript("document.body.innerText.includes('Record webcam')"), "settings exposes webcam capture");
      const setTheme = async theme => {
        await settings.webContents.executeJavaScript(`(()=>{const el=document.querySelector('select[aria-label="Theme"]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,${JSON.stringify(theme)});el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        await pause(250);
      };
      await setTheme("dark");
      assert(await js("document.documentElement.dataset.theme==='dark'"), "theme change updates other open windows live");
      assert(await settings.webContents.executeJavaScript("document.documentElement.dataset.theme==='dark'"), "settings uses selected dark theme");
      assert(await js("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()==='#ff7a1a'"), "dark theme uses ember orange accent");
      assert(JSON.parse(fs.readFileSync(path.join(profile,"settings.json"),"utf8")).theme==="dark", "theme preference persists to disk");
      assert(await settings.webContents.executeJavaScript("getComputedStyle(document.querySelector('select')).appearance==='none' && getComputedStyle(document.querySelector('select')).paddingRight==='30px'"), "dropdowns use consistent arrow spacing");
      await screenshot("ui-settings-dark.png", settings.webContents);
      await screenshot("ui-library-dark.png");
      // Media-query events can be deferred while Windows occludes the window.
      settings.show(); settings.focus(); await pause();
      settings.webContents.debugger.attach("1.3");
      await setTheme("system");
      await settings.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"dark"}]}); await pause();
      assert(await settings.webContents.executeJavaScript("document.documentElement.dataset.theme==='dark'"), "system theme follows dark appearance");
      await settings.webContents.debugger.sendCommand("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value:"light"}]});
      // Chromium dispatches the media-query change asynchronously, especially
      // while another renderer is exporting. Wait for the observable result.
      for (let i = 0; i < 30; i++) {
        if (await settings.webContents.executeJavaScript("document.documentElement.dataset.theme==='light'")) break;
        await pause(100);
      }
      assert(await settings.webContents.executeJavaScript("document.documentElement.dataset.theme==='light'"), "system theme follows appearance changes live");
      await setTheme("light");
      assert(await js("document.documentElement.dataset.theme==='light'"), "light theme restores across windows");
      await settings.webContents.executeJavaScript("document.querySelector('input[type=checkbox]').click()");
      await settings.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { width: 620, height: 260, deviceScaleFactor: 1, mobile: false });
      await pause(300);

      const metrics = await settings.webContents.executeJavaScript("({height:innerHeight,scroll:document.querySelector('.settings-page').scrollHeight,checked:document.querySelector('input[type=checkbox]').checked})");
      assert(metrics.scroll > metrics.height, `short settings viewport scrolls (${JSON.stringify(metrics)})`);
      settings.destroy();
      result(true); clearTimeout(timer); app.exit(0);
    } catch (error) { await screenshot("ui-failed.png"); result(false, `${String(error)} · focus=${await js("document.activeElement?.outerHTML")}`); clearTimeout(timer); app.exit(1); }
  });
});
import("../out/main/index.js");
