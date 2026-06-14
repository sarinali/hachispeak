import Foundation

struct Voice: Encodable, Sendable {
    let id: String
    let name: String
    let lang: String
    let engine: String
}

enum VoiceRegistry {
    static let voices: [Voice] = [
        Voice(id: "af_heart",   name: "Heart",    lang: "en-us", engine: "kokoro"),
        Voice(id: "af_bella",   name: "Bella",    lang: "en-us", engine: "kokoro"),
        Voice(id: "am_michael", name: "Michael",  lang: "en-us", engine: "kokoro"),
        Voice(id: "am_adam",    name: "Adam",     lang: "en-us", engine: "kokoro"),
        Voice(id: "bf_emma",    name: "Emma",     lang: "en-gb", engine: "kokoro"),
        Voice(id: "bm_george",  name: "George",   lang: "en-gb", engine: "kokoro"),
        Voice(id: "zf_xiaobei", name: "Xiaobei",  lang: "cmn",   engine: "kokoro"),
        Voice(id: "zm_yunjian", name: "Yunjian",  lang: "cmn",   engine: "kokoro"),
    ]

    // Map voice ID prefix to the language string speech-swift's phonemizer accepts.
    // Chinese prefixes: zf/zm → "zh" (ChinesePhonemizer)
    // All English prefixes fall through to default (en-us phonemizer).
    static func language(for voiceId: String) -> String {
        let prefix = String(voiceId.prefix(2))
        switch prefix {
        case "zf", "zm": return "zh"
        default:          return "en"
        }
    }
}
