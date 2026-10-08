import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ImagePreset, presetProjectFile } from "../shared/style/imagePresets";

export function copyBackgroundPreset(dir: string, preset: ImagePreset): string {
  const file = presetProjectFile(preset);
  const assets = process.env.ELECTRON_RENDERER_URL ? "../../src/renderer/public/backgrounds" : "../renderer/backgrounds";
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), assets, preset.file), join(dir, file));
  return file;
}
