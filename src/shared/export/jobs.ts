import type { Project } from "../project/types";
export type ExportPhase = "preparing" | "rendering" | "finishing" | "done" | "cancelled" | "failed";
export type ExportRequest = { bundleDir: string; project: Project; outFile: string };
export type ExportJob = {
  id: string; phase: ExportPhase; done: number; total: number;
  startedAt: number; file: string; error?: string; preview?: string;
};
export type ExportJobUpdate = Pick<ExportJob, "phase" | "done" | "total"> & { error?: string; preview?: string };
export const exportFinished = (phase: ExportPhase): boolean => ["done", "cancelled", "failed"].includes(phase);
