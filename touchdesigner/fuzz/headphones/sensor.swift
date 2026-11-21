import AppKit
import CoreMotion
import Foundation

private struct Message: Encodable {
    var status: String?
    var roll: Double?
}

private func emit(_ message: Message) throws {
    var line = try JSONEncoder().encode(message)
    line.append(0x0a)
    try FileHandle.standardOutput.write(contentsOf: line)
}

private final class Sensor {
    let motion = CMHeadphoneMotionManager()
    var previousAvailability: Bool?
    var lastTimestamp: TimeInterval?
    var freshAt: TimeInterval = 0
    var lastStatus: String?

    func show(_ text: String) throws {
        if text != lastStatus {
            try emit(Message(status: text))
            lastStatus = text
        }
    }

    func update() throws -> Bool {
        let permission = CMHeadphoneMotionManager.authorizationStatus()
        if permission == .denied || permission == .restricted {
            try show("Allow motion access for Fuzz Head Motion in System Settings, then restart tracking.")
            return false
        }
        let available = motion.isDeviceMotionAvailable
        let now = ProcessInfo.processInfo.systemUptime
        let retry = available && permission == .authorized && !motion.isDeviceMotionActive && now - freshAt >= 2
        if available != previousAvailability || retry {
            if previousAvailability != nil { motion.stopDeviceMotionUpdates() }
            previousAvailability = available
            lastTimestamp = nil
            freshAt = now
            if available || permission == .notDetermined {
                motion.startDeviceMotionUpdates()
            }
        }
        guard available else {
            try show("Connect and wear motion-capable AirPods on this Mac.")
            return true
        }
        if permission == .notDetermined {
            try show("Allow Fuzz Head Motion to read headphone motion.")
            return true
        }
        guard let sample = motion.deviceMotion, sample.timestamp != lastTimestamp else {
            if lastTimestamp == nil || now - freshAt >= 0.5 {
                try show("Waiting for fresh AirPods motion from this Mac.")
            }
            return true
        }
        // Skip a lone cached pose on reconnect. Fuzz centers on the first live roll.
        let first = lastTimestamp == nil
        lastTimestamp = sample.timestamp
        freshAt = now
        let degrees = sample.attitude.roll * (180 / Double.pi)
        if !first && degrees.isFinite && (-180...180).contains(degrees) {
            try emit(Message(roll: degrees))
            lastStatus = nil
        }
        return true
    }
}

@MainActor private func run() throws -> Int32 {
    let args = Array(CommandLine.arguments.dropFirst())
    guard args.count == 2, ["--session", "--probe"].contains(args[0]),
          let owner = pid_t(args[1]), owner > 1, kill(owner, 0) == 0 else { return 2 }
    // Register with Launch Services as an independent background application.
    // The app has no windows, Dock icon, or menu bar item.
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    app.finishLaunching()
    if args[0] == "--probe" {
        let state = CMHeadphoneMotionManager.authorizationStatus()
        let names: [CMAuthorizationStatus: String] = [.authorized: "authorized", .denied: "denied",
                                                     .restricted: "restricted", .notDetermined: "not determined"]
        try emit(Message(status: "Motion authorization: \(names[state] ?? "unknown")."))
        return 0
    }
    let sensor = Sensor()
    defer { sensor.motion.stopDeviceMotionUpdates() }
    while kill(owner, 0) == 0 {
        guard try autoreleasepool(invoking: sensor.update) else { return 1 }
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 1 / 30))
    }
    return 0
}

do { exit(try MainActor.assumeIsolated { try run() }) } catch { exit(1) }
