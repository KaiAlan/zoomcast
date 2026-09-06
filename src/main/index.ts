import { app, BrowserWindow, Menu, net, protocol } from "electron";
import { registerIpc } from "./ipc";
import { abortRecording } from "./capture/SessionController";
import { startedHidden } from "./autostart";
import {
  registerEditorOpener,
  registerRecordingControls,
  registerSettingsOpener,
  teardownRecordingControls,
} from "./recording";
import { registerDisplayMediaHandler } from "./capture/AudioRecorder";
import { preloadPath, rendererUrl } from "./windows";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Windows groups taskbar buttons, jump lists and notifications by this id.
 * Without it an installed build shows up as "Electron" and gets its own,
 * separate taskbar slot from the shortcut that launched it.
 */
app.setAppUserModelId("dev.zoomcast.app");

/**
 * The headless modes each spawn their own Electron while a normal instance may
 * already be running, so the single-instance lock must not apply to them —
 * taking it would make verify:parity and friends exit immediately.
 */
const HEADLESS_MODES = [
  "ZOOMCAST_PARITY",
  "ZOOMCAST_UI_SHOT",
  "ZOOMCAST_SHOOT",
  "ZOOMCAST_RECORD_TEST",
];

const headless = HEADLESS_MODES.some((key) => process.env[key] !== undefined);

// A second launch — from the Start menu, or the shortcut — must reach the
// running tray app rather than start a rival one that cannot get the hotkey.
if (!headless && !app.requestSingleInstanceLock()) app.exit(0);

/** Electron's main-process stdout does not reach the launching shell on
 *  Windows, so anything fatal goes to a file we can actually read. */
function logFatal(where: string, err: unknown): void {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  try {
    const file = join(app.getPath("userData"), "main-error.log");
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `[${new Date().toISOString()}] ${where}: ${message}\n`, "utf8");
  } catch {
    // Nothing sensible left to do.
  }
  console.error(where, message);
}

process.on("uncaughtException", (err) => logFatal("uncaughtException", err));
process.on("unhandledRejection", (err) => logFatal("unhandledRejection", err));

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
      const res = await net.fetch(pathToFileURL(filePath).toString());

      // In production the page is zc://app, so this is same-origin. Under
      // `npm run dev` the renderer comes from http://localhost and reaching
      // zc:// is cross-origin, which needs an explicit allow.
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", "*");

      return new Response(res.body, { status: res.status, headers });
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
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron only loads an ESM (.mjs) preload with the sandbox disabled.
      // With it on, the preload silently never runs and window.zoomcast is
      // undefined.
      sandbox: false,
    },
  });

  void win.loadURL(rendererUrl(route));

  return win;
}

let settingsWindow: BrowserWindow | null = null;

/**
 * One settings window, focused if it already exists.
 *
 * Smaller than the editor and not resizable to editor proportions: it holds one
 * control today and a handful later, and a 1400x900 window for that reads as a
 * mistake.
 */
function openSettings(): void {
  if (settingsWindow !== null && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = createWindow(true, "#settings");
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.setSize(620, 380);
  settingsWindow.center();
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
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

/**
 * Record for a few seconds and write the outcome to a file, so capture can be
 * exercised without a person clicking. Electron's main-process stdout does not
 * reach the launching shell on Windows, hence the file.
 *
 * Driven by ZOOMCAST_RECORD_TEST=<seconds>, result at tmp/record-test.json.
 *
 * ZOOMCAST_RECORD_TEST_RUNS=<n> records n times in ONE process. That is not a
 * convenience: process-global state initialised per recording is invisible to a
 * single-run test, and exactly that bug shipped once. koffi.struct() registers
 * a NAMED type in a process-global registry, the registration sat inside
 * CursorShapeReader.start(), and the second recording of every app session
 * threw, was swallowed, and silently produced no shape stream. zoomcast is a
 * tray app that lives for days, so run 2 is the normal case, not the edge one.
 * Every run's manifest is reported so a regression shows as run 2 losing what
 * run 1 had.
 */
async function runRecordTest(): Promise<void> {
  const seconds = Number(process.env.ZOOMCAST_RECORD_TEST ?? "4");
  const runs = Math.max(1, Number(process.env.ZOOMCAST_RECORD_TEST_RUNS ?? "1"));
  const resultFile = join(app.getPath("userData"), "record-test.json");
  mkdirSync(dirname(resultFile), { recursive: true });

  const write = (payload: unknown): void => {
    writeFileSync(resultFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  };

  const { startRecording, stopRecording } = await import("./capture/SessionController");
  const { runCountdown, showRecordingBorder } = await import("./overlays");

  const results: unknown[] = [];

  try {
    for (let run = 0; run < runs; run++) {
      await runCountdown(1);
      await startRecording();

      const border = showRecordingBorder();
      await new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000));
      border.destroy();

      const stopped = await stopRecording();
      const manifestPath = join(stopped.dir, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        telemetry?: { hasCursorShapes?: boolean };
      };
      const events = readFileSync(join(stopped.dir, "input.jsonl"), "utf8");

      results.push({
        run: run + 1,
        ...stopped,
        hasCursorShapes: manifest.telemetry?.hasCursorShapes ?? false,
        cursorEvents: (events.match(/"k":"cursor"/g) ?? []).length,
      });
    }

    write(runs === 1 ? { ok: true, ...(results[0] as object) } : { ok: true, runs: results });
  } catch (err) {
    write({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      completed: results,
    });
  }

  app.quit();
}

/** Bring the editor back, creating it if the app is running window-less. */
function showEditor(): void {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());

  if (win === undefined) {
    createWindow();
    return;
  }

  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

void app.whenReady().then(async () => {
  // Single-purpose tool: the default File/Edit/View/Window menu is noise.
  Menu.setApplicationMenu(null);

  registerBundleProtocol();
  registerDisplayMediaHandler();
  registerIpc();
  registerEditorOpener(showEditor);
  registerSettingsOpener(openSettings);

  app.on("second-instance", showEditor);

  // Registered before any headless mode returns, so screenshots and the record
  // test see the same tray and hotkey state the real app has.
  try {
    registerRecordingControls();
  } catch (err) {
    logFatal("registerRecordingControls", err);
  }

  if (process.env.ZOOMCAST_PARITY !== undefined) {
    try {
      await runParity();
    } catch (err) {
      console.error("parity run failed:", err);
      // app.exit, not quit: a graceful quit does not carry process.exitCode
      // through, so every headless failure reported success to whatever spawned
      // it. verify-decode checks `shoot.status !== 0`, so a shoot that threw
      // was invisible to it.
      app.exit(1);
    }
    return;
  }

  if (process.env.ZOOMCAST_UI_SHOT !== undefined) {
    try {
      await runUiShot();
    } catch (err) {
      console.error("ui shot failed:", err);
      // app.exit, not quit: a graceful quit does not carry process.exitCode
      // through, so every headless failure reported success to whatever spawned
      // it. verify-decode checks `shoot.status !== 0`, so a shoot that threw
      // was invisible to it.
      app.exit(1);
    }
    return;
  }

  if (process.env.ZOOMCAST_SHOOT !== undefined) {
    try {
      await runShoot();
    } catch (err) {
      console.error("shoot failed:", err);
      // app.exit, not quit: a graceful quit does not carry process.exitCode
      // through, so every headless failure reported success to whatever spawned
      // it. verify-decode checks `shoot.status !== 0`, so a shoot that threw
      // was invisible to it.
      app.exit(1);
    }
    return;
  }

  if (process.env.ZOOMCAST_RECORD_TEST !== undefined) {
    try {
      await runRecordTest();
    } catch (err) {
      console.error("record test failed:", err);
      // app.exit, not quit: a graceful quit does not carry process.exitCode
      // through, so every headless failure reported success to whatever spawned
      // it. verify-decode checks `shoot.status !== 0`, so a shoot that threw
      // was invisible to it.
      app.exit(1);
    }
    return;
  }

  // Launched at login there is no window, only the tray: opening the editor
  // on every boot would be the opposite of a background recorder.
  if (!startedHidden()) createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  teardownRecordingControls();
});

app.on("before-quit", (event) => {
  // Finish the take rather than leaving a bundle with no manifest.
  event.preventDefault();
  void abortRecording().finally(() => {
    // Carry the exit code rather than hardcoding 0. This handler runs on EVERY
    // quit path, so a hardcoded zero silently overrode process.exitCode
    // everywhere — including runRecordTest's own failure path, which wrote
    // {ok: false} and then exited 0, so anything shelling out to
    // ZOOMCAST_RECORD_TEST and checking the status saw success on failure.
    app.exit(process.exitCode === undefined ? 0 : Number(process.exitCode));
  });
});

app.on("window-all-closed", () => {
  // Deliberately does NOT quit. This is a tray app with a global hotkey: it has
  // to keep running with no windows open, and closing the editor mid-take must
  // not kill the recording. Quitting is explicit, from the tray menu.
  //
  // Without this, destroying the countdown overlay — briefly the only window —
  // ends the app before recording even starts.
});
