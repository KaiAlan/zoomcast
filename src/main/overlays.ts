import { BrowserWindow, screen } from "electron";
import { COUNTDOWN_CUES, countdownCueHtml, countdownOverlayBounds } from "../shared/countdown";

/**
 * On-screen recording UI must not appear in the recording.
 *
 * `setContentProtection(true)` maps to Win32 `WDA_EXCLUDEFROMCAPTURE`, which
 * makes the window invisible to Desktop Duplication and to GDI capture while
 * staying visible to the person at the keyboard.
 */
function makeOverlay(bounds: Electron.Rectangle): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.setIgnoreMouseEvents(true);
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, "screen-saver");

  return win;
}

const html = (body: string): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><meta charset="utf-8"><style>
       html,body{margin:0;height:100%;overflow:hidden;background:transparent;
         font-family:system-ui,sans-serif;font-weight:400;color:#fff}
     </style>${body}`,
  )}`;

/** A thin red border around the captured display, for the duration of a take. */
export function showRecordingBorder(bounds = screen.getPrimaryDisplay().bounds): BrowserWindow {
  const win = makeOverlay(bounds);

  void win.loadURL(
    html(
      `<div style="position:fixed;inset:0;border:3px solid #e5484d;border-radius:2px"></div>`,
    ),
  );

  return win;
}

export type RecordingCue = {
  tick: (number: number) => Promise<void>;
  hide: () => void;
  started: () => Promise<void>;
  close: () => void;
};

/** One protected, unfocused renderer owns both the number and quiet audio cues. */
export async function createRecordingCue(bounds = screen.getPrimaryDisplay().bounds): Promise<RecordingCue> {
  const win = new BrowserWindow({
    ...countdownOverlayBounds(bounds), title: "zoomcast countdown", show: false,
    frame: false, transparent: true, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" },
  });
  win.setIgnoreMouseEvents(true);
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, "screen-saver");
  const close = (): void => { if (!win.isDestroyed()) win.destroy(); };
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(countdownCueHtml())}`);
  } catch (error) { close(); throw error; }
  return {
    tick: async number => {
      if (win.isDestroyed()) return;
      await win.webContents.executeJavaScript(`window.countdownCue.tick(${JSON.stringify(number)})`);
      if (!win.isDestroyed()) win.showInactive();
    },
    hide: () => { if (!win.isDestroyed()) win.hide(); },
    started: async () => {
      if (win.isDestroyed()) return;
      await win.webContents.executeJavaScript("window.countdownCue.started()");
      // Let the short, different start tone finish before closing its renderer.
      await new Promise<void>(resolve => setTimeout(resolve, COUNTDOWN_CUES.started.durationMs + 40));
    },
    close,
  };
}

/** The native capture verification path uses the same centered countdown. */
export async function runCountdown(seconds = 3): Promise<void> {
  if (seconds <= 0) return;
  const cue = await createRecordingCue();
  try {
    for (let n = seconds; n >= 1; n--) {
      await cue.tick(n);
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }
  } finally { cue.close(); }
}
