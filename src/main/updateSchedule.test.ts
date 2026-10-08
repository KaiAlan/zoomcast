import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleUpdates } from "./updateSchedule";

afterEach(() => vi.useRealTimers());
describe("automatic update checks", () => {
  it("checks once on startup and stays quiet while the app is running", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => undefined);
    const schedule = scheduleUpdates(check);
    await vi.advanceTimersByTimeAsync(4999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(check).toHaveBeenCalledOnce();
    schedule.stop();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(check).toHaveBeenCalledOnce();
  });
  it("cancels the initial check on shutdown", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => undefined);
    scheduleUpdates(check).stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(check).not.toHaveBeenCalled();
  });
});
