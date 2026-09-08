import { DataStream, MP4BoxBuffer, createFile, type Sample } from "mp4box";
import { type FrameHandle, type FrameSource, videoFrameHandle } from "./FrameSource";

type IndexEntry = {
  /** Position in decode order — the order chunks must be fed to the decoder. */
  decodeIndex: number;
  /** Composition time in the track's own timescale. Integer, compared exactly. */
  ctsTicks: number;
  timestampUs: number;
  durationUs: number;
  isSync: boolean;
  data: Uint8Array;
};

type BoxWithWrite = { write(stream: DataStream): void };

/** Serialise the avcC/hvcC box, minus its 8-byte header, for VideoDecoder. */
function codecDescription(sample: Sample): Uint8Array {
  const entry = sample.description as {
    avcC?: BoxWithWrite;
    hvcC?: BoxWithWrite;
  };

  const box = entry.avcC ?? entry.hvcC;
  if (box === undefined) {
    throw new Error("unsupported codec: sample entry has no avcC or hvcC");
  }

  // DataStream defaults to big-endian, which is what box serialisation wants.
  const stream = new DataStream();
  box.write(stream);
  return new Uint8Array(stream.buffer, 8);
}

/**
 * Random-access frame decoding over an MP4.
 *
 * Every seek decodes forward from the nearest keyframe. With the GOP of 30
 * chosen in the spec that is at most 30 frames — roughly 10ms with hardware
 * decode — which is why a simple decode-from-keyframe strategy is fast enough
 * and a stateful incremental decoder is not worth its bugs.
 */
export class VideoSource implements FrameSource {
  private cachedIndex = -1;
  private cachedFrame: VideoFrame | null = null;
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    /** Decode order: how chunks must be fed. */
    private readonly index: IndexEntry[],
    /** Presentation order: how timestamps are looked up. */
    private readonly byPresentation: IndexEntry[],
    private readonly config: VideoDecoderConfig,
    private readonly timescale: number,
    readonly durationMs: number,
    readonly width: number,
    readonly height: number,
  ) {}

  static async open(url: string): Promise<VideoSource> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not fetch ${url}: ${response.status}`);
    const buffer = await response.arrayBuffer();

    const file = createFile();
    const samples: Sample[] = [];

    // Written inside the onReady callback, which mp4box invokes synchronously
    // during appendBuffer. Held in an object because TypeScript's flow analysis
    // does not follow assignments made inside callbacks.
    const found: { codec: string | null } = { codec: null };
    let durationMs = 0;
    let width = 0;
    let height = 0;

    file.onReady = (movie): void => {
      const video = movie.videoTracks[0];
      if (video === undefined) throw new Error("no video track");
      if (video.video === undefined) throw new Error("video track has no dimensions");

      found.codec = video.codec;
      durationMs = (movie.duration / movie.timescale) * 1000;
      width = video.video.width;
      height = video.video.height;

      file.setExtractionOptions(video.id, null, { nbSamples: video.nb_samples });
      file.start();
    };

    file.onSamples = (_id, _user, batch): void => {
      samples.push(...batch);
    };

    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buffer, 0), true);
    file.flush();

    const codec = found.codec;
    if (codec === null) throw new Error("mp4 never became ready");
    if (samples.length === 0) throw new Error("mp4 yielded no samples");

    const first = samples[0];
    if (first === undefined) throw new Error("mp4 yielded no samples");

    // B-frames give the first sample a non-zero composition time, which the
    // container compensates for with an edit list. mp4box reports raw cts, so
    // without this every presentation time is late by the B-frame delay —
    // 50ms, or 3 frames at 60fps, with libx264's defaults. Verified against
    // ffmpeg's own frame extraction.
    const ctsOrigin = samples.reduce((min, s) => Math.min(min, s.cts), Infinity);

    const timescale = first.timescale;

    const index: IndexEntry[] = samples.map((s, decodeIndex) => {
      const cts = s.cts - ctsOrigin;
      return {
        decodeIndex,
        ctsTicks: cts,
        timestampUs: Math.round((cts / s.timescale) * 1e6),
        durationUs: Math.round((s.duration / s.timescale) * 1e6),
        isSync: s.is_sync,
        data: s.data ?? new Uint8Array(0),
      };
    });

    const config: VideoDecoderConfig = {
      codec,
      codedWidth: width,
      codedHeight: height,
      description: codecDescription(first),
      optimizeForLatency: true,
    };

    const support = await VideoDecoder.isConfigSupported(config);
    if (support.supported !== true) {
      throw new Error(`decoder config unsupported: ${codec}`);
    }

    const keyframes = index.filter((e) => e.isSync).length;
    if (keyframes === 0) {
      throw new Error(
        "mp4 index reports no sync samples — every seek would decode from the " +
          "start of the file",
      );
    }
    console.log(
      `VideoSource: ${index.length} samples, ${keyframes} keyframes, codec ${codec}`,
    );

    // mp4box yields samples in DECODE order, which with B-frames is not
    // composition order. Searching for a timestamp needs a presentation-sorted
    // view; feeding the decoder needs the decode-ordered one. Keeping only the
    // first makes a binary search land on the right frame only by luck.
    const byPresentation = [...index].sort((a, b) => a.ctsTicks - b.ctsTicks);

    return new VideoSource(
      index,
      byPresentation,
      config,
      timescale,
      durationMs,
      width,
      height,
    );
  }

  /**
   * The sample *displayed* at `tMs` — the last one whose composition time is at
   * or before it. Note this floors: at a time inside a frame's interval you get
   * that frame, not the next one.
   *
   * Searches the presentation-ordered view, because the decode-ordered one is
   * not monotonic in composition time once B-frames are involved.
   *
   * Comparison is in integer ticks, not float milliseconds: converting ticks to
   * ms makes an exact frame boundary land on 1200.0000000000002, and the search
   * then returns the previous frame.
   */
  private sampleAt(tMs: number): IndexEntry | undefined {
    const targetTicks = Math.round((tMs * this.timescale) / 1000);

    let lo = 0;
    let hi = this.byPresentation.length - 1;
    let best = 0;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const entry = this.byPresentation[mid];
      if (entry === undefined) break;

      if (entry.ctsTicks <= targetTicks) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return this.byPresentation[best];
  }

  private syncIndexAt(idx: number): number {
    for (let i = idx; i >= 0; i--) {
      if (this.index[i]?.isSync === true) return i;
    }
    return 0;
  }

  /**
   * The frame shown at `tMs`. The returned VideoFrame belongs to the caller
   * and MUST be closed — a leaked frame stalls the decoder within seconds.
   */
  async frameAt(tMs: number): Promise<FrameHandle> {
    // The clone happens INSIDE the serialised section: decodeTo returns the
    // cached frame itself, and the next queued decode closes it when it
    // replaces the cache. Cloning outside would work only by relying on the
    // order two microtasks happen to run in.
    return videoFrameHandle(
      await this.serialise(async () => (await this.decodeTo(tMs)).clone()),
    );
  }

  /**
   * Warm the cache for a time about to be asked for.
   *
   * Every seek decodes forward from the nearest keyframe, so the first output
   * frame that lands on a NEW source frame pays for a whole GOP while the
   * player's own tick is dropped mid-decode. Doing that decode one frame early,
   * in the gap after a draw, means the next draw is a cache hit instead.
   *
   * Still exactly one VideoFrame alive: this replaces the cached frame rather
   * than queueing another. Holding a GOP's worth exhausts Chromium's frame pool
   * and flush() then hangs forever with no error.
   */
  async prefetch(tMs: number): Promise<void> {
    const target = this.sampleAt(tMs);
    if (target === undefined) return;
    if (target.decodeIndex === this.cachedIndex) return;

    try {
      await this.serialise(() => this.decodeTo(tMs));
    } catch {
      // A prefetch is an optimisation: if it fails, the real draw will fail
      // the same way and report it properly.
    }
  }

  /**
   * One decode at a time.
   *
   * frameAt and prefetch both configure a decoder and write the cache, so
   * overlapping them would race on `cachedFrame` and double-decode the same
   * GOP. Chaining is enough — there is never a queue longer than one draw plus
   * one prefetch.
   */
  private serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Decode the frame displayed at `tMs` into the cache and return it. */
  private async decodeTo(tMs: number): Promise<VideoFrame> {
    const target = this.sampleAt(tMs);
    if (target === undefined) throw new Error(`no sample at ${tMs}ms`);

    const idx = target.decodeIndex;
    const cached = this.cachedFrame;
    if (idx === this.cachedIndex && cached !== null) return cached;

    const from = this.syncIndexAt(idx);

    // Keep at most one frame alive. Buffering every decoded frame until after
    // flush() exhausts Chromium's frame pool and the decoder stalls forever —
    // decoding a whole 30-frame GOP is enough to hit it.
    // Held on an object: TypeScript's flow analysis narrows a plain `let` to
    // `null` because it does not follow assignments made inside callbacks.
    const held: { frame: VideoFrame | null } = { frame: null };
    let failure: Error | null = null;

    const consider = (frame: VideoFrame): void => {
      const current = held.frame;

      if (current === null) {
        held.frame = frame;
        return;
      }

      const wanted = frame.timestamp <= target.timestampUs;
      const better = frame.timestamp > current.timestamp;
      const currentOvershoots = current.timestamp > target.timestampUs;

      if ((wanted && better) || (currentOvershoots && frame.timestamp < current.timestamp)) {
        current.close();
        held.frame = frame;
        return;
      }

      frame.close();
    };

    const decoder = new VideoDecoder({
      output: consider,
      error: (err) => {
        failure = err instanceof Error ? err : new Error(String(err));
      },
    });

    decoder.configure(this.config);

    for (let i = from; i <= idx; i++) {
      const entry = this.index[i];
      if (entry === undefined) continue;

      decoder.decode(
        new EncodedVideoChunk({
          type: entry.isSync ? "key" : "delta",
          timestamp: entry.timestampUs,
          duration: entry.durationUs,
          data: entry.data,
        }),
      );
    }

    await decoder.flush();
    decoder.close();

    if (failure !== null) {
      held.frame?.close();
      throw failure;
    }

    const chosen = held.frame;
    if (chosen === null) throw new Error("decoder produced no frames");

    this.cachedFrame?.close();
    this.cachedFrame = chosen;
    this.cachedIndex = idx;

    return chosen;
  }

  close(): void {
    this.cachedFrame?.close();
    this.cachedFrame = null;
    this.cachedIndex = -1;
  }
}

/**
 * The decoder-backed source, named for what it is at the call sites that
 * require it. Export needs frame-exact random access; a <video> cannot give
 * that, so this is not interchangeable with VideoElementSource there.
 */
export { VideoSource as DecodedFrameSource };
