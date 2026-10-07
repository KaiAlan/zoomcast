/** MS-SHLLINK ShellLinkHeader: HotKey is at offset 0x40, low byte VK, high byte modifiers.
 * https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-shllink/4d25bbad-09b7-4322-8c0a-521d268481bb
 */
export function windowsShortcutHotkey(bytes: Uint8Array): string | null {
  if (bytes.length < 0x4c) return null;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0, true) !== 0x4c) return null;
  const key = bytes[0x40] ?? 0;
  const flags = bytes[0x41] ?? 0;
  if (!flags || flags > 7) return null;
  const label = key >= 0x30 && key <= 0x39 || key >= 0x41 && key <= 0x5a
    ? String.fromCharCode(key)
    : key >= 0x70 && key <= 0x87 ? `F${key - 0x6f}` : null;
  if (!label) return null;
  return [...(flags & 2 ? ["Ctrl"] : []), ...(flags & 4 ? ["Alt"] : []), ...(flags & 1 ? ["Shift"] : []), label].join("+");
}
