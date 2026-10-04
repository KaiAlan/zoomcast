/** Native export window, background recording/editing and immutable export snapshot. */
const { app, BrowserWindow, Notification } = require('electron');
const fs=require('node:fs'); const path=require('node:path'); const {execFileSync}=require('node:child_process');
const root=process.cwd();const profile=path.join(root,'tmp','background-export-profile');const dir=path.join(profile,'bundle');
fs.rmSync(profile,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
fs.cpSync(path.join(root,'tests','fixtures','basic'),dir,{recursive:true});
execFileSync('ffmpeg',['-y','-v','error','-stream_loop','11','-i',path.join(dir,'screen.mp4'),'-t','60','-c','copy',path.join(dir,'minute.mp4')],{stdio:'ignore',timeout:30000});
fs.renameSync(path.join(dir,'minute.mp4'),path.join(dir,'screen.mp4'));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));manifest.durationMs=60000;manifest.audio=[];
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest));
app.setPath('userData',profile);process.env.LOCALAPPDATA=path.join(profile,'local');process.env.ZOOMCAST_UI_SHOT=dir;process.env.ZOOMCAST_UI_SHOT_DELAY='300000';
let notifications=0;const originalShow=Notification.prototype.show;Notification.prototype.show=function(){notifications++;return originalShow.call(this)};
const checks=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));const result=(ok,error,extra={})=>fs.writeFileSync(path.join(root,'tmp','background-export-validation.json'),JSON.stringify({ok,error,checks,...extra},null,2));
const timer=setTimeout(()=>{result(false,'timeout');app.exit(1)},540000);let attached=false;
app.on('browser-window-created',(_,editor)=>{
 if(attached)return;attached=true;
 editor.webContents.once('did-finish-load',async()=>{
  const js=code=>editor.webContents.executeJavaScript(code);const assert=(condition,label)=>{if(!condition)throw Error(label);checks.push(label)};
  try{
   for(let i=0;i<100;i++){if(await js('Boolean(window.__zc)'))break;await delay(100)}
   editor.show();editor.focus();
   const out=path.join(profile,'minute-export.mp4');const began=Date.now();
   await js(`window.__zc.exportUI(${JSON.stringify(out)})`);
   const job=(await js('window.zoomcast.exports.list()'))[0];
   const worker=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes(`job=${job.id}`));
   assert(Boolean(worker) && !worker.isVisible(),'export uses a hidden background renderer');
   await delay(300);
   assert(await js("Boolean(document.querySelector('[role=progressbar]')) && document.querySelector('.workspace-tabs button[aria-pressed=true]').textContent.startsWith('Exports')"),'export progress opens in the app Exports tab');
   await js("document.querySelectorAll('.export-actions button')[0].click()");await delay(200);
   assert(!worker.isVisible(),'background worker stays hidden when switching back to editor');
   assert(await js("Boolean(document.querySelector('.editor-shell')) && !document.querySelector('.primary-action').disabled"),'editor remains usable during export');
   await delay(2000);
   await js("window.zoomcast.recorder.action('start',{sourceId:'',countdown:0,mic:false,system:false,webcam:false,webcamDeviceId:''})");
   for(let i=0;i<200;i++){if((await js('window.zoomcast.recorder.state()')).phase==='recording')break;await delay(100)}
   assert(await js('window.zoomcast.isRecording()'),'can record while export runs');
   await delay(1000);await js("window.zoomcast.recorder.action('stop')");
   for(let i=0;i<200;i++){if((await js('window.zoomcast.recorder.state()')).phase==='idle')break;await delay(100)}
   await delay(500);
   assert((await js('window.zoomcast.listRecordings()')).length===1,'background capture finalizes without stopping export');
   assert(await js(`document.body.innerText.includes(${JSON.stringify(manifest.id)})===false`),'another recording opens for editing while export continues');
   let finished;
   for(let i=0;i<4800;i++){finished=(await js('window.zoomcast.exports.list()')).find(item=>item.id===job.id);if(['done','failed','cancelled'].includes(finished.phase))break;if(i%100===0)result(false,'running',{elapsedMs:Date.now()-began,job:{...finished,preview:undefined}});await delay(100)}
   assert(finished.phase==='done',`background export finishes successfully (${finished.error??''})`);
   assert(Notification.isSupported() && notifications===1,'successful export sends a Windows completion notification');
   const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',out],{encoding:'utf8'}));
   assert(Number(probe.streams[0].nb_read_frames)===3600,'one-minute 60fps export contains all 3600 frames');
   assert(Math.abs(Number(probe.format.duration)-60)<0.05,'export retains frozen original duration while editor switches recording');
   await js(`window.zoomcast.exports.show(${JSON.stringify(job.id)})`);await delay(200);
   assert(await js("document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')==='100' && document.body.innerText.includes('Your video is ready')"),'finished progress page shows 100 percent and completion');
   try{fs.writeFileSync(path.join(root,'tmp','export-page.png'),(await editor.webContents.capturePage()).toPNG())}catch{}
   const elapsedMs=Date.now()-began;
   const second=await js(`(async()=>{const b=await window.zoomcast.openBundle(${JSON.stringify(dir)});return window.zoomcast.exports.start({bundleDir:b.dir,project:b.project,outFile:${JSON.stringify(path.join(profile,'cancelled.mp4'))}})})()`);
   let cancelled;
   for(let i=0;i<200;i++){cancelled=(await js('window.zoomcast.exports.list()')).find(item=>item.id===second);if(cancelled.phase==='rendering')break;await delay(100)}
   await js(`window.zoomcast.exports.cancel(${JSON.stringify(second)})`);
   for(let i=0;i<200;i++){cancelled=(await js('window.zoomcast.exports.list()')).find(item=>item.id===second);if(['done','failed','cancelled'].includes(cancelled.phase))break;await delay(100)}
   assert(cancelled.phase==='cancelled','background export can be cancelled');
   assert(notifications===1,'cancelled export does not send a completion notification');
   result(true,null,{elapsedMs,job:{...finished,preview:undefined}});clearTimeout(timer);app.exit(0);
  }catch(error){result(false,String(error));clearTimeout(timer);app.exit(1)}
 });
});
import('../out/main/index.js');
