import { BrowserWindow, screen } from "electron";

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

/** 3-2-1 before the take starts. Resolves when it finishes. */
export async function runCountdown(seconds = 3): Promise<void> {
  const display = screen.getPrimaryDisplay();
  const size = 220;

  const win = makeOverlay({
    x: Math.round(display.bounds.x + (display.bounds.width - size) / 2),
    y: Math.round(display.bounds.y + (display.bounds.height - size) / 2),
    width: size,
    height: size,
  });

  const render = (n: number): Promise<void> =>
    win.loadURL(
      html(
        `<div style="display:flex;align-items:center;justify-content:center;height:100%;
            font-size:120px;color:#fff;text-shadow:0 2px 24px rgba(0,0,0,.6)">${n}</div>`,
      ),
    );

  for (let n = seconds; n >= 1; n--) {
    await render(n);
    await new Promise<void>((resolve) => setTimeout(resolve, 700));
  }

  win.destroy();
}
