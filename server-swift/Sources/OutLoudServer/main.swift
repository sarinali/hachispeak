import Foundation
import KokoroTTS
import Hummingbird

let port = 51730

print("[Server] Loading KokoroTTS model (first run downloads from HuggingFace)...")
// No progressHandler: fromPretrained calls it from a background executor,
// and Swift 6 traps when a @MainActor-captured closure crosses isolation domains.
let model = try await KokoroTTSModel.fromPretrained()
print("[Server] Model loaded. Warming up CoreML...")
try model.warmUp()
print("[Server] Warm-up complete.")

let tts = TTSActor(model: model)

let router = Router(context: BasicRequestContext.self)
registerRoutes(on: router, tts: tts)

let app = Application(
    router: router,
    configuration: ApplicationConfiguration(
        address: .hostname("127.0.0.1", port: port),
        serverName: "out-loud"
    )
)

print("[Server] Listening on http://127.0.0.1:\(port)")
try await app.runService()
