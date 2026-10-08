# Third-party software

The MIT license applies to Zoomcast's original code. It does not replace the licenses of its dependencies or bundled media tools.

## FFmpeg and ffprobe

The bundled media build includes x264 and is GPL-2.0-or-later. Each installer release provides the matching `zoomcast-ffmpeg-source-<version>.zip` and SHA-256 checksum under the same release's Assets. The archive includes pinned sources, build scripts, configuration, and upstream notices. Installed notices are in the application's `resources/ffmpeg` directory. See [build details](build/FFMPEG-SOURCES.md).

## Electron and application dependencies

Electron includes its MIT license and Chromium third-party notices in the installed application. Application dependencies retain their upstream licenses, distributed within their packages. The exact dependency versions are recorded in `package-lock.json`; native dependencies include Koffi and uiohook-napi. Preserve those notices when redistributing builds.

The Zoomcast license does not grant trademark rights or patent licenses for third-party codecs.

## Background photographs and artwork

The bundled image backgrounds are supplied under the Unsplash License (https://unsplash.com/license), separately from Zoomcast’s MIT license. Original image links and photographer credits are in `src/renderer/public/backgrounds/CREDITS.md`, copied to `out/renderer/backgrounds/CREDITS.md` in packaged builds.

## Optional offline speech recognition

The on-demand engine is whisper.cpp v1.8.3, licensed under MIT by the ggml authors
(https://github.com/ggml-org/whisper.cpp/tree/v1.8.3). The downloaded Whisper base
multilingual model is licensed under MIT by OpenAI
(https://github.com/openai/whisper#license). The model is a quantized GGML conversion
from https://huggingface.co/ggerganov/whisper.cpp, pinned by revision and SHA-256.
The download installs only whisper-cli.exe and the whisper/ggml CPU libraries;
SDL and unrelated demo binaries are excluded. The complete MIT notices accompany
the installed speech files in THIRD-PARTY-NOTICES.txt. Speech assets are excluded
from installers and application update packages.

The ZIP reader fflate retains its upstream MIT license inside the dependency package.
