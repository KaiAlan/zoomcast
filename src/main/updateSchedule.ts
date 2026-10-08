/** Background checks also recover after sleep, without duplicate focus checks. */
export function scheduleUpdates(check: () => Promise<void>, now = Date.now) {
  let lastCheck = 0;
  const run = (): void => { lastCheck = now(); void check(); };
  const initial = setTimeout(run, 5000);
  const periodic = setInterval(run, 60 * 60 * 1000);
  return {
    resume: (): void => { if (now() - lastCheck >= 15 * 60 * 1000) run(); },
    stop: (): void => { clearTimeout(initial); clearInterval(periodic); },
  };
}
