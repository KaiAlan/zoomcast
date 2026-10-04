/** Smoke-test the unpacked Windows build with isolated data and no PATH media tools. */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const profile = path.join(root, "tmp", "release-packaged-profile");
const executable = process.env.ZOOMCAST_VERIFY_EXECUTABLE || path.join(root, "release", "win-unpacked", "zoomcast.exe");
const checks = [];
const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
(async () => {
  if (process.platform !== "win32") throw Error("Run natively on Windows");
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });
  const env = { ...process.env, PATH: path.join(process.env.SystemRoot, "System32"), LOCALAPPDATA: path.join(profile, "local"), ZOOMCAST_RECORD_TEST: "2", ZOOMCAST_RECORD_TEST_RUNS: "2" };
  delete env.ZOOMCAST_FFMPEG; delete env.ZOOMCAST_FFPROBE; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [`--user-data-dir=${profile}`], { cwd: root, env, stdio: "ignore" });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error("Packaged capture timed out")); }, 90000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); if (code === 0) resolve(); else reject(Error(`Packaged app exited ${code}`)); });
  });
  const result = JSON.parse(fs.readFileSync(path.join(profile, "record-test.json"), "utf8"));
  assert(result.ok === true && result.runs.length === 2, "packaged app completes two captures without PATH FFmpeg");
  const ffprobe = path.join(path.dirname(executable), "resources", "ffmpeg", "ffprobe.exe");
  for (const run of result.runs) {
    assert(run.dir.startsWith(path.join(profile, "local")), `capture ${run.run} stays in the isolated recording directory`);
    const manifest = JSON.parse(fs.readFileSync(path.join(run.dir, "manifest.json"), "utf8"));
    assert(manifest.status === "clean" && run.durationMs > 1000, `capture ${run.run} finalizes cleanly`);
    assert(run.hasCursorShapes && run.cursorEvents > 0, `capture ${run.run} retains native cursor-shape telemetry`);
    const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-count_frames", "-show_streams", "-of", "json", path.join(run.dir, manifest.video.file)], { encoding: "utf8", env }));
    assert(Number(probe.streams.find(stream => stream.codec_type === "video").nb_read_frames) > 1, `capture ${run.run} contains decodable video frames`);
  }
  fs.writeFileSync(path.join(root, "tmp", "packaged-validation.json"), JSON.stringify({ ok: true, executable, checks, result }, null, 2));
  console.log(`${checks.length} packaged capture checks passed`);
})().catch(error => {
  console.error(error);
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  fs.writeFileSync(path.join(root, "tmp", "packaged-validation.json"), JSON.stringify({ ok: false, error: String(error), checks }, null, 2));
  process.exitCode = 1;
});
