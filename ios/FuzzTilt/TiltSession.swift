import Combine
import CoreMotion
import Foundation
import Network

@MainActor
final class TiltSession: ObservableObject {
    @Published private(set) var isRunning = false
    @Published private(set) var rollDegrees: Double?
    @Published private(set) var status = "Ready to start."

    private var connection: NWConnection?
    private var headphones: CMHeadphoneMotionManager?
    private var timer: Timer?
    private var previousAvailability: Bool?
    private var lastTimestamp: TimeInterval?
    private var lastFreshAt: TimeInterval = 0
    private var sending = false

    func start(host: String) {
        guard !isRunning else { return }
        let input = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let address = IPv4Address(input), address != .any, address != .broadcast,
              !address.isLoopback, !address.isMulticast else {
            status = "Enter the Mac’s Wi-Fi IPv4 address from Fuzz."
            return
        }
        let parameters = NWParameters.udp
        parameters.requiredInterfaceType = .wifi
        (parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options)?.hopLimit = 1
        let link = NWConnection(host: .ipv4(address), port: 4242, using: parameters)
        connection = link
        isRunning = true
        status = "Opening the Wi-Fi path to the Mac…"
        link.stateUpdateHandler = { [weak self, weak link] state in
            MainActor.assumeIsolated {
                guard let self, let link, self.connection === link else { return }
                switch state {
                case .ready:
                    self.startReading()
                case .waiting:
                    self.stopReading()
                    self.status = link.currentPath?.unsatisfiedReason == .localNetworkDenied
                        ? "Allow Local Network access for Fuzz Head Tilt in Settings."
                        : "Waiting for Wi-Fi. Join the Mac’s network."
                case .failed(let error):
                    self.finish("Wi-Fi connection failed. \(error.localizedDescription)")
                case .cancelled:
                    self.finish("Stopped.")
                default:
                    break
                }
            }
        }
        link.start(queue: .main)
    }

    func stop() {
        finish("Stopped.")
    }

    private func startReading() {
        guard timer == nil else { return }
        headphones = CMHeadphoneMotionManager()
        status = "Waiting for headphone motion…"
        let timer = Timer(timeInterval: 1 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.readMotion() }
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func readMotion() {
        guard let headphones, let connection else { return }
        let permission = CMHeadphoneMotionManager.authorizationStatus()
        if permission == .denied || permission == .restricted {
            finish("Headphone motion access is blocked. Check Motion & Fitness in Settings.")
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        let available = headphones.isDeviceMotionAvailable
        let needsRestart = available && permission == .authorized &&
            !headphones.isDeviceMotionActive && now - lastFreshAt >= 2
        if available != previousAvailability || needsRestart {
            // The first request can prompt for permission before availability
            // settles. Start a fresh stream when a compatible headset appears.
            if previousAvailability != nil { headphones.stopDeviceMotionUpdates() }
            previousAvailability = available
            lastTimestamp = nil
            lastFreshAt = now
            if available || permission == .notDetermined {
                headphones.startDeviceMotionUpdates()
            }
        }
        guard available else {
            showWaiting("Connect and wear motion-capable AirPods.")
            return
        }
        if permission == .notDetermined {
            showWaiting("Allow Motion & Fitness access to start tracking.")
            return
        }
        guard let sample = headphones.deviceMotion, sample.timestamp != lastTimestamp else {
            if now - lastFreshAt >= 0.5 {
                showWaiting("Waiting for fresh AirPods motion. Check the AirPods connection.")
            }
            return
        }
        // Require two distinct sensor timestamps before sending, so a cached
        // sample alone cannot set the receiver’s neutral after a reconnect.
        let firstSample = lastTimestamp == nil
        lastTimestamp = sample.timestamp
        lastFreshAt = now
        guard !firstSample, !sending else { return }
        let degrees = sample.attitude.roll * (180 / Double.pi)
        guard let packet = TiltPacket.encode(rollDegrees: degrees) else { return }
        rollDegrees = degrees
        if status != "Sending tilt to Fuzz." { status = "Sending tilt to Fuzz." }
        sending = true
        connection.send(content: packet, completion: .contentProcessed { [weak self, weak connection] error in
            MainActor.assumeIsolated {
                guard let self, let connection, self.connection === connection else { return }
                self.sending = false
                if let error { self.finish("Couldn’t send tilt. \(error.localizedDescription)") }
            }
        })
    }

    private func showWaiting(_ message: String) {
        if rollDegrees != nil { rollDegrees = nil }
        if status != message { status = message }
    }

    private func stopReading() {
        timer?.invalidate()
        timer = nil
        headphones?.stopDeviceMotionUpdates()
        headphones = nil
        previousAvailability = nil
        lastTimestamp = nil
        lastFreshAt = 0
        rollDegrees = nil
    }

    private func finish(_ message: String) {
        stopReading()
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        connection = nil
        sending = false
        isRunning = false
        status = message
    }
}
