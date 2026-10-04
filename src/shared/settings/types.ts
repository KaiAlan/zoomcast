/**
 * Capture rates offered to the user.
 *
 * Two, not a free number. gdigrab is CPU-bound GDI readback and does not
 * honour an arbitrary request: on the development machine it tops out around
 * 28fps at 1080p whatever it is asked for. A free field would invite values
 * that quietly make recordings worse without ever making them better.
 */
export const CAPTURE_FPS_CHOICES = [30, 60] as const;

export type CaptureFps = (typeof CAPTURE_FPS_CHOICES)[number];

/**
 * App-level settings, deliberately separate from Project.
 *
 * A Project describes one recording and lives inside its bundle. These apply
 * before any project exists, and must outlive every bundle.
 */
export type ThemePreference = "light" | "dark" | "system";

export type Settings = {
  theme: ThemePreference;
  captureFps: CaptureFps;
  webcamEnabled: boolean;
  webcamDeviceId: string;
};
