import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private let speaker = Speaker()
    private var eventMonitor: Any?
    private var menu: NSMenu!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupStatusItem()
        setupHotkey()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "🔊"
        statusItem?.button?.action = #selector(handleClick)
        statusItem?.button?.target = self
        statusItem?.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

        menu = NSMenu()
        let readItem = NSMenuItem(title: "Read Screen", action: #selector(triggerRead), keyEquivalent: "s")
        readItem.keyEquivalentModifierMask = [.control, .option]
        menu.addItem(readItem)
        menu.addItem(withTitle: "Test OCR…", action: #selector(triggerOCRTest), keyEquivalent: "")
        menu.addItem(withTitle: "Stop", action: #selector(stopSpeaking), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Out Loud", action: #selector(NSApp.terminate(_:)), keyEquivalent: "q")
    }

    private func setupHotkey() {
        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 1,
                  event.modifierFlags.intersection([.control, .option]) == [.control, .option]
            else { return }
            DispatchQueue.main.async { self?.triggerRead() }
        }
    }

    @objc private func handleClick() {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseUp {
            statusItem?.menu = menu
            statusItem?.button?.performClick(nil)
            statusItem?.menu = nil
        } else {
            triggerRead()
        }
    }

    @objc private func triggerRead() {
        Task {
            guard let image = await ScreenReader.captureRegion() else { return }
            await MainActor.run { self.setIcon("⏳") }
            guard let text = await ScreenReader.recognizeText(in: image) else {
                await MainActor.run { self.setIcon("🔊") }
                return
            }
            await self.speaker.speak(text)
            await MainActor.run { self.setIcon("🔊") }
        }
    }

    @objc private func triggerOCRTest() {
        Task {
            guard let image = await ScreenReader.captureRegion() else { return }
            let start = Date()
            let text = await ScreenReader.recognizeText(in: image)
            let elapsed = Date().timeIntervalSince(start)
            await MainActor.run {
                let alert = NSAlert()
                alert.messageText = String(format: "OCR result  (%.2f s)", elapsed)
                alert.informativeText = text ?? "(no text recognized)"
                alert.addButton(withTitle: "Speak it")
                alert.addButton(withTitle: "Done")
                if alert.runModal() == .alertFirstButtonReturn, let text {
                    Task { await self.speaker.speak(text) }
                }
            }
        }
    }

    @objc private func stopSpeaking() {
        speaker.stop()
        setIcon("🔊")
    }

    private func setIcon(_ s: String) {
        statusItem?.button?.title = s
    }

    deinit {
        if let m = eventMonitor { NSEvent.removeMonitor(m) }
    }
}
