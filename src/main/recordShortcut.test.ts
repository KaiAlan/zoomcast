import { beforeEach, describe, expect, it, vi } from "vitest";
import { app, globalShortcut, shell } from "electron";
import { readFileSync } from "node:fs";

vi.mock("electron", () => ({ app: { isPackaged: false }, globalShortcut: { register: vi.fn() }, shell: { readShortcutLink: vi.fn() } }));
vi.mock("node:fs", () => ({ readFileSync: vi.fn() }));
vi.mock("./log", () => ({ logDiag: vi.fn() }));
import { recordShortcutInfo, registerRecordShortcut, RECORD_HOTKEY } from "./recordShortcut";

describe("record shortcut ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(app, "isPackaged", { value: false, configurable: true });
  });
  it("registers the same keys in development", () => {
    const open = vi.fn();
    vi.mocked(globalShortcut.register).mockReturnValue(true);
    registerRecordShortcut(open);
    expect(globalShortcut.register).toHaveBeenCalledExactlyOnceWith(RECORD_HOTKEY, open);
    expect(recordShortcutInfo()).toEqual({ hotkey: "Ctrl+Alt+R", mode: "global" });
    expect(readFileSync).not.toHaveBeenCalled();
  });
  it("reports conflicts without silently assigning different keys", () => {
    vi.mocked(globalShortcut.register).mockReturnValue(false);
    registerRecordShortcut(vi.fn());
    expect(globalShortcut.register).toHaveBeenCalledTimes(1);
    expect(recordShortcutInfo()).toEqual({ hotkey: "", mode: "conflict" });
  });
  function install(target = process.execPath, args = "--record") {
    Object.defineProperty(app, "isPackaged", { value: true, configurable: true });
    const bytes = Buffer.alloc(0x4c); bytes.writeUInt32LE(0x4c); bytes[0x40] = 0x52; bytes[0x41] = 6;
    vi.mocked(readFileSync).mockReturnValueOnce("\uFEFFC:\\Menu\\Zoomcast Recorder.lnk\r\nCtrl+Alt+R").mockReturnValue(bytes);
    vi.mocked(shell.readShortcutLink).mockReturnValue({ target, args } as Electron.ShortcutDetails);
    vi.mocked(globalShortcut.register).mockReturnValue(true);
  }
  it("leaves installed launch keys owned by Windows", () => {
    install(); registerRecordShortcut(vi.fn());
    expect(recordShortcutInfo()).toEqual({ hotkey: "Ctrl+Alt+R", mode: "launcher" });
    expect(globalShortcut.register).not.toHaveBeenCalled();
  });
  it("compares executable paths without case sensitivity on Windows", () => {
    install(process.execPath.toUpperCase()); registerRecordShortcut(vi.fn());
    expect(recordShortcutInfo().mode).toBe("launcher");
  });
  it.each([
    ["C:\\another-install\\zoomcast.exe", "--record"],
    [process.execPath, "--hidden"],
  ])("does not claim a launcher pointing elsewhere (%s, %s)", (target, args) => {
    install(target, args); registerRecordShortcut(vi.fn());
    expect(recordShortcutInfo().mode).toBe("global");
  });
  it("falls back visibly if the installed shortcut is deleted", () => {
    install(); vi.mocked(shell.readShortcutLink).mockImplementation(() => { throw new Error("Missing link"); });
    registerRecordShortcut(vi.fn()); expect(recordShortcutInfo().mode).toBe("global");
  });
  it("rejects malformed installer metadata", () => {
    install(); vi.mocked(readFileSync).mockReset().mockReturnValue("C:\\Menu\\Zoomcast Recorder.lnk\r\nCtrl+Alt+R+Z");
    registerRecordShortcut(vi.fn()); expect(recordShortcutInfo().mode).toBe("global");
    expect(shell.readShortcutLink).not.toHaveBeenCalled();
  });
  it("shows keys changed in the Windows shortcut properties", () => {
    install(); const bytes = Buffer.alloc(0x4c); bytes.writeUInt32LE(0x4c); bytes[0x40] = 0x5a; bytes[0x41] = 6;
    vi.mocked(readFileSync).mockReturnValueOnce(bytes);
    // The install helper queued the marker first; the next read is the link itself.
    registerRecordShortcut(vi.fn());
    expect(recordShortcutInfo()).toEqual({ hotkey: "Ctrl+Alt+Z", mode: "launcher" });
  });
});
