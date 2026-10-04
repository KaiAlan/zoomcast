import type { ThemePreference } from "../shared/settings/types";

/** Persisted theme applies to every window; System follows OS changes live. */
export function initializeTheme(): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let preference: ThemePreference = "light";
  const apply = (): void => {
    document.documentElement.dataset.theme = preference === "system" ? (media.matches ? "dark" : "light") : preference;
  };
  const set = (theme: ThemePreference): void => { preference = theme; apply(); };
  window.zoomcast.onSettingsChanged(settings => set(settings.theme));
  media.addEventListener("change", apply);
  void window.zoomcast.getSettings().then(settings => set(settings.theme));
  apply();
}
