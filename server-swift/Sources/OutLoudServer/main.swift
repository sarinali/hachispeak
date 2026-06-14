import Foundation
import KokoroTTS
import Hummingbird

let port = 51730

print("[Server] Loading KokoroTTS model...")
let model = try await KokoroTTSModel.fromPretrained { fraction, stage in
    let pct = Int(fraction * 100)
    print("[Model] \(pct)% — \(stage)")
}
print("[Server] Model loaded. Warming up...")
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
