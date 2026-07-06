import Testing
import TextNormalization

@Suite("TextNormalizer pipeline coverage")
struct NormalizationTests {

    func normalize(_ input: String) async -> String {
        await TextNormalizer.normalize(input)
    }

    // ── Numbers ──────────────────────────────────────────────────────────────

    @Test func integerSpelledOut() async {
        let out = await normalize("42")
        #expect(out.lowercased().contains("forty") && out.lowercased().contains("two"),
                "Expected 'forty-two', got: \(out)")
    }

    @Test func decimalNumber() async {
        let out = await normalize("0.033")
        #expect(out.lowercased().contains("zero") && (out.lowercased().contains("point") || out.lowercased().contains("dot")),
                "Expected decimal expansion, got: \(out)")
    }

    @Test func largeNumber() async {
        let out = await normalize("130")
        #expect(out.lowercased().contains("one hundred") && out.lowercased().contains("thirty"),
                "Expected 'one hundred thirty', got: \(out)")
    }

    // ── Units ─────────────────────────────────────────────────────────────────

    @Test func milliseconds() async {
        let out = await normalize("130ms")
        #expect(out.lowercased().contains("millisecond"),
                "Expected 'millisecond(s)', got: \(out)")
        #expect(out.lowercased().contains("one hundred") && out.lowercased().contains("thirty"),
                "Expected number to be spelled out, got: \(out)")
    }

    @Test func kilometers() async {
        let out = await normalize("42km")
        #expect(out.lowercased().contains("kilometer"),
                "Expected 'kilometer(s)', got: \(out)")
    }

    @Test func hertz() async {
        let out = await normalize("48kHz")
        #expect(out.lowercased().contains("kilohertz"),
                "Expected 'kilohertz', got: \(out)")
    }

    // ── Multiplier / ratio ────────────────────────────────────────────────────

    @Test func speedMultiplier() async {
        let out = await normalize("0.033x")
        #expect(!out.contains("0.033"),
                "Raw '0.033x' should not survive, got: \(out)")
        #expect(out.lowercased().contains("times"),
                "Expected 'times', got: \(out)")
    }

    // ── Percentile notation ───────────────────────────────────────────────────

    @Test func percentile_p50() async {
        let out = await normalize("p50")
        #expect(out.lowercased().contains("fifty"),
                "Expected p50 → 'fifty', got: \(out)")
    }

    @Test func percentile_p99() async {
        let out = await normalize("p99")
        #expect(out.lowercased().contains("ninety"),
                "Expected p99 → 'ninety', got: \(out)")
    }

    // ── Currency (handled by TextForSpeech, must not regress) ─────────────────

    @Test func dollarAmount() async {
        let out = await normalize("$9.39")
        #expect(out.lowercased().contains("dollar") || out.lowercased().contains("nine"),
                "Expected currency expansion, got: \(out)")
    }

    @Test func largeDollarAmount() async {
        let out = await normalize("$1,200")
        #expect(out.lowercased().contains("thousand") || out.lowercased().contains("twelve hundred"),
                "Expected 'one thousand two hundred', got: \(out)")
    }

    // ── Abbreviations (pass-through; Kokoro spells letter-by-letter) ──────────

    @Test func rtfAbbreviation() async {
        let out = await normalize("RTF")
        #expect(!out.isEmpty, "RTF should not produce empty output, got: \(out)")
        print("RTF → \(out)")
    }

    @Test func ttfaAbbreviation() async {
        let out = await normalize("TTFA")
        #expect(!out.isEmpty, "TTFA should not produce empty output, got: \(out)")
        print("TTFA → \(out)")
    }

    // ── Punctuation / symbols ─────────────────────────────────────────────────

    @Test func forwardSlash() async {
        let out = await normalize("synthesis time / audio duration")
        #expect(!out.isEmpty, "Slash phrase should not produce empty output, got: \(out)")
        print("slash → \(out)")
    }

    @Test func exclamationMark() async {
        let out = await normalize("under 130ms!")
        #expect(out.lowercased().contains("millisecond"),
                "Expected 'millisecond(s)', got: \(out)")
        #expect(out.lowercased().contains("one hundred") && out.lowercased().contains("thirty"),
                "Expected number expansion, got: \(out)")
    }

    // ── Contractions (must not regress) ───────────────────────────────────────

    @Test func contractions() async {
        let out = await normalize("it's working, don't stop")
        #expect(out.lowercased().contains("it") && out.lowercased().contains("working"),
                "Contraction text should pass through intact, got: \(out)")
    }

    // ── Real-world sentence ───────────────────────────────────────────────────

    @Test func realWorldSentence() async {
        let input = "(RTF 0.033x p50 on long passages, synthesis time / audio duration, TTFA time to first audio chunk is under 130ms!)"
        let out = await normalize(input)
        print("=== REAL WORLD ===")
        print("IN:  \(input)")
        print("OUT: \(out)")

        #expect(!out.contains("0.033"), "Raw decimal should be expanded, got: \(out)")
        #expect(!out.contains("130ms"), "Raw '130ms' should be expanded, got: \(out)")
        #expect(!out.contains("p50"), "Percentile should be expanded, got: \(out)")
        #expect(out.lowercased().contains("times"), "0.033x should become '... times', got: \(out)")
        #expect(out.lowercased().contains("millisecond"), "130ms should become 'milliseconds', got: \(out)")
    }
}
