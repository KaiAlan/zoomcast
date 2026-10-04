export const UPDATE_REPOSITORY = { owner: "KaiAlan", repo: "zoomcast" } as const;

export type UpdateState = {
  status: "disabled" | "needs-access" | "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "installing" | "error";
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
  access: () => Promise<{ configured: boolean; canStore: boolean }>;
  setAccess: (token: string | null) => Promise<void>;
  onChanged: (callback: (state: UpdateState) => void) => () => void;
  onBeforeInstall: (save: () => Promise<void>) => () => void;
};
