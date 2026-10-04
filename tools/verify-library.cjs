/** Native gallery/library integration, with disposable fixtures and recording profile. */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const profile = path.join(root,"tmp","library-validation-profile");
fs.rmSync(profile,{recursive:true,force:true});fs.mkdirSync(profile,{recursive:true});
app.setPath("userData",profile);process.env.LOCALAPPDATA=path.join(profile,"local");
const recordingRoot=path.join(process.env.LOCALAPPDATA,"zoomcast","recordings");
fs.mkdirSync(recordingRoot,{recursive:true});
const ids=["2026-09-01T10-00-00","2026-09-02T10-00-00","2026-10-02T10-00-00","2026-10-03T10-00-00"];
for(const [i,id] of ids.entries()){
 const dir=path.join(recordingRoot,id);fs.cpSync(path.join(root,"tests","fixtures","basic"),dir,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,"manifest.json"),"utf8"));
 manifest.id=id;manifest.createdAt=`${id.slice(0,10)}T10:00:00Z`;manifest.durationMs=5000+i*250;manifest.status=i===3?"unclean":"clean";
 fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify(manifest));
}
process.env.ZOOMCAST_UI_SHOT=" ";process.env.ZOOMCAST_UI_SHOT_DELAY="180000";
const pause=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];
const result=(ok,error)=>fs.writeFileSync(path.join(root,"tmp","library-validation.json"),JSON.stringify({ok,error,checks},null,2));
const assert=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);fs.writeFileSync(path.join(root,"tmp","library-progress.json"),JSON.stringify(checks));};
const timer=setTimeout(()=>{result(false,"Timeout");app.exit(1)},120000);
let attached=false;
app.on("browser-window-created",(_,win)=>{
 if(attached)return;attached=true;
 win.webContents.once("did-finish-load",async()=>{
  let wc=win.webContents;
  const js=code=>wc.executeJavaScript(code);
  const wait=async(code,label)=>{for(let i=0;i<200;i++){if(await js(code))return;await pause(100)}throw Error(label)};
  const click=async expr=>{
   const p=await js(`(()=>{const e=${expr};if(!e||e.disabled)throw Error('missing/enabled control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
   wc.sendInputEvent({type:"mouseMove",...p});wc.sendInputEvent({type:"mouseDown",button:"left",clickCount:1,...p});wc.sendInputEvent({type:"mouseUp",button:"left",clickCount:1,...p});await pause(200);
  };
  const aria=name=>`document.querySelector('[aria-label="${name}"]')`;
  const nav=name=>`[...document.querySelectorAll('.library-nav-item')].find(e=>e.querySelector('span')?.textContent===${JSON.stringify(name)})`;
  const card=id=>`document.querySelector('[data-recording-id="${id}"]')`;
  const action=(id,name)=>`${card(id)}.querySelector('[aria-label="${name}"]')`;
  const folderCreate=async name=>{
   await click(aria("New folder"));await wait("Boolean(document.querySelector('dialog[open]'))","folder dialog");
   await click("document.querySelector('#folder-name')");await wc.insertText(name);
   await click("document.querySelector('dialog button[type=submit]')");
   await wait("!document.querySelector('dialog')","folder created");
   const lib=await js("window.zoomcast.library.get()");return lib.folders.find(f=>f.name===name);
  };
  try{
   win.show();win.focus();await wait("document.querySelectorAll('.recording-card').length===4","initial library cards");
   assert(await js("document.querySelector('.recording-collection').dataset.view==='gallery'"),"gallery is the default view");
   assert(await js("document.querySelector('[aria-label=\"Sort recordings\"]').value==='recent'"),"Recent first is the default sort");
   assert(await js(`document.querySelector('.recording-card').dataset.recordingId===${JSON.stringify(ids[3])}`),"newest recording appears first");
   await wait("[...document.querySelectorAll('.recording-preview img')].filter(i=>i.complete&&i.naturalWidth>0).length===4","actual recording preview images");
   assert(true,"all gallery previews are extracted from recorded video");
   const bounds=await js(`(()=>{const r=${card(ids[3])}.getBoundingClientRect();return {x:Math.round(r.x+60),y:Math.round(r.y+40)}})()`);wc.sendInputEvent({type:"mouseMove",...bounds});await pause(250);
   assert(await js(`getComputedStyle(${card(ids[3])}.querySelector('.recording-card-actions')).opacity==='1'`),"hover reveals archive/move/delete actions");
   fs.writeFileSync(path.join(root,"tmp","library-gallery.png"),(await wc.capturePage()).toPNG());
   await click(aria("List view"));
   assert(await js("document.querySelector('.recording-collection').dataset.view==='list'"),"view toggle switches to list");
   fs.writeFileSync(path.join(root,"tmp","library-list.png"),(await wc.capturePage()).toPNG());
   await click(aria("Gallery view"));
   await js("(()=>{const s=document.querySelector('[aria-label=\"Sort recordings\"]');s.value='oldest';s.dispatchEvent(new Event('change',{bubbles:true}))})()");await pause(200);
   assert(await js(`document.querySelector('.recording-card').dataset.recordingId===${JSON.stringify(ids[0])}`),"sorting changes card order");
   await click(aria("Search recordings"));await wc.insertText("2026-09-02");await pause(200);
   assert(await js("document.querySelectorAll('.recording-card').length===1"),"search filters gallery");
   await click(nav("All recordings"));
   await click(action(ids[3],"Archive recording"));await wait("document.querySelectorAll('.recording-card').length===3","archive removes card");
   assert(await js("!document.querySelector('.editor-shell')"),"card actions do not open the editor");
   await click(nav("Archive"));await wait("document.querySelectorAll('.recording-card').length===1","archive view");
   assert(await js(`Boolean(${card(ids[3])})`),"archived recording has a dedicated view");
   await click(action(ids[3],"Restore recording"));await wait("document.querySelectorAll('.recording-card').length===0","restore archive");
   await click(nav("All recordings"));await wait("document.querySelectorAll('.recording-card').length===4","restored library");
   const parent=await folderCreate("Tutorials");assert(Boolean(parent),"native dialog creates a persistent folder");
   const child=await folderCreate("Demos");assert(child.parentId===parent.id,"folders support nested children");
   await click(nav("All recordings"));await click(action(ids[2],"Move recording"));
   await js(`(()=>{const s=document.querySelector('[aria-label="Move recording to folder"]');s.value=${JSON.stringify(child.id)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause(400);
   await click(nav("Demos"));await wait("document.querySelectorAll('.recording-card').length===1","move folder card");
   assert(await js(`Boolean(${card(ids[2])})`),"move places recording inside selected folder");
   assert(await js("document.querySelector('.library-breadcrumb').textContent.includes('Tutorials / Demos')"),"nested folder breadcrumbs are shown");
   assert(fs.existsSync(path.join(recordingRoot,ids[2],"screen.mp4")),"moving preserves original media path");
   const persisted=JSON.parse(fs.readFileSync(path.join(recordingRoot,".library.json"),"utf8"));
   assert(persisted.entries[ids[2]].folderId===child.id,"folder assignment is persisted on disk");
   fs.writeFileSync(path.join(root,"tmp","library-folder.png"),(await wc.capturePage()).toPNG());
   await click(nav("All recordings"));await click(action(ids[0],"Delete recording"));await wait("document.querySelectorAll('.recording-card').length===3","delete card");
   assert(!fs.existsSync(path.join(recordingRoot,ids[0])),"Delete sends only the selected disposable fixture to Recycle Bin");
   await click(nav("Demos"));
   await click("[...document.querySelectorAll('.library-header-actions button')].find(e=>e.textContent==='Record in this folder')");await pause(600);
   const widget=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith("#recorder"));assert(Boolean(widget),"Record in this folder opens floating controls");
   const originalWc=wc;wc=widget.webContents;
   await wait("Boolean(document.querySelector('.recorder-bar'))","recording widget loaded");
   assert((await js("window.zoomcast.recorder.state()")).folderId===child.id,"recorder captures selected folder destination");
   assert(await js("document.querySelector('.recorder-source-label small').textContent==='Demos'"),"widget shows destination folder");
   const opts={sourceId:"",countdown:0,mic:false,system:false,webcam:false,webcamDeviceId:""};
   await js(`window.zoomcast.recorder.action('start',${JSON.stringify(opts)})`);await pause(1300);
   await js("window.zoomcast.recorder.action('stop')");await pause(1000);
   const lib=await js("window.zoomcast.library.get()");const take=lib.recordings.find(r=>!ids.includes(r.id));
   assert(Boolean(take)&&take.folderId===child.id,"new real recording is saved directly into the chosen folder");
   wc=originalWc;await wait("Boolean(document.querySelector('.editor-shell'))","recording editor");
   await click(aria("Library"));await wait("Boolean(document.querySelector('.library-content'))","return library");
   assert(await js("document.querySelector('#library-title').textContent==='Demos'"),"returning from editor remembers selected folder");
   await wait("document.querySelectorAll('.recording-card').length===2","folder new take count");
   // Native responsive verification with the gallery kept usable.
   win.setSize(760,720);await pause(400);
   assert(await js("document.querySelector('.library-content').getBoundingClientRect().right<=innerWidth+1"),"library toolbar and gallery fit narrow window");
   fs.writeFileSync(path.join(root,"tmp","library-narrow.png"),(await wc.capturePage()).toPNG());
   result(true);clearTimeout(timer);app.exit(0);
  }catch(error){fs.writeFileSync(path.join(root,"tmp","library-failed.png"),(await wc.capturePage()).toPNG());result(false,String(error));clearTimeout(timer);app.exit(1)}
 });
});
import("../out/main/index.js");
