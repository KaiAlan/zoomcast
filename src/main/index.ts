import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

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
  if (devUrl !== undefined) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(here, "../renderer/index.html"));
  }

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
