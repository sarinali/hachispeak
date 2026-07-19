# hachispeak

Local TTS with a Swift/CoreML server and Chrome client support. Named after hachiware.

Originally based on [Out Loud](https://github.com/light-cloud-com/out-loud) by [Light Cloud Labs](https://github.com/light-cloud-com).

<img width="360" height="360" alt="image" src="https://github.com/user-attachments/assets/168479b2-d300-41af-8af2-8b0ccf5c51aa" />

Free, open-source, 100% offline AI text-to-speech. Runs a local HTTP server on port `51730` powered by [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M). Nothing leaves your machine.

## Structure

```
server-swift/   Local TTS HTTP server (Swift + CoreML)
clients/
  chrome/       Chrome extension
```

## Running the server

Requires [Swift](https://www.swift.org/install/) >= 6 (comes with Xcode on macOS).

```bash
bun run server:start
```

The server starts on `http://127.0.0.1:51730`. On first run it downloads the Kokoro model weights from HuggingFace (~350 MB).

## API

```bash
# List voices
curl http://127.0.0.1:51730/api/v1/audio/voices

# Generate audio
curl -X POST http://127.0.0.1:51730/api/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"voice":"af_heart","input":"Hello, world."}' \
  --output hello.wav
```

## Chrome extension

Load `clients/chrome/` as an unpacked extension in Chrome. It talks to the server at port `51730`.

## Performance

Benchmarked on Apple M4 Pro (14-core, 48 GB) using the Swift/CoreML backend.

| Text length              | TTFA p50 | TTFA p95 | RTF p50 | RTF p95 |
| ------------------------ | -------- | -------- | ------- | ------- |
| Short sentence (9 words) | 126 ms   | 171 ms   | 0.041×  | 0.056×  |
| Paragraph (48 words)     | 124 ms   | 130 ms   | 0.031×  | 0.034×  |
| Long passage (155 words) | 124 ms   | 130 ms   | 0.033×  | 0.036×  |

**TTFA** (Time to First Audio) — how long until the first audio chunk arrives. Consistently under 130 ms across all lengths due to sentence-level streaming.

**RTF** (Real-Time Factor) — synthesis time ÷ audio duration. 0.033× means audio is generated ~30× faster than real-time. Measured over HTTP including phonemisation and WAV serialisation.

> Previous Node/ONNX baseline (CPU, same machine): TTFA ~500 ms p50, RTF ~0.47×. The Swift/CoreML backend is ~4× faster on TTFA and ~14× faster on RTF.

Run benchmarks yourself:

```bash
bun run bench                          # 5 runs, all paragraph lengths
bun run bench --runs 10 --json         # machine-readable output
```

## License

MIT. Credits: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0), [speech-swift](https://github.com/soniqo/speech-swift), [Hummingbird](https://github.com/hummingbird-project/hummingbird).
