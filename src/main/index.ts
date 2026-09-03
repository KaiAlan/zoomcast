import { app, BrowserWindow, net, protocol } from "electron";
import { registerIpc } from "./ipc";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Recording bundles live outside the app directory and the renderer cannot
 * fetch file:// URLs, so media is served over a private scheme:
 *   zc://local/C:/path/to/screen.mp4
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "zc",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const RENDERER_DIR = join(here, "../renderer");
const FS_PREFIX = "/@fs/";

/**
 * The app is served from zc://app so that recording bundles, which live
 * anywhere on disk, are same-origin with the page. A file:// page cannot fetch
 * a custom scheme at all — Chromium rejects the request before it reaches the
 * handler — so serving the renderer over zc:// too is what makes bundle media
 * loadable without disabling web security.
 */
function registerBundleProtocol(): void {
  protocol.handle("zc", async (request) => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);

    const filePath = pathname.startsWith(FS_PREFIX)
      ? normalize(pathname.slice(FS_PREFIX.length))
      : join(RENDERER_DIR, normalize(pathname.replace(/^\//, "")) || "index.html");

    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      console.error(`zc:// failed for ${filePath}:`, err);
      return new Response(`not found: ${filePath}`, { status: 404 });
    }
  });
}

function createWindow(show = true, route = ""): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show,
    backgroundColor: "#0d0e11",
    webPreferences: {
      preload: join(here, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron only loads an ESM (.mjs) preload with the sandbox disabled.
      // With it on, the preload silently never runs and window.zoomcast is
      // undefined.
      sandbox: false,
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  void win.loadURL(devUrl === undefined ? `zc://app/index.html${route}` : `${devUrl}${route}`);

  return win;
}

/**
 * Headless screenshot mode. Renders a list of frame specs through the real
 * Renderer and writes PNGs, so compositor behaviour can be checked from a
 * still image instead of only by watching a window.
 *
 * Driven by ZOOMCAST_SHOOT (a JSON array of ShotSpec) and ZOOMCAST_SHOOT_DIR.
 */
async function runShoot(): Promise<void> {
  const specs = JSON.parse(process.env.ZOOMCAST_SHOOT ?? "[]") as unknown[];
  const outDir = process.env.ZOOMCAST_SHOOT_DIR ?? join(process.cwd(), "tmp", "shots");
  mkdirSync(outDir, { recursive: true });

  const win = createWindow(false, "#shoot");
  await new Promise<void>((resolve) => win.webContents.once("did-finish-load", resolve));

  // did-finish-load fires before React mounts, so wait for the hook itself
  for (let tries = 0; tries < 100; tries++) {
    const ready = (await win.webContents.executeJavaScript(
      "typeof window.__shoot === 'function'",
    )) as boolean;
    if (ready) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  for (const [i, spec] of specs.entries()) {
    const dataUrl = (await win.webContents.executeJavaScript(
      `window.__shoot(${JSON.stringify(spec)})`,
    )) as string;

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const name = join(outDir, `shot-${String(i).padStart(2, "0")}.png`);
    writeFileSync(name, Buffer.from(base64, "base64"));
    console.log(`wrote ${name}`);
  }

  app.quit();
}

/**
 * Open a bundle in the real editor and capture the window. Lets the editor be
 * checked from a still image rather than only by watching it live.
 *
 * Driven by ZOOMCAST_UI_SHOT (a bundle directory) and ZOOMCAST_UI_SHOT_OUT.
 */
async function runUiShot(): Promise<void> {
  const dir = process.env.ZOOMCAST_UI_SHOT ?? "";
  const out = process.env.ZOOMCAST_UI_SHOT_OUT ?? join(process.cwd(), "tmp", "ui.png");
  const settleMs = Number(process.env.ZOOMCAST_UI_SHOT_DELAY ?? "2500");

  const seek = process.env.ZOOMCAST_UI_SHOT_SEEK;
  const query =
    `?bundle=${encodeURIComponent(dir)}` + (seek === undefined ? "" : `&seek=${seek}`);

  const win = createWindow(false, query);
  await new Promise<void>((resolve) => win.webContents.once("did-finish-load", resolve));
  await new Promise<void>((resolve) => setTimeout(resolve, settleMs));

  const image = await win.webContents.capturePage();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, image.toPNG());
  console.log(`wrote ${out}`);

  app.quit();
}

/**
 * Export a bundle headlessly and capture preview frames from the same editor
 * instance, so preview/export parity can be checked automatically.
 *
 * Driven by ZOOMCAST_PARITY (bundle dir), ZOOMCAST_PARITY_OUT (mp4 path) and
 * ZOOMCAST_PARITY_SHOTS (comma-separated output-time ms).
 */
async function runParity(): Promise<void> {
  const dir = process.env.ZOOMCAST_PARITY ?? "";
  const out = process.env.ZOOMCAST_PARITY_OUT ?? join(process.cwd(), "tmp", "parity.mp4");
  const shots = (process.env.ZOOMCAST_PARITY_SHOTS ?? "")
    .split(",")
    .filter((s) => s.trim() !== "")
    .map(Number);

  const win = createWindow(false, `?bundle=${encodeURIComponent(dir)}`);
  await new Promise<void>((resolve) => win.webContents.once("did-finish-load", resolve));

  for (let tries = 0; tries < 200; tries++) {
    const ready = (await win.webContents.executeJavaScript(
      "typeof window.__zc === 'object' && window.__zc !== undefined",
    )) as boolean;
    if (ready) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }

  mkdirSync(dirname(out), { recursive: true });
  await win.webContents.executeJavaScript(
    `window.__zc.exportTo(${JSON.stringify(out)})`,
  );
  console.log(`exported ${out}`);

  for (const t of shots) {
    const dataUrl = (await win.webContents.executeJavaScript(
      `window.__zc.renderAt(${t})`,
    )) as string;
    const file = join(dirname(out), `preview-${t}.png`);
    writeFileSync(file, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64"));
    console.log(`wrote ${file}`);
  }

  app.quit();
}

void app.whenReady().then(async () => {
  registerBundleProtocol();
  registerIpc();

  if (process.env.ZOOMCAST_PARITY !== undefined) {
    try {
      await runParity();
    } catch (err) {
      console.error("parity run failed:", err);
      process.exitCode = 1;
      app.quit();
    }
    return;
  }

  if (process.env.ZOOMCAST_UI_SHOT !== undefined) {
    try {
      await runUiShot();
    } catch (err) {
      console.error("ui shot failed:", err);
      process.exitCode = 1;
      app.quit();
    }
    return;
  }

  if (process.env.ZOOMCAST_SHOOT !== undefined) {
    try {
      await runShoot();
    } catch (err) {
      console.error("shoot failed:", err);
      process.exitCode = 1;
      app.quit();
    }
    return;
  }

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
