import AppKit
import Vision

enum ScreenReader {
    /// Launches the native macOS interactive screenshot tool and returns the
    /// captured region as a CGImage. Returns nil if the user cancelled.
    static func captureRegion() async -> CGImage? {
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("outloud-\(UUID().uuidString).png")

        return await Task.detached(priority: .userInitiated) {
            let proc = Process()
            proc.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            proc.arguments = ["-i", "-x", tempURL.path]  // -i interactive, -x no sound

            guard (try? proc.run()) != nil else { return nil }
            proc.waitUntilExit()

            defer { try? FileManager.default.removeItem(at: tempURL) }

            guard proc.terminationStatus == 0,
                  let data = try? Data(contentsOf: tempURL),
                  let nsImage = NSImage(data: data),
                  let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil)
            else { return nil }

            return cgImage
        }.value
    }

    /// Runs Vision OCR on a background thread.
    static func recognizeText(in image: CGImage) async -> String? {
        await Task.detached(priority: .userInitiated) {
            var result: String?
            let req = VNRecognizeTextRequest { req, _ in
                result = (req.results as? [VNRecognizedTextObservation])?
                    .compactMap { $0.topCandidates(1).first?.string }
                    .joined(separator: "\n")
            }
            req.recognitionLevel = .accurate
            try? VNImageRequestHandler(cgImage: image).perform([req])
            return result?.isEmpty == false ? result : nil
        }.value
    }
}
