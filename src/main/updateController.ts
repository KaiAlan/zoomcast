import type { AppUpdater } from "electron-updater";
import type { AppUpdaterEvents } from "electron-updater/out/AppUpdater";
import { releaseSummary, type UpdateState } from "../shared/updates";

export type UpdateDriver = Pick<AppUpdater,
  "autoDownload" | "autoInstallOnAppQuit" | "allowPrerelease" | "allowDowngrade" |
  "checkForUpdates" | "downloadUpdate" | "quitAndInstall"> & {
    on: <Event extends keyof AppUpdaterEvents>(event: Event, listener: AppUpdaterEvents[Event]) => unknown;
  };

/** Keep downloads opt-in and refuse a restart until work is saved and idle. */
export class UpdateController {
  private value: UpdateState;
  private operation: Promise<void> | null = null;
  private preparing = false;
  private installing = false;

  constructor(private readonly options: {
    driver: UpdateDriver;
    enabled: boolean;
    currentVersion: string;
    changed: (state: UpdateState) => void;
    busyReason: () => string | null;
    confirm: () => Promise<boolean>;
    save: () => Promise<void>;
    log: (error: unknown) => void;
  }) {
    this.value = { status: options.enabled ? "idle" : "disabled", currentVersion: options.currentVersion };
    const driver = options.driver;
    driver.autoDownload = false;
    driver.autoInstallOnAppQuit = false;
    driver.allowPrerelease = false;
    driver.allowDowngrade = false;
    driver.on("checking-for-update", () => this.set({ status: "checking", message: undefined }));
    driver.on("update-available", info => this.set({ status: "available", version: info.version, release: releaseSummary(info.version, info.releaseNotes), message: undefined }));
    driver.on("update-not-available", () => this.set({ status: "current", version: undefined, release: undefined, message: undefined }));
    driver.on("download-progress", progress => this.set({ status: "downloading", percent: Math.max(0, Math.min(100, progress.percent)) }));
    driver.on("update-downloaded", info => this.set({ status: "downloaded", version: info.version, release: info.releaseNotes ? releaseSummary(info.version, info.releaseNotes) : this.value.release, percent: 100, message: undefined }));
    driver.on("error", error => this.fail(error));
  }

  state(): UpdateState { return { ...this.value }; }
  isInstalling(): boolean { return this.installing; }
  isBusy(): boolean { return this.operation !== null || this.preparing || this.installing; }

  private set(patch: Partial<UpdateState>): void {
    this.value = { ...this.value, ...patch };
    this.options.changed(this.state());
  }

  private fail(error: unknown): void {
    this.options.log(error);
    this.set({ status: "error", message: "Could not update Zoomcast. Check your connection and try again." });
  }

  private run(action: () => Promise<unknown>): Promise<void> {
    const operation = Promise.resolve().then(action).then(() => undefined).catch(error => this.fail(error));
    this.operation = operation;
    void operation.finally(() => { if (this.operation === operation) this.operation = null; });
    return operation;
  }

  check(): Promise<void> {
    if (this.operation) return this.operation;
    if (!this.options.enabled || this.preparing || ["downloaded", "installing"].includes(this.value.status)) return Promise.resolve();
    this.set({ status: "checking", message: undefined, percent: undefined });
    return this.run(() => this.options.driver.checkForUpdates());
  }

  download(): Promise<void> {
    if (this.operation) return this.operation;
    if (this.value.status !== "available") return Promise.resolve();
    this.set({ status: "downloading", percent: 0, message: undefined });
    return this.run(() => this.options.driver.downloadUpdate());
  }

  async install(): Promise<void> {
    if (this.value.status !== "downloaded" || this.preparing || this.installing) return;
    const block = (): boolean => {
      const reason = this.options.busyReason();
      if (reason) this.set({ message: reason });
      return reason !== null;
    };
    if (block()) return;
    this.preparing = true;
    try {
      if (!await this.options.confirm() || block()) return;
      await this.options.save();
      if (block()) return;
      this.installing = true;
      this.set({ status: "installing", message: undefined });
      // Confirmation and project saves are complete; install in place without
      // a second setup wizard, then reopen the app.
      this.options.driver.quitAndInstall(true, true);
    } catch (error) {
      this.installing = false;
      this.options.log(error);
      this.set({ status: "downloaded", message: "Could not prepare the restart. Save your project and try again." });
    } finally { this.preparing = false; }
  }
}
