import type { DownloadAsset } from "./download";

// Immutable upstream releases and content hashes. Audio is never uploaded.
export const ENGINE: DownloadAsset = {
  url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip",
  bytes: 3968674,
  sha256: "d824b1e37599f882b396e73f1ee0bfd5d0529f700314c48311dcbd00b803321d",
};
export const MODEL: DownloadAsset = {
  url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin?download=true",
  bytes: 59707625,
  sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
};
export const MODEL_FILE = "ggml-base-q5_1.bin";
export const RUNTIME_FOLDER = "whisper-1.8.3-base-q5_1";

export const SPEECH_NOTICES = `Zoomcast optional offline speech recognition

whisper.cpp v1.8.3: https://github.com/ggml-org/whisper.cpp/tree/v1.8.3
Copyright (c) 2023-2024 The ggml authors

Whisper model: https://github.com/openai/whisper
Copyright (c) 2022 OpenAI

Both are licensed under the MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
