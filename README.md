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

## License

MIT. Credits: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0), [espeak-ng](https://github.com/espeak-ng/espeak-ng), [onnxruntime-node](https://onnxruntime.ai/).
