/** Native widget integration: real pointer events, capture, synchronized cuts, reopening. */
const { app, BrowserWindow, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = process.cwd();
const profile = path.join(root, "tmp", "recorder-validation-profile");
fs.rmSync(profile, {recursive:true,force:true});
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
process.env.LOCALAPPDATA = path.join(profile, "local");
const checks = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); fs.writeFileSync(path.join(root,"tmp","recorder-progress.json"), JSON.stringify(checks)); };
const timer = setTimeout(() => { fs.writeFileSync(path.join(root,"tmp","recorder-validation.json"), JSON.stringify({ok:false,error:"timeout",checks})); app.exit(1); }, 90000);
let attached = false;
app.on("browser-window-created", (_, win) => {
  if (attached) return; attached = true;
  win.webContents.once("did-finish-load", async () => {
    const wc = win.webContents;
    const js = code => wc.executeJavaScript(code);
    const click = async name => {
      const p = await js(`(()=>{const e=document.querySelector('[aria-label="${name}"]'); if(!e || e.disabled)throw Error('missing/enabled: ${name}'); const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      wc.sendInputEvent({ type:"mouseDown", button:"left", clickCount:1, ...p });
      wc.sendInputEvent({ type:"mouseUp", button:"left", clickCount:1, ...p });
      await delay(180);
    };
    const state = () => js("window.zoomcast.recorder.state()");
    const waitFor = async phase => { for(let i=0;i<150;i++){ if((await state()).phase===phase)return; await delay(100); }throw Error(`phase ${phase} timed out`); };
    try {
      await delay(500);
      assert(wc.getURL().endsWith("#recorder"), "app opens widget before recording");
      assert(!(await js("window.zoomcast.isRecording()")), "invoking app does not record");
      assert(await js("getComputedStyle(document.documentElement).backgroundColor==='rgba(0, 0, 0, 0)'"),"widget HTML background is transparent");
      assert(win.getSize()[1]===70,"closed widget window fits toolbar with no blank panel");
      assert(await js("getComputedStyle(document.querySelector('.recorder-bar')).backgroundColor==='rgb(255, 255, 255)'"), "widget uses light theme");
      assert(await js("getComputedStyle(document.querySelector('.recorder-bar')).boxShadow==='none'"), "toolbar has no drop shadow");
      assert(!win.hasShadow(), "native widget shadow disabled");
      assert(win.isAlwaysOnTop(), "widget remains above other windows");
      assert(win.getSize()[0]===430, "widget uses requested compact dimensions");
      assert(await js("[...document.querySelectorAll('.recorder-bar button')].every(button=>{const r=button.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth})"), "compact toolbar controls fit without clipping");
      assert(await js("document.querySelector('[aria-label=Microphone]').getAttribute('aria-pressed')==='false' && document.querySelector('[aria-label=\"System audio\"]').getAttribute('aria-pressed')==='false'"), "microphone and system audio start disabled");
      await click("Microphone");
      assert(await js("document.querySelector('[aria-label=Microphone]').getAttribute('aria-pressed')==='true'"), "native click enables microphone");
      await click("Microphone");
      await click("System audio"); await click("System audio");
      await click("Countdown");
      assert(await js("[...document.querySelectorAll('.recorder-choices button')].map(e=>e.textContent).join('|')==='No delay|3 seconds|5 seconds|10 seconds'"), "countdown offers 0/3/5/10 seconds");
      await js("[...document.querySelectorAll('.recorder-choices button')].find(e=>e.textContent==='3 seconds').click()");
      await click("Start recording");
      assert((await state()).phase === "countdown", "record button starts countdown");
      assert(await js("[...document.querySelectorAll('.recorder-bar button')].every(button=>{const r=button.getBoundingClientRect(),bar=document.querySelector('.recorder-bar').getBoundingClientRect();return r.left>=bar.left && r.right<=bar.right})"), "capture-state toolbar keeps close button within padded bar");
      await click("Cancel countdown"); await waitFor("idle");
      assert(!(await js("window.zoomcast.isRecording()")), "cancelled countdown creates no take");
      await click("Capture source");
      for (let i=0;i<50;i++) { if (await js("document.querySelectorAll('.recorder-source-group').length>0 && !document.querySelector('.recorder-source-list [role=status]')")) break; await delay(100); }
      assert(await js("document.querySelectorAll('.recorder-source-group').length>0"), "source dropdown renders grouped capture choices");
      await delay(200);
      assert(await js("document.querySelector('.recorder-shell').scrollHeight") <= win.getSize()[1], "expanded source dropdown fits native window");
      assert(await js("document.querySelector('.recorder-source').getAttribute('aria-expanded')==='true'"), "source picker reports expanded state");
      assert(await js("getComputedStyle(document.querySelector('.recorder-panel')).boxShadow==='none'"), "dropdown has no drop shadow");
      assert(await js("[...document.querySelectorAll('.recorder-source-preview img')].some(img=>img.complete && img.naturalWidth>0)"), "capture previews load beside source names");

      const sources = await js("window.zoomcast.recorder.sources()");
      assert(sources.some(s=>s.kind==='screen'), "screen picker enumerates actual displays");
      assert(sources.some(s=>s.kind==='window'), "window picker enumerates actual app windows");
      await js("(()=>{const el=document.querySelector('.recorder-source-search');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,'no-window-matches-this-query');el.dispatchEvent(new Event('input',{bubbles:true}));})()");
      await delay(150);
      assert(await js("document.body.innerText.includes('No matching screens or windows.')"), "source search shows empty state");
      wc.sendInputEvent({type:"keyDown",keyCode:"Escape"}); wc.sendInputEvent({type:"keyUp",keyCode:"Escape"});
      await delay(150);
      assert(await js("!document.querySelector('.recorder-panel')"), "Escape closes source dropdown");
      await delay(200);
      assert(win.getSize()[1]===70,`closing picker collapses expanded window (${JSON.stringify({size:win.getSize(),metrics:await js("({height:document.querySelector('.recorder-shell').scrollHeight,rect:document.querySelector('.recorder-shell').getBoundingClientRect().height,panel:!!document.querySelector('.recorder-panel')})")})})`);

      await click("Capture source"); await click("Microphone");
      assert(await js("!document.querySelector('.recorder-panel')"), "click outside dropdown within widget closes panel");
      await click("Microphone");
      await click("Capture source");
      const outside = new BrowserWindow({width:200,height:100,x:20,y:500,title:"Outside focus validation"});
      await outside.loadURL("data:text/html,<body>Outside widget</body>");
      win.focus(); await delay(100);
      outside.setAlwaysOnTop(true, "screen-saver");
      outside.show(); outside.focus();
      for (let i=0;i<20 && !outside.isFocused();i++) { outside.focus(); await delay(100); }
      assert(outside.isFocused(), "outside-focus test window receives native focus");
      await delay(250);
      assert(await js("!document.querySelector('.recorder-panel')"), "clicking another window closes widget dropdown");
      outside.destroy(); win.focus(); await delay(150);
      await js("window.zoomcast.getSettings().then(settings=>window.zoomcast.setSettings({...settings,theme:'dark'}))"); await delay(150);
      await click("Microphone");
      assert(await js("document.documentElement.dataset.theme==='dark' && getComputedStyle(document.querySelector('[aria-label=Microphone]')).color==='rgb(255, 122, 26)'"), "widget follows dark theme with ember enabled controls");
      await click("Microphone");
      await js("window.zoomcast.getSettings().then(settings=>window.zoomcast.setSettings({...settings,theme:'light'}))"); await delay(150);
      for (const phase of ["starting", "recording", "stopping"]) {
        wc.send("recorder:state", {phase,paused:false,cutting:false,elapsedMs:65000,countdownLeft:0,error:null}); await delay(100);
        assert(await js("[...document.querySelectorAll('.recorder-bar button')].every(button=>{const r=button.getBoundingClientRect(),bar=document.querySelector('.recorder-bar').getBoundingClientRect();return r.left>=bar.left && r.right<=bar.right && r.top>=bar.top && r.bottom<=bar.bottom})"), `${phase} layout has no overflowing controls`);
      }
      await js("window.zoomcast.recorder.state()"); await delay(100);
      if (process.argv.includes("--ui-only")) {
        fs.writeFileSync(path.join(root,"tmp","recorder-ui-validation.json"), JSON.stringify({ok:true,checks},null,2));
        clearTimeout(timer); app.exit(0); return;
      }
      await click("Countdown");
      await js("[...document.querySelectorAll('.recorder-choices button')].find(e=>e.textContent==='No delay').click()");
      // Keep the known background above unrelated desktop windows; the widget
      // retains its higher screensaver level. Focus changes must not alter pixels.
      const backdrop = new BrowserWindow({ ...screen.getPrimaryDisplay().bounds, frame:false, title:"Capture exclusion backdrop", backgroundColor:"#33aa77", alwaysOnTop:true });
      await backdrop.loadURL("data:text/html,<body style='margin:0;background:%2333aa77'></body>");
      await click("Start recording"); await waitFor("recording"); await delay(700);
      await click("Pause");
      const pausedTime = (await state()).elapsedMs; await delay(800);
      assert(Math.abs((await state()).elapsedMs-pausedTime)<100,"paused elapsed timer stays fixed");
      await click("Resume"); await delay(400);
      await click("Begin cut"); await delay(500); await click("End cut"); await delay(400);

      await click("Stop recording"); await waitFor("idle"); await delay(1000);
      const recordings = await js("window.zoomcast.listRecordings()");
      assert(recordings.length === 1, "stop finalizes one real take");
      const first = recordings[0];
      const project=JSON.parse(fs.readFileSync(path.join(first.dir,"project.json"),"utf8"));
      const manifest=JSON.parse(fs.readFileSync(path.join(first.dir,"manifest.json"),"utf8"));
      assert(project.cuts.length===2,"pause and marked section persist as two synchronized cuts");
      assert(project.cuts.every(c=>c.endMs>c.startMs && c.endMs<=manifest.durationMs),"cuts stay within captured source duration");
      const bounds = screen.dipToScreenRect(win, win.getBounds());
      const pixel = execFileSync("ffmpeg", ["-v","error","-ss","0.5","-i",path.join(first.dir,"screen.mp4"),"-vf",`crop=2:2:${bounds.x+100}:${bounds.y+45}`,"-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"], {timeout:15000});
      assert(Math.abs(pixel[0]-51)<20 && Math.abs(pixel[1]-170)<20 && Math.abs(pixel[2]-119)<20,"desktop capture sees backdrop through protected toolbar (no toolbar or black rectangle)");
      backdrop.destroy();
      assert(manifest.audio.length===0,"disabled audio roles produce no audio tracks");
      assert(BrowserWindow.getAllWindows().some(w=>w!==win && w.webContents.getURL().includes("bundle=")),"finishing take opens editor with recorded bundle");
      const target = new BrowserWindow({width:640,height:360,x:100,y:400,title:"Recorder capture validation",webPreferences:{contextIsolation:true}});
      await target.loadURL("data:text/html,<body style='margin:0;background:%2333aa77;color:white;font:32px system-ui'>Window capture verification</body>");
      const list = await js("window.zoomcast.recorder.sources()");
      const source=list.find(s=>s.name==='Recorder capture validation');
      assert(Boolean(source),"capture picker sees restored app window");
      await js(`window.zoomcast.recorder.action('start',${JSON.stringify({sourceId:source.id,countdown:0,mic:false,system:false,webcam:false,webcamDeviceId:""})})`);
      await waitFor("recording"); await delay(1200);
      await js("window.zoomcast.recorder.action('pause')"); await delay(300);
      await js("window.zoomcast.recorder.action('stop')"); await waitFor("idle");
      const second=(await js("window.zoomcast.listRecordings()"))[0];
      const m2=JSON.parse(fs.readFileSync(path.join(second.dir,"manifest.json"),"utf8"));
      const p2=JSON.parse(fs.readFileSync(path.join(second.dir,"project.json"),"utf8"));
      assert(m2.video.width<1000 && m2.video.height<600,"window source captures only client area");
      assert(p2.cuts.length===1,"stopping while paused closes pending cut");
      assert(m2.telemetry.hasCursorShapes,"second take retains process-global cursor shape reader");
      target.destroy();
      fs.writeFileSync(path.join(root,"tmp","recorder-validation.json"), JSON.stringify({ok:true,checks,recordings:[first.dir,second.dir]},null,2));
      clearTimeout(timer); app.exit(0);
    } catch (err) {

      fs.writeFileSync(path.join(root,"tmp","recorder-validation.json"),JSON.stringify({ok:false,error:String(err),checks},null,2));
      clearTimeout(timer);app.exit(1);
    }
  });
});
import("../out/main/index.js");
