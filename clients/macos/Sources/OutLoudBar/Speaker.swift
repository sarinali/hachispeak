import AVFoundation
import Foundation

final class Speaker {
    private var player: AVAudioPlayer?

    func speak(_ text: String) async {
        await MainActor.run { stop() }
        guard let data = await fetchAudio(for: text) else { return }
        await MainActor.run {
            guard let p = try? AVAudioPlayer(data: data) else { return }
            self.player = p
            p.play()
        }
    }

    func stop() {
        player?.stop()
        player = nil
    }

    private func fetchAudio(for text: String) async -> Data? {
        guard let url = URL(string: "http://127.0.0.1:51730/api/v1/audio/speech") else { return nil }
        let body: [String: Any] = ["input": text, "voice": "af_heart", "speed": 1.0]
        guard let bodyData = try? JSONSerialization.data(withJSONObject: body) else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = bodyData

        return try? await URLSession.shared.data(for: request).0
    }
}
