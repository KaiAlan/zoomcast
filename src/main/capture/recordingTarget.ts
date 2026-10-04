import { desktopCapturer, screen } from "electron";
import koffi from "koffi";
import type { RecorderSource } from "../../shared/recorder";

export type CaptureRegion = { x: number; y: number; width: number; height: number };
let user32: ReturnType<typeof koffi.load> | null = null;
let getRect: ((hwnd: number, rect: CaptureRect) => boolean) | null = null;
let toScreen: ((hwnd: number, point: { x: number; y: number }) => boolean) | null = null;
type CaptureRect = { left: number; top: number; right: number; bottom: number };
export function windowRegion(hwnd: number): CaptureRegion {
  if (getRect === null || toScreen === null) {
    user32 = koffi.load("user32.dll");
    const rect = koffi.struct("ZOOMCAST_CAPTURE_RECT", { left: "int32", top: "int32", right: "int32", bottom: "int32" });
    const point = koffi.struct("ZOOMCAST_CAPTURE_POINT", { x: "int32", y: "int32" });
    getRect = user32.func("__stdcall", "GetClientRect", "bool", ["uintptr_t", koffi.out(koffi.pointer(rect))]);
    toScreen = user32.func("__stdcall", "ClientToScreen", "bool", ["uintptr_t", koffi.inout(koffi.pointer(point))]);
  }
  const rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const point = { x: 0, y: 0 };
  if (!getRect(hwnd, rect) || !toScreen(hwnd, point) || rect.right < 2 || rect.bottom < 2) throw new Error("The selected window is unavailable. Restore it and select it again.");
  return { ...point, width: rect.right, height: rect.bottom };
}
export async function recorderSources(): Promise<RecorderSource[]> {
  const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 240, height: 135 } });
  return sources.filter(s => !s.name.toLowerCase().includes("zoomcast")).map(s => ({ id: s.id, name: s.name, kind: s.id.startsWith("screen:") ? "screen" : "window", thumbnail: s.thumbnail.isEmpty() ? undefined : s.thumbnail.toDataURL(), isPrimary: s.display_id === String(screen.getPrimaryDisplay().id) }));
}
export async function resolveRecordingTarget(sourceId: string): Promise<{ primary: boolean; hwnd?: number; region: CaptureRegion; display: Electron.Display }> {
  if (sourceId === "") {
    const display = screen.getPrimaryDisplay();
    return { primary: true, display, region: screen.dipToScreenRect(null, display.bounds) };
  }
  const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
  const source = sources.find(s => s.id === sourceId);
  if (!source) throw new Error("The selected capture source has closed or disconnected. Select another source.");
  if (sourceId.startsWith("window:")) {
    const hwnd = Number(sourceId.split(":")[1]);
    if (!Number.isSafeInteger(hwnd) || hwnd <= 0) throw new Error("Invalid window capture source");
    const region = windowRegion(hwnd);
    return { primary: false, hwnd, region, display: screen.getDisplayMatching(screen.screenToDipRect(null, region)) };
  }
  const display = screen.getAllDisplays().find(d => String(d.id) === source.display_id);
  if (!display) throw new Error("The selected display is no longer connected");
  return { primary: display.id === screen.getPrimaryDisplay().id, display, region: screen.dipToScreenRect(null, display.bounds) };
}
