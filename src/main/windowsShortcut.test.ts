import { describe, expect, it } from "vitest";
import { windowsShortcutHotkey } from "./windowsShortcut";
const link = (key: number, flags: number) => {
  const buffer = new Uint8Array(0x4c); new DataView(buffer.buffer).setUint32(0, 0x4c, true);
  buffer[0x40] = key; buffer[0x41] = flags; return buffer;
};
describe("Windows shell shortcut keys", () => {
  it.each([[0x52, 6, "Ctrl+Alt+R"], [0x5a, 6, "Ctrl+Alt+Z"], [0x7b, 6, "Ctrl+Alt+F12"], [0x87, 7, "Ctrl+Alt+Shift+F24"], [0x31, 3, "Ctrl+Shift+1"]])("reads key %s and flags %s", (key, flags, expected) => {
    expect(windowsShortcutHotkey(link(Number(key), Number(flags)))).toBe(expected);
  });
  it("rejects truncated or invalid headers", () => {
    expect(windowsShortcutHotkey(new Uint8Array(60))).toBeNull();
    expect(windowsShortcutHotkey(new Uint8Array(76))).toBeNull();
  });
  it.each([[0, 0], [0x52, 8], [0x52, 0], [0xff, 6]])("does not invent a label for unset or unknown hotkeys (%s, %s)", (key, flags) => {
    expect(windowsShortcutHotkey(link(key, flags))).toBeNull();
  });
});
