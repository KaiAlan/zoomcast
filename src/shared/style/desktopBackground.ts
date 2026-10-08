import { DEFAULT_IMAGE_PRESET, presetProjectFile } from "./imagePresets";

/** A recording-local snapshot, so changing Windows wallpaper cannot change a take. */
export const DESKTOP_BACKGROUND_FILE = "background-desktop.png";
export const DEFAULT_IMAGE_BACKGROUND_FILE = presetProjectFile(DEFAULT_IMAGE_PRESET);
