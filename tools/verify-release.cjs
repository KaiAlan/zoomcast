/** Inspect local release assets and bundled dependencies, without installing. */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const yaml = require("js-yaml");
const { execFileSync } = require("node:child_process");
const asar = require("@electron/asar");
const root = path.resolve(__dirname, "..");
const release = path.join(root, "release");
const { version } = require("../package.json");
const checks = [];
const assert = (value, label) => { if (!value) throw Error(label); checks.push(label); };
async function hash(file, algorithm = "sha512", encoding = "base64") {
  const digest = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest(encoding);
}
(async () => {
  const notes = require('./release-notes.cjs').check();
  const metadata = yaml.load(fs.readFileSync(path.join(release, "latest.yml"), "utf8"));
  assert(metadata.version === version, "update metadata matches package version");
  assert(metadata.releaseNotes?.replaceAll('\r\n', '\n') === notes.markdown, "update metadata includes the reviewed detailed release notes");
  assert(Array.isArray(metadata.files) && metadata.files.length === 1, "update metadata lists one Windows installer");
  const entry = metadata.files[0];
  assert(entry.url === `zoomcast-Setup-${version}.exe`, "installer has the expected stable asset name");
  const installer = path.join(release, entry.url);
  assert(fs.statSync(installer).size === entry.size, "installer size matches update metadata");
  assert(await hash(installer) === entry.sha512, "installer SHA-512 matches update metadata");
  assert(fs.statSync(`${installer}.blockmap`).size > 0, "installer blockmap is present");
  const resources = path.join(release, "win-unpacked", "resources");
  const feed = yaml.load(fs.readFileSync(path.join(resources, "app-update.yml"), "utf8"));
  assert(feed.provider === "github" && feed.owner === "KaiAlan" && feed.repo === "zoomcast" && feed.private === false, "packaged update feed uses the public Zoomcast repository");
  assert(!feed.token && !feed.requestHeaders, "packaged feed contains no credential");
  const media = path.join(resources, "ffmpeg");
  for (const name of ["ffmpeg.exe", "ffprobe.exe", "LICENSE", "README.txt", "THIRD-PARTY-NOTICES.txt", "provenance.json"]) {
    assert(fs.statSync(path.join(media, name)).size > 0, `packaged media resources include ${name}`);
  }
  const provenance = JSON.parse(fs.readFileSync(path.join(media, "provenance.json"), "utf8"));
  const lock = require("../build/ffmpeg.lock.json");
  assert(provenance.version === lock.version && JSON.stringify(provenance.sources) === JSON.stringify(lock.sources) && JSON.stringify(provenance.amf) === JSON.stringify(lock.amf), "bundled provenance matches the pinned media sources");
  for (const name of ["ffmpeg.exe", "ffprobe.exe"]) {
    assert(await hash(path.join(media, name), "sha256", "hex") === provenance.binaries[name], `${name} matches its corresponding-source provenance`);
  }
  assert(provenance.sourceAsset === `zoomcast-ffmpeg-source-${version}.zip`, "source asset name matches this app release");
  const sourceZip = path.join(release, provenance.sourceAsset);
  const sourceDigest = fs.readFileSync(`${sourceZip}.sha256`, "utf8").split(/\s+/)[0];
  assert(await hash(sourceZip, "sha256", "hex") === sourceDigest, "corresponding-source archive passes SHA-256 integrity");
  const extracted = path.join(root, "tmp", "release-source-validation");
  fs.rmSync(extracted, { recursive: true, force: true });
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath ${quote(sourceZip)} -DestinationPath ${quote(extracted)} -Force`], { timeout: 120000 });
  for (const source of [...lock.sources, lock.nasm]) {
    assert(await hash(path.join(extracted, source.archive), "sha256", "hex") === source.sha256, `source package includes verified ${source.archive}`);
  }
  for (const entry of lock.amf.files) {
    if (await hash(path.join(extracted, "amf-headers", entry.path), "sha256", "hex") !== entry.sha256) throw Error(`AMF source differs: ${entry.path}`);
  }
  assert(true, "source package includes every pinned AMF header and upstream notice");
  for (const name of ["ffmpeg-build.sh", "ffmpeg.lock.json", "FFMPEG-SOURCES.md", "prepare-ffmpeg.cjs", "toolchain.txt", "ffmpeg-buildconf.txt", "ffmpeg-config.mak", "x264-config.mak", "LICENSE", "THIRD-PARTY-NOTICES.txt"]) {
    assert(fs.statSync(path.join(extracted, name)).size > 0, `source package includes ${name}`);
  }
  const sourceProvenance = JSON.parse(fs.readFileSync(path.join(extracted, "provenance.json"), "utf8"));
  assert(JSON.stringify(sourceProvenance) === JSON.stringify(provenance), "source package identifies the exact bundled binary hashes");
  assert(!asar.listPackage(path.join(resources, "app.asar")).some(name => name.includes("release-smoke.cjs")), "production installer excludes the isolated updater-test bootstrap");
  const archive = path.join(resources, "app.asar");
  const manifest = JSON.parse(asar.extractFile(archive, "package.json").toString());
  assert(manifest.version === version && manifest.dependencies["electron-updater"], "packaged app includes this version and the updater dependency");
  const entries = asar.listPackage(archive).map(entry => entry.replaceAll("\\", "/"));
  assert(!entries.some(entry => entry.includes("caption-guard.cjs")), "production installer excludes the caption-test bootstrap");
  assert(!entries.some(entry => /whisper-cli\.exe$|ggml-base-q5_1\.bin$|engine\.zip$/.test(entry)), "speech engine and model are excluded from the installer");
  const mainBundle = asar.extractFile(archive, path.join("out", "main", "index.js")).toString();
  assert(notes.highlights.every(line => mainBundle.includes(JSON.stringify(line).slice(1, -1))), "packaged app includes every reviewed release highlight");
  assert(entries.some(entry => entry.includes("node_modules/electron-updater/out/main.js")), "updater implementation is present in app archive");
  const unpacked = path.join(resources, "app.asar.unpacked", "node_modules");
  assert(fs.existsSync(path.join(unpacked, "uiohook-napi", "prebuilds", "win32-x64", "uiohook-napi.node")), "input-hook native binary is unpacked");
  assert(fs.existsSync(path.join(unpacked, "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node")), "cursor-reader native binary is unpacked");
  console.log(`${checks.length} release asset checks passed`);
  fs.writeFileSync(path.join(root, "tmp", "release-assets-validation.json"), JSON.stringify({ ok: true, version, checks }, null, 2));
})().catch(error => {
  console.error(error);
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  fs.writeFileSync(path.join(root, "tmp", "release-assets-validation.json"), JSON.stringify({ ok: false, version, error: String(error), checks }, null, 2));
  process.exitCode = 1;
});
