/**
 * Capture rates offered to the user.
 *
 * Two, not a free number. gdigrab is CPU-bound GDI readback and does not
 * honour an arbitrary request — asking for 30 yielded 27.3fps on the
 * development machine and asking for 60 yielded 44 — so a free field would
 * invite values that quietly make recordings worse.
 */
export const CAPTURE_FPS_CHOICES = [30, 60] as const;

export type CaptureFps = (typeof CAPTURE_FPS_CHOICES)[number];

/**
 * App-level settings, deliberately separate from Project.
 *
 * A Project describes one recording and lives inside its bundle. These apply
 * before any project exists, and must outlive every bundle.
 */
export type Settings = {
  captureFps: CaptureFps;
};
