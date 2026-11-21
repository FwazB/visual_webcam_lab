import AppKit

@MainActor
final class MotionApp: NSObject, NSApplicationDelegate {
    private var bridge: WebsiteBridge?
    private var idleTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if bridge?.running != true { quitWhenIdle() }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard let resources = Bundle.main.resourceURL else { return }
        if bridge == nil {
            bridge = WebsiteBridge(script: resources.appendingPathComponent("scripts/head-motion.py")) {
                [weak self] in self?.quitWhenIdle()
            }
        }
        for url in urls {
            guard let nonce = WebsiteBridge.nonce(from: url) else { continue }
            idleTimer?.invalidate()
            bridge?.connect(nonce)
        }
        if bridge?.running != true { quitWhenIdle() }
    }

    private func quitWhenIdle() {
        idleTimer?.invalidate()
        idleTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { _ in
            MainActor.assumeIsolated { NSApp.terminate(nil) }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        bridge?.close()
    }
}

@main
enum Launcher {
    @MainActor static func main() {
        signal(SIGPIPE, SIG_IGN)
        let application = NSApplication.shared
        let delegate = MotionApp()
        application.setActivationPolicy(.accessory)
        application.delegate = delegate
        withExtendedLifetime(delegate) { application.run() }
    }
}
