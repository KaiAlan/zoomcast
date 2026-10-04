/** Native camera/encoder diagnostic; writes isolated media and measured rates. */
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs'); const path = require('node:path');
const { execFileSync } = require('node:child_process');
const output = path.resolve('tmp/webcam-diagnostic'); fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));
const timer=setTimeout(()=>app.exit(1),90000);
app.whenReady().then(async()=>{
 session.defaultSession.setPermissionRequestHandler((_,__,callback)=>callback(true));
 const page=path.join(output,'camera.html');fs.writeFileSync(page,'<!doctype html><body>Camera performance validation</body>');
 const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 await win.loadFile(page);
 const rows=[];
 try {
  for(const mime of ['video/webm;codecs=vp9','video/mp4;codecs=avc1.42001E']) {
   const result=await win.webContents.executeJavaScript(`(async()=>{
    const mime=${JSON.stringify(mime)};
    if(!MediaRecorder.isTypeSupported(mime))return {mime,supported:false};
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false});
    const track=stream.getVideoTracks()[0];const settings=track.getSettings();const capabilities=track.getCapabilities();
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3000000});const chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);
    const began=await new Promise(resolve=>{recorder.onstart=()=>resolve(performance.now());recorder.start(250)});
    await new Promise(resolve=>setTimeout(resolve,4000));
    await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop()});
    const elapsedMs=performance.now()-began;for(const t of stream.getTracks())t.stop();
    const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let encoded='';for(const b of bytes)encoded+=String.fromCharCode(b);
    return {mime,supported:true,settings,capabilities,elapsedMs,data:btoa(encoded)};
   })()`);
   if(result.supported){const file=path.join(output, mime.includes('webm')?'vp9.webm':'h264.mp4');fs.writeFileSync(file,Buffer.from(result.data,'base64'));delete result.data;
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_streams','-of','json',file],{encoding:'utf8',timeout:30000}));result.frames=Number(probe.streams[0].nb_read_frames);result.achievedFps=result.frames*1000/result.elapsedMs;
   }
   rows.push(result);console.log(JSON.stringify(result));
  }
  fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify({ok:true,rows},null,2));clearTimeout(timer);app.exit(0);
 }catch(err){fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify({ok:false,error:String(err),rows},null,2));clearTimeout(timer);app.exit(1);}
});
