import { release } from "node:os";
import { app, clipboard, shell } from "electron";
import { feedbackLaunch, type FeedbackRequest } from "../shared/feedback";

export async function openFeedback(request: FeedbackRequest): Promise<{ copied: boolean }> {
  const launch = feedbackLaunch(request, {
    version: app.getVersion(), platform: process.platform, release: release(), arch: process.arch,
  });
  if (launch.clipboardText !== null) clipboard.writeText(launch.clipboardText);
  await shell.openExternal(launch.url);
  return { copied: launch.clipboardText !== null };
}
