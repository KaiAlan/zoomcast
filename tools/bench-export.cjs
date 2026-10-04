/** Run natively on Windows after npm run build; keep competing workloads idle. */
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = process.cwd();
const profile = path.join(root, 'tmp', 'export-throughput-profile');
const dir = path.join(profile, 'bundle');
const report = path.join(root, 'tmp', 'export-throughput.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = { ok: false, renderer: null, encoder: null };
fs.rmSync(profile, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.cpSync(path.join(root, 'tests', 'fixtures', 'basic'), dir, { recursive: true });
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
execFileSync(ffmpeg, ['-y', '-v', 'error', '-stream_loop', '11', '-i', path.join(dir, 'screen.mp4'), '-t', '60', '-c', 'copy', path.join(dir, 'minute.mp4')], { stdio: 'ignore', timeout: 30000 });
fs.renameSync(path.join(dir, 'minute.mp4'), path.join(dir, 'screen.mp4'));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
manifest.durationMs = 60000;
manifest.audio = [];
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
app.setPath('userData', profile);
process.env.LOCALAPPDATA = path.join(profile, 'local');
process.env.ZOOMCAST_UI_SHOT = dir;
process.env.ZOOMCAST_UI_SHOT_DELAY = '600000';
const save = () => fs.writeFileSync(report, JSON.stringify(result, null, 2));
const timer = setTimeout(() => { result.error = 'timeout'; save(); app.exit(1); }, 600000);
let attached = false;
app.on('browser-window-created', (_, win) => {
  // Capture worker diagnostics without changing the export IPC contract.
  win.webContents.on('console-message', details => {
    const prefix = 'zoomcast:export-timings ';
    if (typeof details?.message === 'string' && details.message.startsWith(prefix)) {
      result.renderer = JSON.parse(details.message.slice(prefix.length));
    }
  });
  if (attached) return;
  attached = true;
  win.webContents.once('did-finish-load', async () => {
    const js = code => win.webContents.executeJavaScript(code);
    try {
      for (let i = 0; i < 100; i++) {
        if (await js('Boolean(window.__zc)')) break;
        await delay(100);
      }
      if (await js('window.zoomcast.isRecording()')) throw Error('Benchmark instance is recording');
      const out = path.join(profile, 'minute-export.mp4');
      const startedAt = Date.now();
      const id = await js(`(async () => {
        const b = await window.zoomcast.openBundle(${JSON.stringify(dir)});
        const project = { ...b.project, cuts: [], output: { ...b.project.output, width: 1920, height: 1080, aspect: 'native', fps: 60 } };
        return window.zoomcast.exports.start({ bundleDir: b.dir, project, outFile: ${JSON.stringify(out)} });
      })()`);
      let job;
      for (let i = 0; i < 5400; i++) {
        job = (await js('window.zoomcast.exports.list()')).find(item => item.id === id);
        if (job && ['done', 'failed', 'cancelled'].includes(job.phase)) break;
        await delay(100);
      }
      result.elapsedMs = Date.now() - startedAt;
      if (job?.phase !== 'done') throw Error(`Export ${job?.phase}: ${job?.error || ''}`);
      const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', out], { encoding: 'utf8', timeout: 60000 }));
      const video = probe.streams.find(stream => stream.codec_type === 'video');
      if (video?.width !== 1920 || video?.height !== 1080 || Number(video.nb_read_frames) !== 3600 || Math.abs(Number(probe.format.duration) - 60) > 0.05) throw Error('Export dimensions/frame count/duration mismatch');
      const log = fs.readFileSync(path.join(profile, 'main-error.log'), 'utf8');
      const timingLine = log.split('\n').find(line => line.includes('export:write-timings: '));
      if (timingLine) result.encoder = JSON.parse(timingLine.split('export:write-timings: ')[1]);
      result.encoderStart = log.split('\n').find(line => line.includes('export:start: '));
      if (result.renderer?.frames !== 3600 || result.encoder?.frames !== 3600) throw Error('Missing complete timing report');
      // Different processes use separate clocks: subtract durations, never timestamps.
      // Pipeline wait time excludes encoding that overlaps preparing the next
      // frame. Subtracting total encoder time from it would be meaningless.
      result.transferOverheadEstimateMs = result.renderer.pipelined ? null : result.renderer.transferAndWriteMs - result.encoder.writeMs;
      result.framesPerSecond = 3600 / (result.renderer.totalMs / 1000);
      result.probe = { width: video.width, height: video.height, frames: Number(video.nb_read_frames), duration: Number(probe.format.duration) };
      result.ok = true;
    } catch (error) { result.error = String(error); }
    save();
    clearTimeout(timer);
    app.exit(result.ok ? 0 : 1);
  });
});
import('../out/main/index.js').catch(error => { result.error = String(error); save(); clearTimeout(timer); app.exit(1); });
