# Preview Frame-Source Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the editor preview from ~13fps to real-time by serving it from an `HTMLVideoElement` instead of a hand-rolled decoder, without weakening export determinism.

**Architecture:** Split `VideoSource` behind a `FrameSource` interface. The existing decoder becomes `DecodedFrameSource` and keeps serving export, which needs frame-exact random access. A new `VideoElementSource` wraps a `<video>` and serves the preview, which needs smooth forward playback. `PreviewPlayer` stops driving the playhead from `performance.now()` and takes it from `requestVideoFrameCallback`'s `mediaTime`. Range support on `zc://` lands first because Chromium seeks by issuing Range requests.

**Tech Stack:** Electron 44, TypeScript 7, WebGL2, WebCodecs, mp4box, vitest 5, ffmpeg (`ddagrab` + `h264_amf`).

**Spec:** `docs/specs/2026-09-08-preview-frame-source-split-design.md`

## Global Constraints

- **Windows-only.** Every command runs through `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; <cmd>"`. Never `npm run` under WSL — Electron, `uiohook-napi` and DXGI are Windows-only.
- **Test suite floor:** 326 passing across 36 files. It may go up, never down.
- **`npm run typecheck` must stay silent.**
- **`npm run verify:parity` must stay 25/25 at ≥28dB** across all five configurations.
- **`npm run verify:decode` must stay 6/6 with k=0 winning each time.**
- **vitest runs `environment: "node"` — there is no DOM.** Do not write a unit test that constructs a `<video>`, a canvas, or a WebGL context. Pure logic is unit-tested; DOM-bound code is verified by `bench:preview` and `verify:parity`.
- **`bench:preview` is compared batch against batch, never one run against one.** 9.6fps and 20.7fps have both been measured on identical code. Record median and spread.
- **No zoom dial moves without `npm run tune -- all` before and after,** with both outputs recorded in the commit message.
- Phases are independently mergeable. Stop and report after any phase whose gate fails.

---

## Phase 1 — Range support on `zc://`

Hard prerequisite for Phase 2. Measuring the preview against a `<video>` that is still downloading the whole file produces a meaningless number.

### Task 1: `resolveByteRange` pure function

**Files:**
- Create: `src/main/byteRange.ts`
- Test: `src/main/byteRange.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveByteRange(header: string | undefined, size: number): ByteRange | "unsatisfiable" | null` where `ByteRange = { start: number; end: number }`. `null` means "no range asked for, serve whole". `end` is inclusive, matching HTTP.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveByteRange } from "./byteRange";

describe("resolveByteRange", () => {
  it("returns null when no header is present", () => {
    expect(resolveByteRange(undefined, 1000)).toBeNull();
    expect(resolveByteRange("", 1000)).toBeNull();
  });

  it("resolves a closed range", () => {
    expect(resolveByteRange("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 });
  });

  it("resolves an open-ended range to the last byte", () => {
    expect(resolveByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("resolves a suffix range", () => {
    expect(resolveByteRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
  });

  it("clamps an end past the file to the last byte", () => {
    expect(resolveByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("clamps a suffix longer than the file to the whole file", () => {
    expect(resolveByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("reports a start past the end of the file as unsatisfiable", () => {
    expect(resolveByteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
  });

  it("reports an inverted range as unsatisfiable", () => {
    expect(resolveByteRange("bytes=500-100", 1000)).toBe("unsatisfiable");
  });

  it("ignores a multi-range request rather than serving it wrong", () => {
    expect(resolveByteRange("bytes=0-99,200-299", 1000)).toBeNull();
  });

  it("ignores a non-bytes unit", () => {
    expect(resolveByteRange("items=0-99", 1000)).toBeNull();
  });

  it("treats a zero-length file as unsatisfiable for any range", () => {
    expect(resolveByteRange("bytes=0-", 0)).toBe("unsatisfiable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/main/byteRange.test.ts"`
Expected: FAIL — cannot resolve `./byteRange`.

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Parse an HTTP Range header against a known file size.
 *
 * Exists because Chromium's media stack seeks by issuing Range requests: a
 * <video> pointed at a range-less URL must buffer the whole file before
 * seeking behaves. The zc:// handler ignored Range entirely, which was
 * invisible while VideoSource read whole files into an ArrayBuffer.
 *
 * `null`  -> no usable range was asked for; serve the whole file with 200.
 * "unsatisfiable" -> the client asked for bytes that do not exist; reply 416.
 */
export type ByteRange = { start: number; end: number };

export function resolveByteRange(
  header: string | undefined,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (header === undefined || header.trim() === "") return null;

  // Only single byte ranges. A multi-range reply needs multipart/byteranges,
  // which no media element asks for and which is easy to get subtly wrong.
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (match === null) return null;

  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (size <= 0) return "unsatisfiable";

  // Suffix form: bytes=-500 means "the last 500 bytes", not "up to 500".
  if (rawStart === "") {
    const suffix = Number.parseInt(rawEnd, 10);
    if (Number.isNaN(suffix) || suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  if (Number.isNaN(start) || start < 0 || start >= size) return "unsatisfiable";

  if (rawEnd === "") return { start, end: size - 1 };

  const end = Number.parseInt(rawEnd, 10);
  if (Number.isNaN(end) || end < start) return "unsatisfiable";

  return { start, end: Math.min(end, size - 1) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/main/byteRange.test.ts"`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/byteRange.ts src/main/byteRange.test.ts
git commit -m "feat: parse HTTP Range headers

Chromium seeks by issuing Range requests, so the <video>-backed preview
needs zc:// to honour them. Pure function first; the handler follows."
```

### Task 2: Serve ranges from the `zc://` handler

**Files:**
- Modify: `src/main/index.ts:85-108` (the `protocol.handle("zc", ...)` body)
- Test: none — this is I/O against Electron's protocol layer, which the node-env suite cannot host. Verified by Task 6's measurement and by the manual check below.

**Interfaces:**
- Consumes: `resolveByteRange` from Task 1.
- Produces: `zc://` responses carrying `Accept-Ranges: bytes`, and `206` with `Content-Range` when a range is requested.

- [ ] **Step 1: Replace the handler body**

Keep the existing path resolution and the CORS header exactly as they are. Only the response construction changes.

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolveByteRange } from "./byteRange";

// ...inside registerBundleProtocol(), replacing the try block:

    try {
      const headers = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": "bytes",
      });

      const info = await stat(filePath);
      const range = resolveByteRange(request.headers.get("range") ?? undefined, info.size);

      if (range === "unsatisfiable") {
        headers.set("Content-Range", `bytes */${info.size}`);
        return new Response(null, { status: 416, headers });
      }

      // No range asked for: the old path, plus Accept-Ranges so the media
      // element knows it may ask next time.
      if (range === null) {
        const res = await net.fetch(pathToFileURL(filePath).toString());
        for (const [k, v] of res.headers) headers.set(k, v);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Accept-Ranges", "bytes");
        return new Response(res.body, { status: res.status, headers });
      }

      const length = range.end - range.start + 1;
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
      headers.set("Content-Length", String(length));

      const stream = createReadStream(filePath, { start: range.start, end: range.end });
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
    } catch (err) {
      console.error(`zc:// failed for ${filePath}:`, err);
      return new Response(`not found: ${filePath}`, { status: 404 });
    }
```

- [ ] **Step 2: Typecheck and build**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm run build"`
Expected: silent typecheck, three bundles.

- [ ] **Step 3: Verify a 206 actually comes back**

Run the app (`npx electron .`), open an existing recording, and in the editor devtools console:

```js
const url = document.querySelector("video, canvas") && window.__zc?.bundleUrl;
// If __zc does not expose one, take any zc://app/@fs/... media URL from the network tab.
const r = await fetch(url, { headers: { Range: "bytes=0-99" } });
console.log(r.status, r.headers.get("content-range"), (await r.arrayBuffer()).byteLength);
```

Expected: `206 "bytes 0-99/<size>" 100`.

**If this prints 200 and the full byte length, stop.** Phase 2 cannot be measured honestly and the plan should be reported as blocked at this gate.

- [ ] **Step 4: Full suite**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run verify:parity"`
Expected: 326+ passing, parity 25/25.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: serve byte ranges over zc://

206 + Content-Range when a Range header is present, 416 when it cannot be
satisfied, Accept-Ranges always. Prerequisite for the <video>-backed
preview: without it a media element buffers the whole recording before
seeking behaves."
```

---

## Phase 2 — The `FrameSource` split

### Task 3: The interface, and `DecodedFrameSource`

**Files:**
- Create: `src/renderer/media/FrameSource.ts`
- Modify: `src/renderer/media/VideoSource.ts` (add `implements FrameSource`, wrap the `frameAt` return)
- Modify: `src/renderer/media/exportClip.ts:118-132`, `src/renderer/ui/Editor.tsx:191-204`, `src/renderer/shoot.ts:103`, `tools/verify-decode.ts` — all `frame.close()` call sites
- Test: `src/renderer/media/FrameSource.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export type FrameHandle = {
  readonly image: TexImageSource;
  release(): void;
};

export interface FrameSource {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  frameAt(tMs: number): Promise<FrameHandle>;
  prefetch(tMs: number): Promise<void>;
  close(): void;
}
```

**Why a handle rather than a bare frame:** `VideoSource.frameAt` returns a cloned `VideoFrame` the caller MUST close — a leaked frame stalls the decoder within seconds. A `<video>` element must NOT be closed. `release()` gives both one contract, so the two `drawFrame` call sites keep their existing `try/finally` shape with `frame.close()` becoming `handle.release()`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { videoFrameHandle } from "./FrameSource";

describe("videoFrameHandle", () => {
  it("exposes the frame as the image", () => {
    const close = vi.fn();
    const fake = { close } as unknown as VideoFrame;
    expect(videoFrameHandle(fake).image).toBe(fake);
  });

  it("closes the frame exactly once on release", () => {
    const close = vi.fn();
    const handle = videoFrameHandle({ close } as unknown as VideoFrame);
    handle.release();
    handle.release();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/renderer/media/FrameSource.test.ts"`
Expected: FAIL — cannot resolve `./FrameSource`.

- [ ] **Step 3: Write the interface module**

```ts
/**
 * One frame, and how to let go of it.
 *
 * VideoSource.frameAt returns a cloned VideoFrame the caller must close: a
 * leaked frame stalls the decoder within seconds. A <video> element must not
 * be closed at all. `release()` is the single contract both satisfy, so the
 * two drawFrame call sites keep one shape.
 */
export type FrameHandle = {
  readonly image: TexImageSource;
  release(): void;
};

export interface FrameSource {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  /** The frame shown at `tMs`. Release it when the draw is done. */
  frameAt(tMs: number): Promise<FrameHandle>;
  /** Warm whatever cache the implementation has. May be a no-op. */
  prefetch(tMs: number): Promise<void>;
  close(): void;
}

/** Wrap a decoded VideoFrame. Idempotent: double release must not double-close. */
export function videoFrameHandle(frame: VideoFrame): FrameHandle {
  let released = false;
  return {
    image: frame,
    release() {
      if (released) return;
      released = true;
      frame.close();
    },
  };
}

/** Wrap a <video>. Releasing is a no-op — the element outlives the draw. */
export function elementFrameHandle(el: HTMLVideoElement): FrameHandle {
  return { image: el, release() {} };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/renderer/media/FrameSource.test.ts"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Make `VideoSource` satisfy the interface**

In `src/renderer/media/VideoSource.ts`:

- add `import { type FrameHandle, type FrameSource, videoFrameHandle } from "./FrameSource";`
- change the class declaration to `export class VideoSource implements FrameSource {`
- change `frameAt` to return the handle:

```ts
  async frameAt(tMs: number): Promise<FrameHandle> {
    // The clone happens INSIDE the serialised section: decodeTo returns the
    // cached frame itself, and the next queued decode closes it when it
    // replaces the cache. Cloning outside would work only by relying on the
    // order two microtasks happen to run in.
    return videoFrameHandle(await this.serialise(async () => (await this.decodeTo(tMs)).clone()));
  }
```

Add an alias export so the intent reads at the call sites:

```ts
/** The decoder-backed source. Export uses this; it needs frame-exact seeks. */
export { VideoSource as DecodedFrameSource };
```

- [ ] **Step 6: Update the four call sites**

Each currently does `const frame = await source.frameAt(t)` then `screen: frame` then `frame.close()`. Change to:

- `src/renderer/ui/Editor.tsx:191` — `const frame = await source.frameAt(tSource);` → `screen: frame.image,` → `frame.release();`
- `src/renderer/media/exportClip.ts:118` — `const videoFrame = await source.frameAt(localMs);` → `screen: videoFrame.image,` → `videoFrame.release();`
- `src/renderer/shoot.ts:103` — `frame = await source.frameAt(spec.tMs ?? 0);` → wherever it is drawn, `.image`; wherever closed, `.release()`
- `tools/verify-decode.ts` — same substitution

Change `exportClip.ts:41` and `Editor.tsx:52` type annotations from `VideoSource` to `FrameSource` where they only consume the interface. Leave `VideoSource.open` as the constructor at both sites for now — Task 6 changes the preview's.

- [ ] **Step 7: Full gate**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm test; npm run build; npm run verify:decode; npm run verify:parity"`
Expected: silent, 328+ passing, three bundles, decode 6/6 k=0, parity 25/25 ≥28dB.

**This task must be a pure refactor — every number above is unchanged from before it.** If parity or decode moves, the wrapping is wrong; do not proceed to Task 4.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/media/FrameSource.ts src/renderer/media/FrameSource.test.ts src/renderer/media/VideoSource.ts src/renderer/media/exportClip.ts src/renderer/ui/Editor.tsx src/renderer/shoot.ts tools/verify-decode.ts
git commit -m "refactor: put VideoSource behind a FrameSource interface

Pure refactor, no behaviour change: decode 6/6, parity 25/25 unmoved.
The handle exists because a decoded VideoFrame must be closed and a
<video> element must not; release() is the one contract both satisfy."
```

### Task 4: `VideoElementSource`

**Files:**
- Create: `src/renderer/media/VideoElementSource.ts`
- Test: `src/renderer/media/videoElementSeek.test.ts` (pure helper only — no DOM)

**Interfaces:**
- Consumes: `FrameSource`, `elementFrameHandle` from Task 3.
- Produces: `VideoElementSource.open(url: string): Promise<VideoElementSource>` implementing `FrameSource`, plus `readonly el: HTMLVideoElement` and `readonly lastMediaTimeMs: number` for `PreviewPlayer` in Task 5. Also exports the pure helper `needsSeek(currentMs: number, wantMs: number, toleranceMs: number): boolean`.

- [ ] **Step 1: Write the failing test for the pure seek helper**

```ts
import { describe, expect, it } from "vitest";
import { needsSeek } from "./VideoElementSource";

describe("needsSeek", () => {
  it("does not seek when already within tolerance", () => {
    expect(needsSeek(1000, 1005, 20)).toBe(false);
    expect(needsSeek(1000, 995, 20)).toBe(false);
  });

  it("seeks when outside tolerance in either direction", () => {
    expect(needsSeek(1000, 1100, 20)).toBe(true);
    expect(needsSeek(1000, 900, 20)).toBe(true);
  });

  it("treats the tolerance boundary as no seek", () => {
    expect(needsSeek(1000, 1020, 20)).toBe(false);
  });
});
```

Tolerance exists so that during playback, where `currentTime` advances on its own, an incidental sub-frame difference does not trigger a seek and stall the pipeline. One frame at 60fps is 16.7ms, so 20ms is just over a frame.

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/renderer/media/videoElementSeek.test.ts"`
Expected: FAIL — cannot resolve `./VideoElementSource`.

- [ ] **Step 3: Implement**

```ts
import { type FrameHandle, type FrameSource, elementFrameHandle } from "./FrameSource";

/** One frame at 60fps is 16.7ms; 20ms is just over a frame. */
const SEEK_TOLERANCE_MS = 20;

/**
 * True when `wantMs` is far enough from `currentMs` to be worth a seek.
 *
 * During playback currentTime advances on its own. Seeking on every
 * sub-frame difference would stall the pipeline continuously, which is the
 * failure mode this whole change exists to avoid.
 */
export function needsSeek(currentMs: number, wantMs: number, toleranceMs = SEEK_TOLERANCE_MS): boolean {
  return Math.abs(wantMs - currentMs) > toleranceMs;
}

/**
 * A frame source backed by an HTMLVideoElement.
 *
 * Preview only. The browser owns demux, buffering and frame timing, which is
 * the entire point: the decoder-backed path built a fresh VideoDecoder per
 * frame and paid ~15 decoded frames per displayed frame against a GOP of 30.
 *
 * NOT suitable for export: seeks here are async and land on the nearest
 * decodable frame, so "give me exactly frame N" is not answerable.
 */
export class VideoElementSource implements FrameSource {
  private constructor(
    readonly el: HTMLVideoElement,
    readonly durationMs: number,
    readonly width: number,
    readonly height: number,
  ) {}

  /** Presentation time of the frame most recently handed to rVFC. */
  lastMediaTimeMs = 0;

  static async open(url: string): Promise<VideoElementSource> {
    const el = document.createElement("video");
    el.src = url;
    el.preload = "auto";
    el.muted = true;
    el.playsInline = true;
    // Never in the document: it is a texture source, not UI.
    el.style.display = "none";

    await new Promise<void>((resolve, reject) => {
      el.addEventListener("loadedmetadata", () => resolve(), { once: true });
      el.addEventListener("error", () => reject(new Error(`video load failed: ${url}`)), {
        once: true,
      });
    });

    // A <video> can report metadata before it can be painted. Waiting for
    // readyState >= HAVE_CURRENT_DATA means the first draw has real pixels
    // rather than a black frame.
    if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => {
        el.addEventListener("loadeddata", () => resolve(), { once: true });
      });
    }

    return new VideoElementSource(
      el,
      Number.isFinite(el.duration) ? el.duration * 1000 : 0,
      el.videoWidth,
      el.videoHeight,
    );
  }

  async frameAt(tMs: number): Promise<FrameHandle> {
    const currentMs = this.el.currentTime * 1000;

    if (needsSeek(currentMs, tMs)) {
      this.el.currentTime = tMs / 1000;
      await new Promise<void>((resolve) => {
        this.el.addEventListener("seeked", () => resolve(), { once: true });
      });
    }

    return elementFrameHandle(this.el);
  }

  /** The browser's own buffering replaces this. */
  async prefetch(): Promise<void> {}

  close(): void {
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/renderer/media/videoElementSeek.test.ts; npm run typecheck"`
Expected: PASS, 3 tests; typecheck silent.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/media/VideoElementSource.ts src/renderer/media/videoElementSeek.test.ts
git commit -m "feat: add a <video>-backed FrameSource

Preview only -- seeks land on the nearest decodable frame, so export
keeps the decoder. Not wired up yet."
```

### Task 5: Let `PreviewPlayer` take its clock from the video

**Files:**
- Modify: `src/renderer/media/PreviewPlayer.ts:80-100` (the `loop`), `:40-48` (`play`)
- Test: `src/renderer/media/previewClock.test.ts`

**Interfaces:**
- Consumes: nothing from Task 4 directly — the coupling is a callback, so `PreviewPlayer` stays testable in node.
- Produces: `PreviewPlayer` gains an optional constructor argument `clock?: PreviewClock` where:

```ts
export type PreviewClock = {
  /** Start advancing. */
  start(fromMs: number): void;
  stop(): void;
  /** Register for the next frame; cb receives that frame's presentation time. */
  onFrame(cb: (tMs: number) => void): void;
};
```

When `clock` is absent the wall-clock loop runs exactly as today, so export, `verify:decode` and `shoot.ts` are untouched.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { PreviewPlayer, type PreviewClock } from "./PreviewPlayer";

function fakeClock(): PreviewClock & { emit(tMs: number): void } {
  let cb: ((tMs: number) => void) | null = null;
  return {
    start: vi.fn(),
    stop: vi.fn(),
    onFrame(next) {
      cb = next;
    },
    emit(tMs) {
      cb?.(tMs);
    },
  };
}

describe("PreviewPlayer with a media clock", () => {
  it("takes the playhead from the frame's presentation time, not the wall clock", async () => {
    const clock = fakeClock();
    const ticks: number[] = [];
    const player = new PreviewPlayer(
      async () => {},
      () => 10_000,
      (t) => ticks.push(t),
      () => {},
      clock,
    );

    player.play();
    clock.emit(1234);
    await Promise.resolve();

    expect(player.playheadMs).toBe(1234);
    expect(ticks).toContain(1234);
  });

  it("starts and stops the clock with playback", () => {
    const clock = fakeClock();
    const player = new PreviewPlayer(async () => {}, () => 10_000, () => {}, () => {}, clock);

    player.play();
    expect(clock.start).toHaveBeenCalled();
    player.pause();
    expect(clock.stop).toHaveBeenCalled();
  });

  it("stops at the end of the take", async () => {
    const clock = fakeClock();
    const player = new PreviewPlayer(async () => {}, () => 5_000, () => {}, () => {}, clock);

    player.play();
    clock.emit(5_000);
    await Promise.resolve();

    expect(player.isPlaying).toBe(false);
  });

  it("still runs on the wall clock when no media clock is given", () => {
    const player = new PreviewPlayer(async () => {}, () => 5_000, () => {}, () => {});
    player.play();
    expect(player.isPlaying).toBe(true);
    player.pause();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/renderer/media/previewClock.test.ts"`
Expected: FAIL — `PreviewClock` is not exported.

- [ ] **Step 3: Implement**

Add the type and the fifth constructor parameter, and branch `play`/`pause`/`loop`:

```ts
/**
 * Where the playhead comes from during playback.
 *
 * The wall-clock loop advances the playhead by elapsed real time, so a slow
 * draw jumps it by ~60 frames -- past the next keyframe -- and no incremental
 * decode path can engage. A media clock reports the presentation time of the
 * frame actually about to be drawn, which removes that loop entirely.
 */
export type PreviewClock = {
  start(fromMs: number): void;
  stop(): void;
  onFrame(cb: (tMs: number) => void): void;
};
```

In the constructor, after `prefetch`:

```ts
    private readonly clock?: PreviewClock,
```

In `play()`, replace the tail:

```ts
  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.outputAtStart = this.playheadMs >= this.durationMs() ? 0 : this.playheadMs;

    if (this.clock !== undefined) {
      this.clock.onFrame(this.onMediaFrame);
      this.clock.start(this.outputAtStart);
      return;
    }

    this.wallAtStart = performance.now();
    this.loop();
  }
```

In `pause()`, before the existing body:

```ts
    this.clock?.stop();
```

Add the handler beside `loop`:

```ts
  private onMediaFrame = (tMs: number): void => {
    if (!this.playing) return;

    const end = this.durationMs();
    if (tMs >= end) {
      this.playheadMs = end;
      this.onTick(end, false);
      void this.draw(end);
      this.pause();
      return;
    }

    this.playheadMs = tMs;
    this.onTick(tMs, true);
    void this.draw(tMs);
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/renderer/media/previewClock.test.ts; npm test"`
Expected: PASS, 4 new tests; full suite 332+ passing with none failing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/media/PreviewPlayer.ts src/renderer/media/previewClock.test.ts
git commit -m "feat: let PreviewPlayer take its clock from a media source

Optional -- absent the clock the wall-clock loop is byte-for-byte the old
behaviour, so export and verify:decode are untouched. This is route (1)
from the 2026-09-07 camera-feel handoff."
```

### Task 6: Wire the preview to the video element, and measure

**Files:**
- Modify: `src/renderer/ui/Editor.tsx:52` (the ref type), `:191` (already handled in Task 3), `:247` (prefetch), `:258` (`VideoSource.open` → `VideoElementSource.open`), and the `PreviewPlayer` construction
- Test: none new — measured, not asserted

**Interfaces:**
- Consumes: `VideoElementSource` (Task 4), `PreviewClock` (Task 5).
- Produces: a preview that runs from a `<video>`.

- [ ] **Step 1: Record the baseline, batch not single**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run bench:preview -- <take-id> --runs 5"`

Write the median and spread into the task notes. **This is the number the change is judged against; without it the result is unfalsifiable.** Use the same take for the after-measurement.

- [ ] **Step 2: Build the clock adapter in `Editor.tsx`**

Beside the `VideoElementSource` construction:

```ts
    const source = await VideoElementSource.open(bundleAssetUrl(dir, bundle.media.screen)!);
    sourceRef.current = source;

    // rVFC hands back the presentation time of the frame about to be
    // composited, so the composition is aligned to the frame actually on
    // screen rather than to the time we asked for.
    const clock: PreviewClock = {
      start(fromMs) {
        source.el.currentTime = fromMs / 1000;
        void source.el.play();
      },
      stop() {
        source.el.pause();
      },
      onFrame(cb) {
        const tick = (_now: number, meta: VideoFrameCallbackMetadata): void => {
          source.lastMediaTimeMs = meta.mediaTime * 1000;
          cb(meta.mediaTime * 1000);
          source.el.requestVideoFrameCallback(tick);
        };
        source.el.requestVideoFrameCallback(tick);
      },
    };
```

Pass `clock` as the fifth argument where `PreviewPlayer` is constructed.

- [ ] **Step 3: Typecheck and build**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm run build"`
Expected: silent, three bundles.

If `requestVideoFrameCallback` or `VideoFrameCallbackMetadata` are missing from the TS lib, add the declarations to `src/renderer/global.d.ts` rather than casting to `any`.

- [ ] **Step 4: Measure**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run bench:preview -- <same-take-id> --runs 5"`

Compare median and spread against Step 1. **Target is real-time on a 60fps take.** Anything under roughly 2x the baseline means the video element is not actually driving the draws — check that Phase 1's 206 is being served, and that `bench:preview` still shows the window and disables background throttling (a hidden `BrowserWindow` throttles rAF to ~1Hz and will silently report nonsense).

- [ ] **Step 5: The parity gate**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run verify:decode; npm run verify:parity"`
Expected: suite green, decode 6/6, **parity 25/25 at ≥28dB**.

Parity is the real gate for this task: preview and export now decode by different mechanisms and this is what proves they still compose identically. **If PSNR drops on some configurations but not others, suspect colour space** — `VideoFrame` and a `<video>` texture upload can disagree on BT.709. The fix is an explicit colourspace uniform in the shader, not a threshold change. Do not lower `MIN_PSNR_DB`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ui/Editor.tsx src/renderer/global.d.ts
git commit -m "feat: drive the editor preview from a <video> element

bench:preview <before> -> <after> fps median over 5 runs on <take-id>.
parity 25/25, decode 6/6 unchanged.

The browser owns demux, buffering and frame timing. Composition is
aligned to rVFC's mediaTime, so it matches the frame actually drawn
rather than the time requested."
```

- [ ] **Step 7: Update the handover**

Edit `HANDOVER.md`: the "headline: the editor preview runs at ~13fps" paragraph is now wrong. Replace it with the measured number and note that camera work can be judged in the editor again. Commit separately as `docs:`.

---

## Phase 3 — `ZOOM_IN_OVERLAP_MS`

### Task 7: The zoom-in finishes after the region starts

**Files:**
- Modify: `src/shared/zoom/config.ts`, `src/shared/zoom/keyframes.ts`
- Test: `src/shared/zoom/keyframes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_ZOOM_CONFIG.zoomInOverlapMs: number` (default `500`), read by `segmentsToKeyframes`.

- [ ] **Step 1: Record the before**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run tune -- all"`
Save the full output. **Per HANDOVER no dial moves without this.**

- [ ] **Step 2: Write the failing test**

Add to `src/shared/zoom/keyframes.test.ts`, inside the existing `describe("segmentsToKeyframes", ...)`. That file already defines everything these need at module scope: `ctx: PlanContext`, `cfg = DEFAULT_ZOOM_CONFIG`, `START = 4000`, `END = 7000`, and `seg(over?: Partial<ZoomSegment>): ZoomSegment`. Use them; do not build a new fixture.

The in-keyframe is `id: "k0i"` and today lands at `tSourceMs: START`.

```ts
  it("finishes the zoom-in after the region starts, not at it", () => {
    const kfs = segmentsToKeyframes([seg()], { ...cfg, zoomInOverlapMs: 500 }, ctx);

    expect(kfs[0]).toMatchObject({ id: "k0i", tSourceMs: START + 500 });
  });

  it("is a no-op at zero overlap", () => {
    const kfs = segmentsToKeyframes([seg()], { ...cfg, zoomInOverlapMs: 0 }, ctx);

    expect(kfs[0]).toMatchObject({ id: "k0i", tSourceMs: START });
  });

  it("still emits exactly the in/out pair", () => {
    // The overlap shifts when a keyframe lands. If it changes how many are
    // emitted, it is leaking into segment selection, which is a bug.
    expect(segmentsToKeyframes([seg()], { ...cfg, zoomInOverlapMs: 500 }, ctx)).toHaveLength(2);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/zoom/keyframes.test.ts"`
Expected: FAIL — `zoomInOverlapMs` does not exist.

- [ ] **Step 4: Implement**

In `config.ts`, beside `transitionMs` and `transitionOutMs`:

```ts
  /**
   * How long after a region starts the zoom-in finishes.
   *
   * The camera is still arriving as activity begins, rather than sitting
   * settled and waiting. Measured off Recordly's ZOOM_IN_OVERLAP_MS.
   */
  zoomInOverlapMs: 500,
```

In `keyframes.ts`, shift the settled keyframe by `config.zoomInOverlapMs`. **The transition must still not start before the keyframe it leaves** — that guard landed as `42c16bf` and took the worst single-frame camera move from 495px to 85px. Do not regress it; if the overlap would violate it, clamp the overlap, not the guard.

- [ ] **Step 5: Run tests**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test"`
Expected: green, including the two new tests.

- [ ] **Step 6: Record the after and compare**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run tune -- all; npm run verify:parity"`

Compare against Step 1. Zoom count and pacing should be near-identical — this shifts *when* a zoom settles, not whether one is planned. **A changed zoom count means the overlap is leaking into segment selection, which is a bug.**

- [ ] **Step 7: Commit**

```bash
git add src/shared/zoom/config.ts src/shared/zoom/keyframes.ts src/shared/zoom/keyframes.test.ts
git commit -m "feat: finish the zoom-in 500ms into the region

tune -- all before/after: <counts and pacing, both runs>.
The camera is still arriving as activity begins instead of sitting
settled. Ported from Recordly's ZOOM_IN_OVERLAP_MS."
```

---

## Phase 4 — Motion blur (phase D)

### Task 8: The control law, as a pure function

**Files:**
- Create: `src/shared/style/motionBlur.ts`
- Test: `src/shared/style/motionBlur.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `blurAt(prev: CameraSample, next: CameraSample, dtMs: number, outputSize: { w: number; h: number }, amount: number): { px: number; angleRad: number; kernel: number }` where `CameraSample = { x: number; y: number; scale: number }`.

- [ ] **Step 1: Write the failing test**

The control law is fully specified in the spec; these tests encode it.

```ts
import { describe, expect, it } from "vitest";
import { blurAt } from "./motionBlur";

const OUT = { w: 1920, h: 1080 };
const still = { x: 0, y: 0, scale: 1 };

describe("blurAt", () => {
  it("is zero for a still camera", () => {
    expect(blurAt(still, still, 16, OUT, 1).px).toBe(0);
  });

  it("is zero below the 15px/s deadzone", () => {
    // 0.1px over 16ms is 6.25px/s.
    expect(blurAt(still, { x: 0.1, y: 0, scale: 1 }, 16, OUT, 1).px).toBe(0);
  });

  it("counts scale change as motion, so a pure zoom blurs", () => {
    const zooming = { x: 0, y: 0, scale: 1.2 };
    expect(blurAt(still, zooming, 16, OUT, 1).px).toBeGreaterThan(0);
  });

  it("is quadratic, so doubling speed more than doubles blur", () => {
    const slow = blurAt(still, { x: 4, y: 0, scale: 1 }, 16, OUT, 1).px;
    const fast = blurAt(still, { x: 8, y: 0, scale: 1 }, 16, OUT, 1).px;
    expect(fast).toBeGreaterThan(slow * 2);
  });

  it("saturates at 8px times amount", () => {
    const huge = blurAt(still, { x: 10_000, y: 0, scale: 1 }, 16, OUT, 1).px;
    expect(huge).toBeCloseTo(8, 5);
  });

  it("scales with amount", () => {
    const one = blurAt(still, { x: 10_000, y: 0, scale: 1 }, 16, OUT, 1).px;
    const half = blurAt(still, { x: 10_000, y: 0, scale: 1 }, 16, OUT, 0.5).px;
    expect(half).toBeCloseTo(one / 2, 5);
  });

  it("clamps dt to 1-80ms so a stalled frame does not spike the blur", () => {
    const clamped = blurAt(still, { x: 100, y: 0, scale: 1 }, 5_000, OUT, 1);
    const at80 = blurAt(still, { x: 100, y: 0, scale: 1 }, 80, OUT, 1);
    expect(clamped.px).toBeCloseTo(at80.px, 5);
  });

  it("takes direction from the velocity vector", () => {
    expect(blurAt(still, { x: 100, y: 0, scale: 1 }, 16, OUT, 1).angleRad).toBeCloseTo(0, 5);
    expect(blurAt(still, { x: 0, y: 100, scale: 1 }, 16, OUT, 1).angleRad).toBeCloseTo(Math.PI / 2, 5);
  });

  it("steps the kernel 5 / 9 / 11 by blur amount", () => {
    const kernels = [0.5, 3, 7].map(
      (px) => blurAt(still, { x: px * 60, y: 0, scale: 1 }, 16, OUT, 1).kernel,
    );
    expect(new Set(kernels).size).toBeGreaterThan(1);
    for (const k of kernels) expect([5, 9, 11]).toContain(k);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/style/motionBlur.test.ts"`
Expected: FAIL — cannot resolve `./motionBlur`.

- [ ] **Step 3: Implement**

```ts
/**
 * Directional motion blur strength from camera movement.
 *
 * Measured off Recordly's zoomTransform.ts on 2026-09-07 and recorded in
 * docs/specs/2026-09-08-preview-frame-source-split-design.md.
 *
 * MUST be evaluated on the fixed grid, not per displayed frame: a per-frame
 * formulation makes a 60fps preview and a 30fps export diverge and fails
 * verify:parity.
 */
export type CameraSample = { x: number; y: number; scale: number };

const DEADZONE_PX_PER_S = 15;
const SPEED_SATURATION = 2000;
const MAX_BLUR_PX = 8;
const DIRECTION_GAIN = 1.2;

export function blurAt(
  prev: CameraSample,
  next: CameraSample,
  dtMs: number,
  outputSize: { w: number; h: number },
  amount: number,
): { px: number; angleRad: number; kernel: number } {
  const dt = Math.min(80, Math.max(1, dtMs)) / 1000;

  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dScale = next.scale - prev.scale;

  const velocity = Math.hypot(dx, dy) / dt;
  // Scale change counts as motion, so a pure zoom blurs too.
  const scaleSpeed = (Math.abs(dScale) * Math.max(outputSize.w, outputSize.h) * 0.5) / dt;
  const speed = velocity + scaleSpeed;

  if (speed < DEADZONE_PX_PER_S) {
    return { px: 0, angleRad: 0, kernel: 5 };
  }

  const normalised = Math.min(1, speed / SPEED_SATURATION);
  const px = normalised * normalised * MAX_BLUR_PX * amount;

  const angleRad = Math.atan2(dy * DIRECTION_GAIN, dx * DIRECTION_GAIN);

  const kernel = px < 2 ? 5 : px < 5 ? 9 : 11;

  return { px, angleRad, kernel };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/style/motionBlur.test.ts; npm test"`
Expected: PASS, 9 new tests; suite green.

- [ ] **Step 5: Commit**

```bash
git add src/shared/style/motionBlur.ts src/shared/style/motionBlur.test.ts
git commit -m "feat: motion blur control law

Pure function, no renderer changes yet. Quadratic with a 15px/s deadzone;
scale change counts as motion so a pure zoom blurs."
```

### Task 9: The WebGL2 blur pass

**Files:**
- Modify: `src/shared/project/types.ts` (`StyleConfig`), `src/shared/project/defaults.ts` (`defaultProject`), `src/shared/project/migrate.ts` (`normalizeProject`), `src/renderer/gl/shaders.ts`, `src/renderer/gl/Renderer.ts`, `src/renderer/ui/StylePanel.tsx` (the control)
- Test: `src/shared/project/defaults.test.ts`, `src/shared/project/migrate.test.ts`

**Note:** the setting does **not** go in `src/shared/style/frame.ts`. That module is presets only — `FRAME_PRESETS` and `resolveFrame`, covering corner radius, shadow and border. Motion blur is a camera property, so it belongs on `StyleConfig` beside `paddingFactor`.

**Interfaces:**
- Consumes: `blurAt` from Task 8.
- Produces: `StyleConfig` gains `motionBlurAmount: number`; `FrameState` gains `motionBlur?: { px: number; angleRad: number; kernel: number }`.

- [ ] **Step 1: Write the failing tests for the setting**

`StyleConfig` today is `{ paddingFactor, frame, background, cursor }`. Add `motionBlurAmount: number`.

In `src/shared/project/defaults.test.ts`:

```ts
it("defaults motion blur off", () => {
  expect(defaultProject("b1").style.motionBlurAmount).toBe(0);
});
```

In `src/shared/project/migrate.test.ts` — read the file first and use its existing helper for building a partial project to normalize:

```ts
it("clamps motion blur amount into 0..1", () => {
  const high = normalizeProject({ ...defaultProject("b1"), style: { ...defaultProject("b1").style, motionBlurAmount: 5 } });
  expect(high.style.motionBlurAmount).toBe(1);

  const low = normalizeProject({ ...defaultProject("b1"), style: { ...defaultProject("b1").style, motionBlurAmount: -1 } });
  expect(low.style.motionBlurAmount).toBe(0);
});

it("fills motion blur in for a project saved before the field existed", () => {
  const old = defaultProject("b1");
  delete (old.style as { motionBlurAmount?: number }).motionBlurAmount;

  expect(normalizeProject(old).style.motionBlurAmount).toBe(0);
});
```

The third test matters: `exportRunner` writes `project.json` so a bundle can be re-exported identically, and every bundle on disk predates this field. A missing value must normalize to 0, not `NaN`.

Defaulting to **0** is deliberate: `2026-09-04-composition-and-camera-design.md:375` records that blur may default off if export time suffers, and an off-by-default setting cannot regress `verify:parity` on the default configuration.

- [ ] **Step 2: Run tests to verify they fail**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npx vitest run src/shared/project/"`
Expected: FAIL — `motionBlurAmount` does not exist on `StyleConfig`.

- [ ] **Step 3: Add the setting, then the shader pass**

Add `motionBlurAmount: number` to `StyleConfig`, `motionBlurAmount: 0` to `defaultProject`, and a `0..1` clamp with a `?? 0` fallback in `normalizeProject`.

In `shaders.ts` add a directional blur sampling `kernel` taps along `angleRad`, spaced so total travel is `px`, in output pixels:

```glsl
// Directional motion blur. Taps are spaced along the velocity vector so the
// total smear is uBlurPx output pixels regardless of kernel size.
vec4 motionBlur(sampler2D tex, vec2 uv, vec2 texel, float blurPx, float angle, int kernel) {
  if (blurPx <= 0.0) return texture(tex, uv);

  vec2 dir = vec2(cos(angle), sin(angle)) * texel * blurPx;
  vec4 sum = vec4(0.0);
  float half = float(kernel - 1) * 0.5;

  for (int i = 0; i < 11; i++) {
    if (i >= kernel) break;
    float offset = (float(i) - half) / half;
    sum += texture(tex, uv + dir * offset);
  }

  return sum / float(kernel);
}
```

The `i < 11` bound with an inner `break` is required: GLSL ES 3.0 needs a constant loop bound. 11 is the largest kernel step.

Wire it as pass 5 of the composition pipeline per `2026-09-04-composition-and-camera-design.md:214`, reading `state.motionBlur`.

At both `drawFrame` call sites, compute `motionBlur` from `blurAt` using the camera at `t` and at `t - gridStepMs`, **where `gridStepMs` is the fixed grid step, not the elapsed frame time.** This is the parity-critical detail: using real elapsed time makes a 60fps preview and a 30fps export diverge.

- [ ] **Step 4: Run the gate**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm run typecheck; npm test; npm run build; npm run verify:parity"`
Expected: silent, green, three bundles, **parity 25/25** — the default configuration has blur at 0, so it must be untouched.

- [ ] **Step 5: Verify on an export, not in the editor**

Set the blur amount above 0 in the style panel, export a clip with a fast pan, and view it. Per the handoff doc, motion blur is judged on an export.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/gl/shaders.ts src/renderer/gl/Renderer.ts src/shared/project/types.ts src/shared/project/defaults.ts src/shared/project/defaults.test.ts src/shared/project/migrate.ts src/shared/project/migrate.test.ts src/renderer/ui/StylePanel.tsx
git commit -m "feat: directional motion blur (phase D)

Off by default, so the default parity configuration is unmoved.
Evaluated on the fixed grid rather than per displayed frame -- a
per-frame formulation diverges between a 60fps preview and a 30fps
export."
```

---

## Phase 5 — The ffmpeg question

### Task 10: Probe `ffmpeg-static` for `ddagrab`, then decide

**Files:**
- Modify: depends on the result. Possibly `package.json`, `src/main/ffmpeg.ts`.

**This task is a gate, not a foregone conclusion.** `src/main/ffmpeg.ts:5` records that ffmpeg is *deliberately* not vendored, and `ffmpeg.ts:56` asserts capture needs the `ddagrab` filter. `ffmpeg-static` ships a generic build. If it lacks `ddagrab`, bundling it does not fix a broken install — it breaks a working one.

- [ ] **Step 1: Probe**

```powershell
cd C:\dev\zoomcast
npm i -D ffmpeg-static
node -e "console.log(require('ffmpeg-static'))"
& (node -p "require('ffmpeg-static')") -hide_banner -filters | Select-String ddagrab
```

- [ ] **Step 2: Branch on the result**

**If `ddagrab` is present:**
- Promote `ffmpeg-static` to a dependency.
- Change `resolveFfmpeg()` to `process.env.ZOOMCAST_FFMPEG ?? ffmpegStatic ?? "ffmpeg"`, keeping the env override and PATH as fallbacks.
- Rewrite the `ffmpeg.ts:5` comment to record the reversal and its reason — the old comment is now wrong and it is a decision log.
- Add the binary to `electron-builder` `extraResources` and confirm `npm run dist` produces a working installer.
- Verify a real recording still uses `ddagrab` and `h264_amf`.

**If `ddagrab` is absent:**
- `npm uninstall ffmpeg-static`. Do not bundle.
- Instead add a startup capability check that runs `probeFilters` once and surfaces a real message ("ffmpeg on PATH has no ddagrab filter; screen capture needs ffmpeg 6.0+ built with it") in the UI rather than failing at record time.
- Record the finding in `HANDOVER.md` so the question is closed rather than re-opened next session.

- [ ] **Step 3: Gate**

Run: `powershell.exe -NoProfile -Command "cd C:\dev\zoomcast; npm test; npm run typecheck; npm run build"`
Expected: green.

- [ ] **Step 4: Commit**

Message must state which branch was taken and the probe output that decided it.

---

## Done means

- `bench:preview` median recorded before and after, batch of 5 each, on the same take.
- `npm test` ≥ 326 passing, `npm run typecheck` silent.
- `npm run verify:parity` 25/25 at ≥28dB. `npm run verify:decode` 6/6 with k=0.
- `npm run tune -- all` output recorded either side of Task 7.
- `HANDOVER.md` no longer claims the preview runs at ~13fps.
- The ffmpeg question is closed in `HANDOVER.md` with the probe result, whichever way it went.
