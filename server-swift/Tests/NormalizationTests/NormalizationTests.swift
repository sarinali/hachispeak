import Testing
import TextForSpeech

@Suite("TextForSpeech normalization coverage")
struct NormalizationTests {

    func normalize(_ input: String) async throws -> String {
        try await TextForSpeech.Normalize.text(input, style: .balanced)
    }

    @Test func integerSpelledOut() async throws {
        let out = try await normalize("42")
        #expect(out.lowercased().contains("forty") && out.lowercased().contains("two"),
                "Expected 'forty-two', got: \(out)")
    }

    @Test func decimalNumber() async throws {
        let out = try await normalize("0.033")
        #expect(out.lowercased().contains("zero") || out.lowercased().contains("point"),
                "Expected decimal expansion, got: \(out)")
    }

    @Test func largeNumber() async throws {
        let out = try await normalize("130")
        #expect(out.lowercased().contains("one hundred") && out.lowercased().contains("thirty"),
                "Expected 'one hundred thirty', got: \(out)")
    }

    @Test func milliseconds() async throws {
        let out = try await normalize("130ms")
        #expect(out.lowercased().contains("millisecond"),
                "Expected 'millisecond(s)', got: \(out)")
    }

    @Test func kilometers() async throws {
        let out = try await normalize("42km")
        #expect(out.lowercased().contains("kilometer"),
                "Expected 'kilometer(s)', got: \(out)")
    }

    @Test func speedMultiplier() async throws {
        let out = try await normalize("0.033x")
        #expect(!out.contains("0.033"),
                "Raw '0.033x' should not survive normalization, got: \(out)")
    }

    @Test func percentile_p50() async throws {
        let out = try await normalize("p50")
        #expect(out.lowercased().contains("fifty"),
                "Expected p50 → 'fifty', got: \(out)")
    }

    @Test func percentile_p99() async throws {
        let out = try await normalize("p99")
        #expect(out.lowercased().contains("ninety"),
                "Expected p99 → 'ninety', got: \(out)")
    }

    @Test func dollarAmount() async throws {
        let out = try await normalize("$9.39")
        #expect(out.lowercased().contains("dollar") || out.lowercased().contains("nine"),
                "Expected currency expansion, got: \(out)")
    }

    @Test func largeDollarAmount() async throws {
        let out = try await normalize("$1,200")
        #expect(out.lowercased().contains("thousand") || out.lowercased().contains("twelve hundred"),
                "Expected 'one thousand two hundred', got: \(out)")
    }

    @Test func rtfAbbreviation() async throws {
        let out = try await normalize("RTF")
        #expect(!out.isEmpty, "RTF should not produce empty output, got: \(out)")
        print("RTF → \(out)")
    }

    @Test func ttfaAbbreviation() async throws {
        let out = try await normalize("TTFA")
        #expect(!out.isEmpty, "TTFA should not produce empty output, got: \(out)")
        print("TTFA → \(out)")
    }

    @Test func forwardSlash() async throws {
        let out = try await normalize("synthesis time / audio duration")
        #expect(!out.isEmpty, "Slash phrase should not produce empty output, got: \(out)")
        print("slash → \(out)")
    }

    @Test func parentheses() async throws {
        let out = try await normalize("(RTF 0.033x p50 on long passages)")
        #expect(!out.isEmpty, "Parenthesised text should not produce empty output, got: \(out)")
        print("parens → \(out)")
    }

    @Test func exclamationMark() async throws {
        let out = try await normalize("under 130ms!")
        #expect(out.lowercased().contains("millisecond") || out.lowercased().contains("one hundred"),
                "Expected number expansion in exclamation sentence, got: \(out)")
    }

    // ── The actual failing sentence from the user ─────────────────────────────

    @Test func realWorldSentence() async throws {
        let input = "(RTF 0.033x p50 on long passages, synthesis time / audio duration, TTFA time to first audio chunk is under 130ms!)"
        let out = try await normalize(input)
        print("=== REAL WORLD ===")
        print("IN:  \(input)")
        print("OUT: \(out)")

        #expect(!out.contains("0.033"),
                "Raw decimal should be expanded, got: \(out)")
        #expect(!out.contains("130ms"),
                "Raw '130ms' should be expanded, got: \(out)")
    }

    @Test func contractions() async throws {
        let out = try await normalize("it's working, don't stop")
        #expect(out.lowercased().contains("it") && out.lowercased().contains("working"),
                "Contraction text should pass through intact, got: \(out)")
    }
}
