import Foundation
import NIOCore

enum AudioUtils {
    static let sampleRate: Int = 24000

    /// Encode Float32 PCM samples as a minimal WAV file.
    static func makeWAV(samples: [Float]) -> Data {
        let numSamples = samples.count
        let dataSize = numSamples * 2          // 16-bit PCM
        let chunkSize = 36 + dataSize

        var data = Data(capacity: 44 + dataSize)

        func writeLE16(_ v: Int)  { var x = UInt16(v & 0xFFFF); data.append(contentsOf: withUnsafeBytes(of: &x) { Array($0) }) }
        func writeLE32(_ v: Int)  { var x = UInt32(bitPattern: Int32(v)); data.append(contentsOf: withUnsafeBytes(of: &x) { Array($0) }) }
        func writeTag(_ s: String) { data.append(contentsOf: s.utf8) }

        writeTag("RIFF");  writeLE32(chunkSize)
        writeTag("WAVE")
        writeTag("fmt "); writeLE32(16)
        writeLE16(1)                  // PCM
        writeLE16(1)                  // mono
        writeLE32(sampleRate)         // sample rate
        writeLE32(sampleRate * 2)     // byte rate
        writeLE16(2)                  // block align
        writeLE16(16)                 // bits per sample
        writeTag("data"); writeLE32(dataSize)

        for s in samples {
            let clamped = max(-1.0, min(1.0, s))
            let pcm = Int16(clamped * 32767.0)
            var x = pcm
            data.append(contentsOf: withUnsafeBytes(of: &x) { Array($0) })
        }

        return data
    }

    /// 12-byte chunk header: [chunkIndex LE32][totalChunks LE32][dataLen LE32]
    static func makeChunkHeader(index: Int, total: Int, dataLen: Int) -> Data {
        var d = Data(count: 12)
        d.withUnsafeMutableBytes { ptr in
            ptr.storeBytes(of: UInt32(index),   toByteOffset: 0, as: UInt32.self)
            ptr.storeBytes(of: UInt32(total),   toByteOffset: 4, as: UInt32.self)
            ptr.storeBytes(of: UInt32(dataLen), toByteOffset: 8, as: UInt32.self)
        }
        return d
    }

    /// Split text into sentences on sentence-ending punctuation + newlines.
    static func splitSentences(_ text: String) -> [String] {
        var sentences: [String] = []
        var current = ""
        for char in text {
            current.append(char)
            if ".!?\n".contains(char) {
                let trimmed = current.trimmingCharacters(in: .whitespaces)
                if !trimmed.isEmpty { sentences.append(trimmed) }
                current = ""
            }
        }
        let tail = current.trimmingCharacters(in: .whitespaces)
        if !tail.isEmpty { sentences.append(tail) }
        return sentences.filter { !$0.isEmpty }
    }

    /// Split a sentence into word-count sub-chunks that fit within the model's 5-second
    /// output window (kokoro_5s produces at most 120,000 samples). At average speaking
    /// rate (~2.5 words/sec), 10 words ≈ 4 seconds — safely under the 5-second cap.
    static func splitForSynthesis(_ text: String, maxWords: Int = 10) -> [String] {
        let words = text.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        guard words.count > maxWords else { return [text] }
        var chunks: [String] = []
        var current: [String] = []
        for word in words {
            current.append(word)
            if current.count >= maxWords {
                chunks.append(current.joined(separator: " "))
                current = []
            }
        }
        if !current.isEmpty { chunks.append(current.joined(separator: " ")) }
        return chunks.isEmpty ? [text] : chunks
    }
}
