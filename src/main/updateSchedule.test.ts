import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleUpdates } from "./updateSchedule";

afterEach(() => vi.useRealTimers());
describe("automatic update checks", () => {
  it("checks on startup and hourly without user interaction", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => undefined);
    const schedule = scheduleUpdates(check);
    await vi.advanceTimersByTimeAsync(4999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 5000);
    expect(check).toHaveBeenCalledTimes(2);
    schedule.stop();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(check).toHaveBeenCalledTimes(2);
  });
  it("checks after sleep while ignoring repeated resume events", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => undefined);
    const schedule = scheduleUpdates(check);
    await vi.advanceTimersByTimeAsync(5000);
    schedule.resume();
    expect(check).toHaveBeenCalledOnce();
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    schedule.resume(); schedule.resume();
    expect(check).toHaveBeenCalledTimes(2);
    schedule.stop();
  });
  it("cancels the initial check on shutdown", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => undefined);
    scheduleUpdates(check).stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(check).not.toHaveBeenCalled();
  });
});
