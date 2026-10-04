/** Build pinned Windows media tools and package their actual corresponding sources. */
const { createHash } = require('node:crypto');
const { createReadStream, createWriteStream, existsSync, readFileSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFileSync } = require('node:child_process');
const standalone = existsSync(path.join(__dirname, 'ffmpeg.lock.json'));
const root = standalone ? __dirname : path.resolve(__dirname, '..');
const build = standalone ? root : path.join(root, 'build');
const lock = require(path.join(build, 'ffmpeg.lock.json'));
const vendor = path.join(root, standalone ? 'binaries' : 'vendor/ffmpeg');
const fingerprint = createHash('sha256').update(readFileSync(path.join(build, 'ffmpeg.lock.json'))).update(readFileSync(path.join(build, 'ffmpeg-build.sh'))).digest('hex');
const work = standalone ? root : path.join(root, 'tmp', 'media-source', fingerprint.slice(0, 16));
const quote = value => `'${value.replaceAll("'", "''")}'`;
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function verified(file, digest) { return await sha256(file).catch(() => null) === digest; }
async function download(url, file, digest) {
  if (await verified(file, digest)) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const pending = `${file}.partial`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (!response.ok || !response.body) throw Error(`Source download failed: ${response.status} ${url}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(pending));
      if (!await verified(pending, digest)) throw Error(`Source checksum mismatch: ${path.basename(file)}`);
      await fs.rename(pending, file);
      return;
    } catch (error) {
      await fs.rm(pending, { force: true });
      if (attempt === 3) throw error;
      console.log(`Retrying source download: ${path.basename(file)}`);
    }
  }
}
function verify() {
  const binary = path.join(vendor, 'ffmpeg.exe');
  const run = args => execFileSync(binary, ['-hide_banner', ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  for (const filter of ['ddagrab', 'hwdownload', 'format', 'vflip', 'scale', 'amix', 'aresample']) {
    if (!new RegExp(`\\s${filter}\\s`).test(run(['-filters']))) throw Error(`bundled FFmpeg lacks ${filter}`);
  }
  if (!/gdigrab/.test(run(['-devices']))) throw Error('bundled FFmpeg lacks window capture');
  for (const encoder of ['libx264', 'aac', 'h264_amf', 'h264_nvenc', 'png']) {
    if (!new RegExp(`\\s${encoder}\\s`).test(run(['-encoders']))) throw Error(`bundled FFmpeg lacks ${encoder}`);
  }
  execFileSync(binary, ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x32:r=30', '-frames:v', '1', '-c:v', 'libx264', '-f', 'null', '-'], { timeout: 30000 });
  execFileSync(path.join(vendor, 'ffprobe.exe'), ['-version'], { stdio: 'ignore', timeout: 30000 });
}
(async () => {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Run preparation natively on Windows x64');
  await fs.mkdir(work, { recursive: true });
  for (const source of [...lock.sources, lock.nasm]) await download(source.url, path.join(work, source.archive), source.sha256);
  // AMF's release contains large samples/assets. Only the complete header tree
  // and upstream notices are compiled; pin and ship every one of those files.
  const amfFiles = [...lock.amf.files];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (amfFiles.length) {
      const entry = amfFiles.pop();
      await download(`https://raw.githubusercontent.com/${lock.amf.repository}/${lock.amf.commit}/${entry.path}`, path.join(work, 'amf-headers', entry.path), entry.sha256);
    }
  }));
  const proofFile = path.join(work, 'build-proof.json');
  const proof = await fs.readFile(proofFile, 'utf8').then(JSON.parse).catch(() => null);
  const binaries = ['ffmpeg.exe', 'ffprobe.exe'];
  let cached = proof?.fingerprint === fingerprint;
  for (const name of binaries) cached = cached && await verified(path.join(work, 'prefix', name), proof?.binaries?.[name]);
  if (!cached) {
    const msys = process.env.MSYS2_LOCATION || 'C:\\msys64';
    const bash = path.join(msys, 'usr', 'bin', 'bash.exe');
    if (!existsSync(bash)) throw Error('Install MSYS2 MINGW64 (gcc, make, pkgconf), or set MSYS2_LOCATION. See build/FFMPEG-SOURCES.md.');
    await fs.rm(path.join(work, 'extracted'), { recursive: true, force: true });
    await fs.rm(path.join(work, 'prefix'), { recursive: true, force: true });
    console.log(`Building FFmpeg ${lock.version} and x264 from checksum-verified sources...`);
    // Bash reads a script file, so neither shell interpolation nor PowerShell
    // quoting is needed for paths or configuration arguments.
    execFileSync(bash, ['-l', path.join(build, 'ffmpeg-build.sh').replaceAll('\\', '/'), work], { stdio: 'inherit', timeout: 3600000, env: { ...process.env, MSYSTEM: 'MINGW64', MSYS2_PATH_TYPE: 'minimal' } });
    const hashes = {};
    for (const name of binaries) hashes[name] = await sha256(path.join(work, 'prefix', name));
    await fs.writeFile(proofFile, JSON.stringify({ fingerprint, binaries: hashes }, null, 2));
  }
  await fs.mkdir(vendor, { recursive: true });
  for (const name of binaries) {
    const source = path.join(work, 'prefix', name);
    if (!await verified(path.join(vendor, name), await sha256(source))) await fs.copyFile(source, path.join(vendor, name));
  }
  await fs.copyFile(path.join(work, 'extracted', 'ffmpeg', 'COPYING.GPLv2'), path.join(vendor, 'LICENSE'));
  const toolchainNotices = path.join(work, 'toolchain-licenses');
  if (!existsSync(toolchainNotices)) {
    const licenses = path.join(process.env.MSYS2_LOCATION || 'C:\\msys64', 'mingw64', 'share', 'licenses');
    if (existsSync(licenses)) {
      for (const entry of await fs.readdir(licenses, { withFileTypes: true })) {
        if (/^(crt|gcc-libs|libwinpthread|winpthreads)$/.test(entry.name)) {
          await fs.cp(path.join(licenses, entry.name), path.join(toolchainNotices, entry.name), { recursive: true });
        }
      }
    }
  }
  if (!existsSync(toolchainNotices) || (await fs.readdir(toolchainNotices)).length === 0) throw Error('MinGW and GCC runtime license notices are missing');
  const notices = [];
  for (const [label, file] of [
    ['x264 authors', path.join(work, 'extracted', 'x264', 'AUTHORS')],
    ['x264 GPL license', path.join(work, 'extracted', 'x264', 'COPYING')],
    ['zlib license', path.join(work, 'extracted', 'zlib', 'LICENSE')],
    ['AMD AMF headers license', path.join(work, 'amf-headers', 'LICENSE.txt')],
  ]) notices.push(`${label}\n${await fs.readFile(file, 'utf8')}`);
  const nvidia = await fs.readFile(path.join(work, 'extracted', 'nv-codec-headers', 'include', 'ffnvcodec', 'nvEncodeAPI.h'), 'utf8');
  notices.push(`NVIDIA codec headers license\n${nvidia.slice(0, nvidia.indexOf('*/') + 2)}`);
  const addNotices = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await addNotices(file);
      else notices.push(`${path.relative(toolchainNotices, file)}\n${await fs.readFile(file, 'utf8')}`);
    }
  };
  await addNotices(toolchainNotices);
  await fs.writeFile(path.join(vendor, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'));
  const appVersion = standalone ? null : require(path.join(root, 'package.json')).version;
  const sourceAsset = `zoomcast-ffmpeg-source-${appVersion}.zip`;
  const binaryHashes = {};
  for (const name of binaries) binaryHashes[name] = await sha256(path.join(vendor, name));
  const provenance = { ...lock, fingerprint, binaries: binaryHashes, sourceAsset: appVersion ? sourceAsset : null };
  await fs.writeFile(path.join(vendor, 'provenance.json'), JSON.stringify(provenance, null, 2));
  await fs.writeFile(path.join(vendor, 'README.txt'), `FFmpeg ${lock.version}, built for Zoomcast from pinned unmodified sources.\nLicense: ${lock.license}. See LICENSE and upstream source notices.\nCorresponding source and build information: ${appVersion ? sourceAsset : 'this source package'}.\nFor installers, obtain the matching source ZIP from the same private Zoomcast release; every installer recipient must receive source access.\nhttps://github.com/KaiAlan/zoomcast/releases\n`);
  verify();
  if (standalone) { console.log(`Verified rebuilt media binaries: ${vendor}`); return; }
  const sources = path.join(work, 'source-package');
  await fs.rm(sources, { recursive: true, force: true });
  await fs.mkdir(sources, { recursive: true });
  for (const source of [...lock.sources, lock.nasm]) await fs.copyFile(path.join(work, source.archive), path.join(sources, source.archive));
  await fs.cp(toolchainNotices, path.join(sources, 'toolchain-licenses'), { recursive: true });
  await fs.copyFile(path.join(vendor, 'THIRD-PARTY-NOTICES.txt'), path.join(sources, 'THIRD-PARTY-NOTICES.txt'));
  await fs.cp(path.join(work, 'amf-headers'), path.join(sources, 'amf-headers'), { recursive: true });
  for (const name of ['ffmpeg.lock.json', 'ffmpeg-build.sh', 'FFMPEG-SOURCES.md']) await fs.copyFile(path.join(build, name), path.join(sources, name));
  await fs.copyFile(__filename, path.join(sources, 'prepare-ffmpeg.cjs'));
  await fs.copyFile(path.join(work, 'toolchain.txt'), path.join(sources, 'toolchain.txt'));
  await fs.copyFile(path.join(work, 'extracted', 'ffmpeg', 'ffbuild', 'config.mak'), path.join(sources, 'ffmpeg-config.mak'));
  await fs.copyFile(path.join(work, 'extracted', 'x264', 'config.mak'), path.join(sources, 'x264-config.mak'));
  await fs.copyFile(path.join(vendor, 'LICENSE'), path.join(sources, 'LICENSE'));
  await fs.copyFile(path.join(vendor, 'provenance.json'), path.join(sources, 'provenance.json'));
  await fs.writeFile(path.join(sources, 'ffmpeg-buildconf.txt'), execFileSync(path.join(vendor, 'ffmpeg.exe'), ['-buildconf'], { encoding: 'utf8' }));
  const release = path.join(root, 'release');
  await fs.mkdir(release, { recursive: true });
  const archive = path.join(release, sourceAsset);
  await fs.rm(archive, { force: true });
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path ${quote(path.join(sources, '*'))} -DestinationPath ${quote(archive)} -CompressionLevel Optimal`], { stdio: 'inherit', timeout: 180000 });
  await fs.writeFile(`${archive}.sha256`, `${await sha256(archive)}  ${sourceAsset}\n`);
  console.log(`Verified FFmpeg ${lock.version} and corresponding-source archive: ${sourceAsset}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
