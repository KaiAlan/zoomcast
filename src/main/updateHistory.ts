import { readFileSync, renameSync, writeFileSync } from "node:fs";

type History = { seenVersion?: string };

/** App-level history survives installer upgrades and is shared by every window. */
export class UpdateHistory {
  private value: History = {};
  constructor(private readonly file: string) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as History;
      this.value = {
        seenVersion: typeof data?.seenVersion === "string" ? data.seenVersion : undefined,
      };
    } catch { /* First launch or an unreadable history: the summary is still available. */ }
  }
  hasSeen(version: string): boolean { return this.value.seenVersion === version; }
  private save(patch: Partial<History>): void {
    const next = { ...this.value, ...patch };
    writeFileSync(`${this.file}.new`, `${JSON.stringify(next)}\n`, "utf8");
    renameSync(`${this.file}.new`, this.file);
    this.value = next;
  }
  markSeen(version: string): void { this.save({ seenVersion: version }); }
}
