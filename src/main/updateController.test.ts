import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { UpdateController } from "./updateController";

class Driver extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  checkForUpdates = vi.fn(async () => null);
  downloadUpdate = vi.fn(async () => ["installer.exe"]);
  quitAndInstall = vi.fn();
}

function setup(enabled = true) {
  const driver = new Driver();
  const changed = vi.fn();
  const busyReason = vi.fn<() => string | null>(() => null);
  const confirm = vi.fn(async () => true);
  const save = vi.fn(async () => undefined);
  const log = vi.fn();
  const controller = new UpdateController({ driver, enabled, currentVersion: "0.1.0", changed, busyReason, confirm, save, log });
  return { driver, controller, changed, busyReason, confirm, save, log };
}

describe("installed app updates", () => {
  it("requires explicit download and install, and excludes prereleases/downgrades", () => {
    const { driver } = setup();
    expect(driver.autoDownload).toBe(false);
    expect(driver.autoInstallOnAppQuit).toBe(false);
    expect(driver.allowPrerelease).toBe(false);
    expect(driver.allowDowngrade).toBe(false);
  });

  it("never checks in development/headless mode", async () => {
    const { controller, driver } = setup(false);
    await controller.check();
    expect(controller.state().status).toBe("disabled");
    expect(driver.checkForUpdates).not.toHaveBeenCalled();
  });

  it("checks public releases without configuring update access", async () => {
    const { controller, driver } = setup();
    await controller.check();
    expect(controller.state().status).toBe("checking");
    expect(driver.checkForUpdates).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent checks and reports an available update without downloading", async () => {
    const { controller, driver } = setup();
    const first = controller.check();
    const second = controller.check();
    expect(first).toBe(second);
    await first;
    driver.emit("update-available", { version: "0.2.0" });
    expect(controller.state()).toMatchObject({ status: "available", version: "0.2.0" });
    expect(driver.checkForUpdates).toHaveBeenCalledOnce();
    expect(driver.downloadUpdate).not.toHaveBeenCalled();
  });

  it("leaves a downloaded update ready across repeated launch checks", async () => {
    const { controller, driver } = setup();
    driver.emit("update-downloaded", { version: "0.2.0" });
    await controller.check();
    expect(controller.state().status).toBe("downloaded");
    expect(driver.checkForUpdates).not.toHaveBeenCalled();
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
  });

  it("only downloads after availability and reports progress before completion", async () => {
    const { controller, driver } = setup();
    await controller.download();
    expect(driver.downloadUpdate).not.toHaveBeenCalled();
    driver.emit("update-available", { version: "0.2.0" });
    const first = controller.download();
    expect(controller.download()).toBe(first);
    driver.emit("download-progress", { percent: 37.5 });
    expect(controller.state()).toMatchObject({ status: "downloading", percent: 37.5 });
    await first;
    driver.emit("update-downloaded", { version: "0.2.0" });
    expect(controller.state()).toMatchObject({ status: "downloaded", percent: 100 });
  });

  it("retains the current installed version when no update is available", () => {
    const { controller, driver } = setup();
    driver.emit("update-not-available", { version: "0.1.0" });
    expect(controller.state()).toMatchObject({ status: "current", currentVersion: "0.1.0", version: undefined });
  });

  it("recovers from an offline check and keeps provider details out of the UI", async () => {
    const { controller, driver, log } = setup();
    driver.checkForUpdates.mockRejectedValueOnce(new Error("private provider detail"));
    await controller.check();
    expect(controller.state().status).toBe("error");
    expect(controller.state().message).not.toContain("private provider detail");
    expect(log).toHaveBeenCalledOnce();
    await controller.check();
    driver.emit("update-not-available", {});
    expect(controller.state().status).toBe("current");
  });

  it("handles emitted encoder-independent updater errors without an unhandled exception", () => {
    const { driver, controller } = setup();
    driver.emit("error", new Error("checksum mismatch"));
    expect(controller.state().status).toBe("error");
  });

  it.each(["Finish recording first", "Wait for exports first"])("blocks restart during active work: %s", async message => {
    const { driver, controller, busyReason, confirm, save } = setup();
    driver.emit("update-downloaded", { version: "0.2.0" });
    busyReason.mockReturnValue(message);
    await controller.install();
    expect(controller.state()).toMatchObject({ status: "downloaded", message });
    expect(confirm).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
  });

  it("honours Later and retains the downloaded update", async () => {
    const { driver, controller, confirm, save } = setup();
    driver.emit("update-downloaded", { version: "0.2.0" });
    confirm.mockResolvedValue(false);
    await controller.install();
    expect(save).not.toHaveBeenCalled();
    expect(controller.state().status).toBe("downloaded");
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
  });

  it("saves before installation, prevents duplicate restarts and lets the updater quit normally", async () => {
    const { driver, controller, save } = setup();
    driver.emit("update-downloaded", { version: "0.2.0" });
    save.mockImplementation(async () => { expect(driver.quitAndInstall).not.toHaveBeenCalled(); });
    await Promise.all([controller.install(), controller.install()]);
    expect(save).toHaveBeenCalledOnce();
    expect(controller.isInstalling()).toBe(true);
    expect(driver.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true);
  });

  it.each(["confirmation", "save"])("rechecks recording/export activity after %s", async stage => {
    const { driver, controller, busyReason, confirm, save } = setup();
    driver.emit("update-downloaded", { version: "0.2.0" });
    if (stage === "confirmation") confirm.mockImplementation(async () => { busyReason.mockReturnValue("Recording started"); return true; });
    else save.mockImplementation(async () => { busyReason.mockReturnValue("Export started"); });
    await controller.install();
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.state().status).toBe("downloaded");
  });

  it("refuses to close the app when saving fails", async () => {
    const { driver, controller, save } = setup();
    driver.emit("update-downloaded", { version: "0.2.0" });
    save.mockRejectedValue(new Error("disk full"));
    await controller.install();
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.isInstalling()).toBe(false);
    expect(controller.state().status).toBe("downloaded");
  });
});
