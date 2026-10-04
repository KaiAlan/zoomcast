import { z } from "zod";

const AudioTrack = z.object({
  role: z.enum(["mic", "system"]),
  file: z.string(),
  codec: z.string(),
  startOffsetMs: z.number(),
  device: z.string().optional(),
});

export const ManifestSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  createdAt: z.string(),
  clockBaseUnixMs: z.number(),
  status: z.enum(["clean", "unclean"]),
  durationMs: z.number().nonnegative(),
  display: z.object({
    adapter: z.string(),
    outputIdx: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    refreshHz: z.number().positive(),
    scale: z.number().positive(),
  }),
  video: z.object({
    file: z.string(),
    codec: z.string(),
    encoder: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    gop: z.number().int().positive(),
    drawMouse: z.boolean(),
    startOffsetMs: z.number(),
  }),
  audio: z.array(AudioTrack).default([]),
  webcam: z
    .object({
      file: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: z.number().positive(),
      startOffsetMs: z.number(),
    })
    .optional(),
  telemetry: z
    .object({
      file: z.string(),
      hasCursorShapes: z.boolean(),
    })
    .optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export function parseManifest(json: unknown): Manifest {
  return ManifestSchema.parse(json);
}
