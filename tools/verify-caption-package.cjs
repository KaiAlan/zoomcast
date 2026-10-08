/** Package a separate validation identity; production archives never contain the guard. */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const scratch = path.join(root, "tmp", "caption-package-validation");
const builder = path.join(root, "node_modules", "electron-builder", "cli.js");
async function run() {
  if (process.platform !== "win32") throw Error("Run natively on Windows");
  fs.mkdirSync(scratch, { recursive: true });
  const guard = path.join(scratch, "caption-guard.cjs");
  const source = fs.readFileSync(path.join(root, "tools", "verify-captions.cjs"), "utf8");
  fs.writeFileSync(guard, source.replace('import("../out/main/index.js");', 'import("./index.js");'));
  const config = path.join(scratch, "builder.json");
  fs.writeFileSync(config, JSON.stringify({
    extends: path.join(root, "electron-builder.yml"),
    appId: "dev.zoomcast.caption-validation", productName: "Zoomcast Caption Validation", executableName: "zoomcast-caption-validation",
    directories: { output: path.join(scratch, "package") },
    extraMetadata: { name: "zoomcast-caption-validation", main: "./out/main/caption-guard.cjs" },
    files: ["out/**/*", "package.json", { from: guard, to: "out/main/caption-guard.cjs" }],
  }, null, 2));
  const staged = path.join(root, "out", "main", "caption-guard.cjs");
  fs.copyFileSync(guard, staged);
  try { execFileSync(process.execPath, [builder, "--config", config, "--win", "--x64", "--dir", "--publish", "never"], { cwd: root, stdio: "inherit", timeout: 180000 }); } finally { fs.rmSync(staged, { force: true }); }
  execFileSync("powershell.exe", ["-NoProfile", "-File", path.join(root, "tools", "prepare-caption-test.ps1")], { cwd: root, stdio: "inherit" });
  const env = { ...process.env, PATH: path.join(process.env.SystemRoot, "System32") };
  delete env.ZOOMCAST_FFMPEG; delete env.ZOOMCAST_FFPROBE; delete env.ELECTRON_RUN_AS_NODE;
  const exe = path.join(scratch, "package", "win-unpacked", "zoomcast-caption-validation.exe");
  await new Promise((resolve, reject) => {
    const child = spawn(exe, [], { cwd: root, env, stdio: "inherit" });
    const timer = setTimeout(() => { child.kill(); reject(Error("Packaged captions timed out")); }, 900000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(`Packaged caption validation exited ${code}`)); });
  });
  const report = JSON.parse(fs.readFileSync(path.join(root, "tmp", "caption-validation", "report.json"), "utf8"));
  if (!report.ok) throw Error(report.error || "Packaged caption checks failed");
  fs.writeFileSync(path.join(scratch, "report.json"), JSON.stringify({ ...report, packaged: true, executable: exe }, null, 2));
  console.log(`${report.checks.length} packaged caption checks passed without PATH FFmpeg`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
