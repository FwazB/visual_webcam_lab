import Darwin
import Foundation

/// All child and pipe state is serialized on the main run loop, including URL delivery.
@MainActor
final class WebsiteBridge {
    private struct Request {
        let nonce: String
        let created: TimeInterval
        var retry: Bool = true
    }

    private let script: URL
    private let onIdle: () -> Void
    private var child: Process?
    private var writer: FileHandle?
    private var reader: FileHandle?
    private var replies: DispatchSourceRead?
    private var pending: [Request] = []
    private var response = Data()
    var running: Bool { child != nil }

    init(script: URL, onIdle: @escaping () -> Void) {
        self.script = script
        self.onIdle = onIdle
    }

    static func nonce(from url: URL) -> String? {
        let prefix = "bodysynth-motion://connect/"
        let raw = url.absoluteString
        guard raw.hasPrefix(prefix) else { return nil }
        let value = raw.dropFirst(prefix.count)
        guard value.utf8.count == 64, value.utf8.allSatisfy({
            (48...57).contains($0) || (97...102).contains($0)
        }) else { return nil }
        return String(value)
    }

    func connect(_ nonce: String) {
        send(Request(nonce: nonce, created: ProcessInfo.processInfo.systemUptime))
    }

    private func send(_ request: Request) {
        guard pending.count < 16, !pending.contains(where: { $0.nonce == request.nonce }) else { return }
        if child == nil && !launch() { return }
        guard let writer else { return }
        let line = Array((request.nonce + "\n").utf8)
        // A single nonblocking write smaller than PIPE_BUF is atomic. If the old
        // child just closed stdin, childExited retries only its unacknowledged opens.
        let count = line.withUnsafeBytes { Darwin.write(writer.fileDescriptor, $0.baseAddress, $0.count) }
        if count == line.count || (count == -1 && errno == EPIPE) {
            pending.append(request)
        }
    }

    private func launch() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = ["-I", "-B", script.path, "--website-session"]
        process.currentDirectoryURL = script.deletingLastPathComponent()
        let input = Pipe()
        let output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        let readEnd = output.fileHandleForReading
        let writeEnd = input.fileHandleForWriting
        guard fcntl(readEnd.fileDescriptor, F_SETFL, O_NONBLOCK) != -1,
              fcntl(writeEnd.fileDescriptor, F_SETFL, O_NONBLOCK) != -1 else { return false }
        process.terminationHandler = { [weak self] ended in
            DispatchQueue.main.async { self?.childExited(ended) }
        }
        do { try process.run() } catch { return false }
        try? input.fileHandleForReading.close()
        try? output.fileHandleForWriting.close()
        let source = DispatchSource.makeReadSource(fileDescriptor: readEnd.fileDescriptor, queue: .main)
        source.setEventHandler { [weak self] in
            guard let self, self.child === process else { return }
            self.readAcknowledgements()
        }
        child = process
        writer = writeEnd
        reader = readEnd
        replies = source
        source.resume()
        return true
    }

    private func readAcknowledgements() {
        guard let reader else { return }
        var bytes = [UInt8](repeating: 0, count: 256)
        while true {
            let count = Darwin.read(reader.fileDescriptor, &bytes, bytes.count)
            if count <= 0 {
                if count == 0 { replies?.cancel() }
                break
            }
            response.append(contentsOf: bytes.prefix(count))
            while let newline = response.firstIndex(of: 10) {
                let reply = response[..<newline]
                if (reply.elementsEqual("ACCEPTED".utf8) || reply.elementsEqual("REJECTED".utf8)),
                   !pending.isEmpty {
                    pending.removeFirst()
                }
                response.removeSubrange(...newline)
            }
            if response.count > 256 { response.removeAll() }
        }
    }

    private func childExited(_ ended: Process) {
        guard child === ended else { return }
        readAcknowledgements()
        let now = ProcessInfo.processInfo.systemUptime
        let retry = ended.terminationStatus == 0 ? pending.filter { $0.retry && now - $0.created < 5 } : []
        reset()
        for var request in retry {
            request.retry = false
            send(request)
        }
        if child == nil { onIdle() }
    }

    private func reset() {
        replies?.cancel()
        replies = nil
        try? writer?.close()
        try? reader?.close()
        writer = nil
        reader = nil
        pending.removeAll()
        response.removeAll()
        child = nil
    }

    func close() {
        let process = child
        reset()
        if process?.isRunning == true { process?.terminate() }
    }
}
