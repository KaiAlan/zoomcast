import { app, BrowserWindow, net, protocol } from "electron";
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

function createWindow(show = true): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show,
    backgroundColor: "#0d0e11",
    webPreferences: {
      preload: join(here, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  void win.loadURL(devUrl ?? "zc://app/index.html");

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

  const win = createWindow(false);
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

void app.whenReady().then(async () => {
  registerBundleProtocol();

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
