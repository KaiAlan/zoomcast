export type ReleaseSummary = { version: string; highlights: string[]; url: string };

export function releaseUrl(version: string): string {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error("Invalid release version");
  return `https://github.com/KaiAlan/zoomcast/releases/tag/v${version}`;
}

/** Notes are untrusted feed text. Render only plain text, never provider HTML. */
export function releaseSummary(version: string, notes: unknown): ReleaseSummary {
  const markdown = typeof notes === "string" ? notes : Array.isArray(notes)
    ? notes.find(note => note?.version === version)?.note : undefined;
  const section = typeof markdown === "string"
    ? markdown.replaceAll("\r\n", "\n").match(/^## Highlights\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] : undefined;
  const highlights = (section ?? "").split("\n").filter(line => line.startsWith("- "))
    .map(line => line.slice(2).trim()).filter(line => line.length > 0 && line.length <= 240).slice(0, 5);
  return { version, highlights, url: releaseUrl(version) };
}

export type UpdateState = {
  status: "disabled" | "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "installing" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
  release?: ReleaseSummary;
  installedRelease?: ReleaseSummary;
  showWhatsNew?: boolean;
};

export type UpdateApi = {
  state: () => Promise<UpdateState>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  dismissWhatsNew: () => Promise<void>;
  openReleaseNotes: (version: string) => Promise<void>;
  onChanged: (callback: (state: UpdateState) => void) => () => void;
  onBeforeInstall: (save: () => Promise<void>) => () => void;
};
