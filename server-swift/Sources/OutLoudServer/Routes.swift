import Foundation
import Hummingbird
import NIOCore
import NIOPosix
import TextNormalization

private struct SpeechRequest: Decodable, Sendable {
    let input: String
    let voice: String
    let speed: Float?
    let response_format: String?
}

private func addCORS(to headers: inout HTTPFields) {
    headers[.accessControlAllowOrigin] = "*"
    headers[.accessControlAllowMethods] = "GET, POST, OPTIONS"
    headers[.accessControlAllowHeaders] = "Content-Type, Authorization"
}

private func jsonResponse(_ encodable: some Encodable) throws -> Response {
    let body = try JSONEncoder().encode(encodable)
    var headers: HTTPFields = [.contentType: "application/json"]
    addCORS(to: &headers)
    return Response(
        status: .ok,
        headers: headers,
        body: ResponseBody(byteBuffer: ByteBuffer(bytes: body))
    )
}

private func textChunks(for input: String) -> [AudioUtils.TextChunk] {
    let chunks = AudioUtils.splitSentences(input)
    guard chunks.isEmpty else { return chunks }
    return [AudioUtils.TextChunk(text: input, utf16Start: 0, utf16End: input.utf16.count)]
}

func registerRoutes(on router: Router<BasicRequestContext>, tts: TTSActor) {
    router.on("/**", method: .options) { _, _ -> Response in
        var headers = HTTPFields()
        addCORS(to: &headers)
        return Response(status: .noContent, headers: headers)
    }

    router.get("/api/v1/info") { _, _ -> Response in
        let info: [String: String] = ["acceleration": "coreml", "platform": "darwin", "arch": "arm64"]
        return try jsonResponse(info)
    }

    router.get("/api/v1/audio/voices") { _, _ -> Response in
        struct VoiceList: Encodable { let voices: [Voice] }
        return try jsonResponse(VoiceList(voices: VoiceRegistry.voices))
    }

    router.post("/api/v1/audio/speech") { req, _ -> Response in
        let buf = try await req.body.collect(upTo: 1 << 20)
        let params = try JSONDecoder().decode(SpeechRequest.self, from: Data(buffer: buf))
        let voice = params.voice
        let language = VoiceRegistry.language(for: voice)
        let speed = params.speed ?? 1.0
        let chunks = textChunks(for: params.input)
        var allSamples: [Float] = []
        for chunk in chunks {
            let normalized = await TextNormalizer.normalize(chunk.text)
            for sub in AudioUtils.splitForSynthesis(normalized) {
                let samples = try await tts.synthesize(text: sub, voice: voice, language: language, speed: speed)
                allSamples.append(contentsOf: samples)
            }
        }
        let wav = AudioUtils.makeWAV(samples: allSamples)
        var headers: HTTPFields = [.contentType: "audio/wav"]
        addCORS(to: &headers)
        return Response(
            status: .ok,
            headers: headers,
            body: ResponseBody(byteBuffer: ByteBuffer(bytes: wav))
        )
    }

    router.post("/api/v1/audio/speech/stream") { req, _ -> Response in
        let buf = try await req.body.collect(upTo: 1 << 20)
        let params = try JSONDecoder().decode(SpeechRequest.self, from: Data(buffer: buf))
        let chunks = textChunks(for: params.input)
        let total = chunks.count
        let voice = params.voice
        let language = VoiceRegistry.language(for: voice)
        let speed = params.speed ?? 1.0

        var headers: HTTPFields = [.contentType: "application/octet-stream"]
        addCORS(to: &headers)

        let body = ResponseBody { writer in
            for (index, chunk) in chunks.enumerated() {
                let normalized = await TextNormalizer.normalize(chunk.text)
                var combinedSamples: [Float] = []
                for sub in AudioUtils.splitForSynthesis(normalized) {
                    let samples = try await tts.synthesize(text: sub, voice: voice, language: language, speed: speed)
                    combinedSamples.append(contentsOf: samples)
                }
                let wav = AudioUtils.makeWAV(samples: combinedSamples)
                let chunkHeader = AudioUtils.makeChunkHeader(
                    index: index,
                    total: total,
                    dataLen: wav.count,
                    textStart: chunk.utf16Start,
                    textEnd: chunk.utf16End
                )
                var out = ByteBuffer()
                out.writeBytes(chunkHeader)
                out.writeBytes(wav)
                try await writer.write(out)
            }
            try await writer.finish(nil)
        }

        return Response(status: .ok, headers: headers, body: body)
    }
}
