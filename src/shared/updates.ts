export type UpdateState = {
  status: "disabled" | "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "installing" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
};

export type UpdateApi = {
  state: () => Promise<UpdateState>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  onChanged: (callback: (state: UpdateState) => void) => () => void;
  onBeforeInstall: (save: () => Promise<void>) => () => void;
};
