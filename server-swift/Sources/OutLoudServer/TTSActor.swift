import Foundation
import KokoroTTS

// KokoroTTSModel is a final class that is not Sendable.
// We access it only within this actor's serial executor, making access safe.
// The nonisolated(unsafe) annotation tells Swift 6 to trust us on this.
actor TTSActor {
    nonisolated(unsafe) private let model: KokoroTTSModel

    init(model: KokoroTTSModel) {
        self.model = model
    }

    /// Synthesize a single text segment. Runs synchronously on the actor's executor,
    /// serializing all TTS calls (CoreML serializes through a single Metal dispatch queue).
    func synthesize(text: String, voice: String, language: String, speed: Float) throws -> [Float] {
        try model.synthesize(text: text, voice: voice, language: language, speed: speed)
    }

    var availableVoices: [String] {
        model.availableVoices
    }
}
