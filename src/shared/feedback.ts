import { z } from "zod";

export const feedbackSchema = z.object({
  kind: z.enum(["bug", "feature", "feedback"]),
  title: z.string().trim().min(1, "Add a summary").max(120),
  details: z.string().trim().min(1, "Add report details").max(4000),
}).strict();

export type FeedbackRequest = z.infer<typeof feedbackSchema>;
export type FeedbackEnvironment = { version: string; platform: string; release: string; arch: string };

/** The destination is fixed; callers supply report text, never a URL. */
export function feedbackLaunch(request: FeedbackRequest, environment: FeedbackEnvironment): { url: string; clipboardText: string | null } {
  const report = feedbackSchema.parse(request);
  const category = { bug: "Bug report", feature: "Feature request", feedback: "Feedback" }[report.kind];
  const body = `## ${category}\n\n${report.details}\n\n## App details\n\nZoomcast ${environment.version}\n${environment.platform} ${environment.release} (${environment.arch})\n`;
  const url = new URL("https://github.com/KaiAlan/zoomcast/issues/new");
  url.searchParams.set("title", `[${category}] ${report.title}`);
  url.searchParams.set("body", body);
  // Windows shell.openExternal accepts at most 2081 characters. Preserve the
  // whole report on the clipboard instead of truncating Unicode or long text.
  if (url.href.length <= 2081) return { url: url.href, clipboardText: null };
  url.searchParams.delete("body");
  return { url: url.href, clipboardText: body };
}
