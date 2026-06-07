# Out Loud

Free, open-source, 100% offline AI text-to-speech. Runs a local HTTP server on port `51730` powered by [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M). Nothing leaves your machine.

## Structure

```
server/       Local TTS HTTP server (Bun + ONNX)
clients/
  chrome/     Chrome extension
```

## Running the server

Requires [Bun](https://bun.sh) >= 1.

```bash
bun run server:install
bun run server:compile
bun run server:start
```

The server starts on `http://127.0.0.1:51730`.

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

OpenAPI spec served at `http://127.0.0.1:51730/api/v1/openapi.yaml` while running.

## Chrome extension

Load `clients/chrome/` as an unpacked extension in Chrome. It talks to the server at port `51730`.

## Performance

Benchmarked on Apple M4 Pro (14-core, 48 GB) using ONNX Runtime CPU — no CoreML (Kokoro's op set is not supported by the CoreML EP).

| Text length              | TTFA p50 | TTFA p95 | RTF p50 |
| ------------------------ | -------- | -------- | ------- |
| Short sentence (9 words) | ~1.1 s   | ~1.1 s   | 0.48×   |
| Paragraph (48 words)     | ~620 ms  | ~650 ms  | 0.48×   |
| Long passage (155 words) | ~590 ms  | ~640 ms  | 0.44×   |

**TTFA** (Time to First Audio) — how long until sound starts playing. Paragraph text is faster than a short sentence because the streaming path splits the first chunk to ~15 tokens; a lone sentence skips that optimisation.

**RTF** (Real-Time Factor) — synthesis time ÷ audio duration. 0.47× means audio is generated 2× faster than real-time. Measured over HTTP, including phonemisation and WAV serialisation.

Run benchmarks yourself:

```bash
bun bench                          # 5 runs, all paragraph lengths
bun bench --runs 10 --json         # machine-readable output
```

## License

MIT. Credits: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0), [espeak-ng](https://github.com/espeak-ng/espeak-ng), [onnxruntime-node](https://onnxruntime.ai/).
