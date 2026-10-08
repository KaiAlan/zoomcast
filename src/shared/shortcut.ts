export type ShortcutState = {
  hotkey: string;
  mode: "launcher" | "global" | "conflict";
  startWithWindows: boolean;
  startupSupported: boolean;
};
