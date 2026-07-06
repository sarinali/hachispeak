import Foundation
import TextForSpeech

public enum TextNormalizer {

    // Unit and notation patterns that TextForSpeech doesn't handle.
    // Applied before digit spell-out so the number and its expanded label
    // are separated at word boundaries before substitution runs.
    private static let unitPatterns: [(NSRegularExpression, String)] = {
        let defs: [(String, String)] = [
            (#"(\d+(?:\.\d+)?)\s*x\b"#,      "$1 times"),        // 0.033x → 0.033 times
            (#"(\d+(?:\.\d+)?)\s*ms\b"#,     "$1 milliseconds"),
            (#"(\d+(?:\.\d+)?)\s*[uμ]s\b"#,  "$1 microseconds"),
            (#"(\d+(?:\.\d+)?)\s*ns\b"#,     "$1 nanoseconds"),
            (#"(\d+(?:\.\d+)?)\s*GHz\b"#,    "$1 gigahertz"),
            (#"(\d+(?:\.\d+)?)\s*MHz\b"#,    "$1 megahertz"),
            (#"(\d+(?:\.\d+)?)\s*kHz\b"#,    "$1 kilohertz"),
            (#"(\d+(?:\.\d+)?)\s*Hz\b"#,     "$1 hertz"),
            (#"\bp(\d+)\b"#,                 "p $1"),            // p50 → p 50
        ]
        return defs.compactMap { (pat, tmpl) in
            (try? NSRegularExpression(pattern: pat)).map { ($0, tmpl) }
        }
    }()

    // Matches standalone integers and decimals.
    // Excluded: currency-prefixed numbers ($9.39), numbers after a comma thousands
    // separator (1,200 → handled by stripCommaGrouping), letter-suffixed units (42km).
    private static let standaloneNumber: NSRegularExpression? =
        try? NSRegularExpression(
            pattern: #"(?<![a-zA-Z$£€¥,])\b\d+(?:\.\d+)?\b(?![a-zA-Z])"#
        )

    // Matches comma-grouped numbers not preceded by a currency symbol (e.g. 42,000).
    // Currency values like $1,200 are left for TextForSpeech.
    private static let commaGrouped: NSRegularExpression? =
        try? NSRegularExpression(
            pattern: #"(?<![a-zA-Z$£€¥])\b\d{1,3}(?:,\d{3})+\b"#
        )

    /// Full normalization pipeline for TTS input.
    /// 1. Unit pre-pass        — expand suffixes TextForSpeech misses (ms, Hz, p50, x)
    /// 2. Comma-group stripping — 42,000 → 42000 (standalone only; $1,200 untouched)
    /// 3. Spell-out            — bare digit strings → words via NumberFormatter
    /// 4. TextForSpeech        — currency, SI units, slash removal, symbols
    public static func normalize(_ input: String) async -> String {
        var text = applyUnitPatterns(input)
        text = stripCommaGrouping(text)
        text = spellOutDigits(text)
        text = (try? await TextForSpeech.Normalize.text(text, style: .balanced)) ?? text
        return text
    }

    private static func applyUnitPatterns(_ text: String) -> String {
        var s = text
        for (regex, template) in unitPatterns {
            let r = NSRange(s.startIndex..., in: s)
            s = regex.stringByReplacingMatches(in: s, range: r, withTemplate: template)
        }
        return s
    }

    private static func stripCommaGrouping(_ text: String) -> String {
        guard let regex = commaGrouped else { return text }
        let nsRange = NSRange(text.startIndex..., in: text)
        let matches = regex.matches(in: text, range: nsRange)
        guard !matches.isEmpty else { return text }

        var result = ""
        var lastEnd = text.startIndex
        for match in matches {
            guard let range = Range(match.range, in: text) else { continue }
            result += text[lastEnd..<range.lowerBound]
            result += String(text[range]).replacingOccurrences(of: ",", with: "")
            lastEnd = range.upperBound
        }
        result += text[lastEnd...]
        return result
    }

    private static func spellOutDigits(_ text: String) -> String {
        guard let regex = standaloneNumber else { return text }

        let formatter = NumberFormatter()
        formatter.numberStyle = .spellOut
        formatter.locale = Locale(identifier: "en_US")

        let nsRange = NSRange(text.startIndex..., in: text)
        let matches = regex.matches(in: text, range: nsRange)
        guard !matches.isEmpty else { return text }

        var result = ""
        var lastEnd = text.startIndex
        for match in matches {
            guard let range = Range(match.range, in: text) else { continue }
            result += text[lastEnd..<range.lowerBound]
            let numStr = String(text[range])
            // Use NSDecimalNumber to avoid Double floating-point noise in decimal expansion
            let num = NSDecimalNumber(string: numStr)
            if num != .notANumber, let spelled = formatter.string(from: num) {
                result += spelled
            } else {
                result += numStr
            }
            lastEnd = range.upperBound
        }
        result += text[lastEnd...]
        return result
    }
}
