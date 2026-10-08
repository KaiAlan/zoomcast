/** One quiet check when the app opens; no periodic or wake-up polling. */
export function scheduleUpdates(check: () => Promise<void>) {
  const initial = setTimeout(() => void check(), 5000);
  return {
    stop: (): void => { clearTimeout(initial); },
  };
}
