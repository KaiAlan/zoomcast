const {app}=require('electron');const fs=require('node:fs');const path=require('node:path');
const profile=path.resolve('tmp/export-decode-profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
process.env.ZOOMCAST_UI_SHOT=path.resolve('tests/fixtures/basic');process.env.ZOOMCAST_UI_SHOT_DELAY='120000';
const delay=ms=>new Promise(r=>setTimeout(r,ms));let attached=false;
const timer=setTimeout(()=>app.exit(1),120000);
app.on('browser-window-created',(_,win)=>{
 if(attached)return;attached=true;win.webContents.once('did-finish-load',async()=>{
  try{for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript('Boolean(window.__zc)'))break;await delay(100)}
   const before=await win.webContents.executeJavaScript('window.__zc.benchDecode(false)');
   const after=await win.webContents.executeJavaScript('window.__zc.benchDecode(true)');
   const result={ok:before.frames===after.frames,before,after,speedup:before.elapsedMs/after.elapsedMs};
   fs.writeFileSync('tmp/export-decode-benchmark.json',JSON.stringify(result,null,2));clearTimeout(timer);app.exit(result.ok?0:1);
  }catch(error){fs.writeFileSync('tmp/export-decode-benchmark.json',JSON.stringify({ok:false,error:String(error)}));clearTimeout(timer);app.exit(1)}
 });
});import('../out/main/index.js');
