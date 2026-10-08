/** Native Windows wallpaper -> new take -> Appearance -> saved preview/export. */
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = process.cwd();
const scratch = path.join(root, "tmp", "desktop-background-validation");
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });
const fixture = path.join(scratch, "fixture");
fs.cpSync(path.join(root, "tests", "fixtures", "basic"), fixture, { recursive: true });
app.setPath("userData", path.join(scratch, "profile"));
process.env.LOCALAPPDATA = path.join(scratch, "local");
process.env.ZOOMCAST_UI_SHOT = fixture;
process.env.ZOOMCAST_UI_SHOT_DELAY = "180000";
const checks = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
const report = (ok, error) => fs.writeFileSync(path.join(scratch, "result.json"), JSON.stringify({ ok, error, checks }, null, 2));
const timer = setTimeout(() => { report(false, "Timed out"); app.exit(1); }, 90000);

// Read the real setting once, then simulate wallpaper changes for subsequent
// takes at the read-only API boundary. Never modify the user's Windows desktop.
let applied = null;
let realQuery;
function instrument(koffi) {
  const load = koffi.load.bind(koffi);
  realQuery = load("user32.dll").func("__stdcall", "SystemParametersInfoW", "int", ["uint32", "uint32", "void *", "uint32"]);
  koffi.load = (...args) => {
    const lib = load(...args);
    if (String(args[0]).toLowerCase() !== "user32.dll") return lib;
    const func = lib.func.bind(lib);
    return { ...lib, func: (...params) => {
      if (params[1] !== "SystemParametersInfoW") return func(...params);
      return (action, capacity, buffer, flags) => {
        if (applied === null) return realQuery(action, capacity, buffer, flags);
        buffer.fill(0); buffer.write(applied, "utf16le"); return 1;
      };
    } };
  };
}
const wallpaper = color => {
  const bitmap = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < bitmap.length; i += 4) { bitmap[i] = color[2]; bitmap[i + 1] = color[1]; bitmap[i + 2] = color[0]; bitmap[i + 3] = 255; }
  return nativeImage.createFromBitmap(bitmap, { width: 16, height: 16 }).toPNG();
};
let attached = false;
app.on("browser-window-created", (_event, win) => {
  if (attached) return;
  attached = true;
  const wc = win.webContents;
  wc.setBackgroundThrottling(false);
  wc.once("did-finish-load", async () => {
    const js = code => wc.executeJavaScript(code);
    const wait = async (condition, label) => {
      for (let i = 0; i < 150; i++) { if (await condition()) return; await delay(100); }
      throw Error(`Timed out: ${label}`);
    };
    const take = async () => {
      const before = new Set((await js("window.zoomcast.listRecordings()")).map(t => t.dir));
      const options = { sourceId: "", countdown: 0, mic: false, system: false, webcam: false, webcamDeviceId: "" };
      await js(`window.zoomcast.recorder.action('start',${JSON.stringify(options)})`);
      assert(await js("window.zoomcast.isRecording()"), "recording starts with current wallpaper state");
      await delay(700);
      await js("window.zoomcast.recorder.action('stop')");
      const recorded = (await js("window.zoomcast.listRecordings()")).find(t => !before.has(t.dir));
      assert(Boolean(recorded), "take finalizes into its own bundle");
      return js(`window.zoomcast.openBundle(${JSON.stringify(recorded.dir)})`);
    };
    try {
      await wait(() => js("Boolean(window.__zc)"), "initial editor");
      const buffer = Buffer.alloc(65536);
      const found = realQuery(0x0073, 32768, buffer, 0);
      const current = found ? buffer.toString("utf16le").split("\0")[0] : "";
      let expected = null;
      if (current) {
        for (const candidate of [current, path.join(app.getPath("appData"), "Microsoft", "Windows", "Themes", "TranscodedWallpaper")]) {
          try { const image = nativeImage.createFromBuffer(fs.readFileSync(candidate)); if (!image.isEmpty()) { expected = image.toPNG(); break; } } catch { /* Best-effort Windows source. */ }
        }
      }
      const realTake = await take();
      const snapshot = "background-desktop.png";
      const fallback = "background-preset-ribbons.jpg";
      assert(realTake.project.style.background.kind === "image" && (expected ? fs.readFileSync(path.join(realTake.dir, snapshot)).equals(expected) : realTake.project.style.background.imageFile === fallback), "real Windows wallpaper query selects the current image or the bundled fallback");
      assert(!realTake.hasSavedPlan, "wallpaper default leaves automatic zoom planning enabled");

      applied = path.join(scratch, "wallpaper-壁紙");
      const firstImage = wallpaper([12, 90, 180]);
      fs.writeFileSync(applied, firstImage);
      const first = await take();
      assert(first.project.style.background.kind === "image" && first.project.style.background.imageFile === snapshot, "each new take defaults to Image with a portable bundle-local file");
      const sameImage = (file, png) => nativeImage.createFromBuffer(fs.readFileSync(file)).toBitmap().equals(nativeImage.createFromBuffer(png).toBitmap());
      assert(sameImage(path.join(first.dir, snapshot), firstImage), "extensionless Unicode wallpaper is decoded and copied correctly");
      await wait(() => js("Boolean(window.__zc) && document.querySelector('[aria-pressed=true]') && document.querySelector('.background-upload')"), "image inspector");
      assert(await js("[...document.querySelector('legend').parentElement.querySelectorAll('button')].map(e=>e.textContent).join(',')==='Image,Gradient,Color,None'"), "Appearance background tabs show Image first");
      assert(await js("document.querySelector('.background-upload').parentElement.textContent.includes('Desktop wallpaper')"), "copied wallpaper has a readable Appearance label");
      const imageUrl = `zc://app/@fs/${path.join(first.dir, snapshot).replace(/\\/g, "/")}`;
      assert(await js(`fetch(${JSON.stringify(imageUrl)}).then(r=>r.blob()).then(createImageBitmap).then(b=>b.width===16 && b.height===16)`), "recording-local image loads through the real asset protocol");

      // Save and reload a small output to verify the actual preview and MP4 path.
      const project = first.project;
      project.output = { ...project.output, width: 640, height: 360, fps: 30 };
      project.style.frame.shadow.opacity = 0;
      await js(`window.zoomcast.saveProject(${JSON.stringify(first.dir)},${JSON.stringify(project)})`);
      const url = new URL(wc.getURL()); url.searchParams.set("bundle", first.dir);
      await wc.loadURL(url.toString());
      await wait(() => js("Boolean(window.__zc) && Boolean(document.querySelector('.background-upload'))"), "saved image project");
      await delay(400);
      const preview = nativeImage.createFromDataURL(await js("window.__zc.renderAt(0)"));
      const pixel = preview.toBitmap().subarray((4 * preview.getSize().width + 4) * 4, (4 * preview.getSize().width + 4) * 4 + 3);
      assert(Math.abs(pixel[0] - 180) <= 2 && Math.abs(pixel[1] - 90) <= 2 && Math.abs(pixel[2] - 12) <= 2, "preview renders the copied wallpaper outside the video frame");
      const output = path.join(scratch, "wallpaper.mp4");
      await js(`window.__zc.exportTo(${JSON.stringify(output)})`);
      const exported = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-vf", "crop=2:2:4:4", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
      assert(Math.abs(exported[0] - 12) <= 6 && Math.abs(exported[1] - 90) <= 6 && Math.abs(exported[2] - 180) <= 6, "exported MP4 renders the same wallpaper");
      fs.writeFileSync(path.join(scratch, "preview.png"), preview.toPNG());

      const secondImage = wallpaper([180, 60, 30]);
      fs.writeFileSync(applied, secondImage);
      const second = await take();
      assert(sameImage(path.join(second.dir, snapshot), secondImage), "next recording reads the newly applied wallpaper rather than reusing the previous image");
      assert(sameImage(path.join(first.dir, snapshot), firstImage), "later wallpaper changes leave earlier recordings unchanged");
      const reopened = await js(`window.zoomcast.openBundle(${JSON.stringify(first.dir)})`);
      assert(reopened.project.style.background.kind === "image" && reopened.project.style.background.imageFile === snapshot, "saved wallpaper appearance survives reopening");
      applied = "";
      const plain = await take();
      assert(plain.project.style.background.kind === "image" && plain.project.style.background.imageFile === fallback && fs.existsSync(path.join(plain.dir, fallback)) && !fs.existsSync(path.join(plain.dir, snapshot)), "solid-color desktops record successfully with the bundled Ribbons image fallback");
      report(true); clearTimeout(timer); app.exit(0);
    } catch (error) { report(false, String(error)); clearTimeout(timer); app.exit(1); }
  });
});
(async () => {
  instrument((await import("koffi")).default);
  await import("../out/main/index.js");
})().catch(error => { report(false, String(error)); clearTimeout(timer); app.exit(1); });
