import Darwin
import Foundation

@main
enum WebsiteBridgeTests {
    @MainActor static func main() throws {
        signal(SIGPIPE, SIG_IGN)
        let prefix = "bodysynth-motion://connect/"
        let a = String(repeating: "a", count: 64)
        let b = String(repeating: "b", count: 64)
        let c = String(repeating: "c", count: 64)
        precondition(WebsiteBridge.nonce(from: URL(string: prefix + a)!) == a)
        for invalid in [prefix + a + "/", prefix + a + "?x", prefix + a + "#",
                        prefix + a.uppercased(), prefix + a.dropLast(), prefix + a + "a",
                        "bodysynth-motion://user@connect/" + a, "bodysynth-motion://connect:82/" + a,
                        "bodysynth-motion://CONNECT/" + a, prefix + "%61" + a.dropLast(),
                        "other://connect/" + a] {
            precondition(WebsiteBridge.nonce(from: URL(string: invalid)!) == nil)
        }

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let script = directory.appendingPathComponent("web.py")
        let events = directory.appendingPathComponent("events")
        // Only event names and PIDs are recorded. The fake child exits between
        // reading a request and sending its ACK to simulate an idle-shutdown race.
        try #"""
        import os, sys
        from pathlib import Path
        assert sys.argv[1:] == ["--website-session"] and sys.flags.isolated and sys.dont_write_bytecode
        def event(label):
            with open("events", "a") as f: print(label, os.getpid(), file=f)
        event("start")
        for line in sys.stdin:
            assert len(line) == 65 and line.endswith("\n")
            if line[0] == "b" and not Path("once").exists():
                Path("once").touch()
                event("raced")
                sys.exit(0)
            print("ACCEPTED", flush=True)
            event("ack")
        """#.write(to: script, atomically: true, encoding: .utf8)
        func records() -> [[Substring]] {
            let log = (try? String(contentsOf: events, encoding: .utf8)) ?? ""
            return log.split(separator: "\n").map { $0.split(separator: " ") }
        }
        func wait(_ condition: () -> Bool) {
            let deadline = Date(timeIntervalSinceNow: 5)
            while !condition() && Date() < deadline {
                RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.02))
            }
            precondition(condition(), "Timed out waiting for the companion.")
        }
        let bridge = WebsiteBridge(script: script, onIdle: {})
        bridge.connect(a)
        wait { records().count == 2 }
        bridge.connect(c)
        wait { records().count == 3 }
        let first = records()
        precondition(first.map { $0[0] } == ["start", "ack", "ack"])
        precondition(first.allSatisfy { $0[1] == first[0][1] })
        bridge.connect(b)
        wait { records().count == 6 }
        let all = records()
        precondition(all.suffix(3).map { $0[0] } == ["raced", "start", "ack"])
        precondition(all[0][1] != all[5][1])
        let pid = Int32(all[5][1])!
        bridge.close()
        wait { kill(pid, 0) == -1 && errno == ESRCH }
        print("Passed URL validation, single-child reuse, idle-exit retry and cleanup.")
    }
}
