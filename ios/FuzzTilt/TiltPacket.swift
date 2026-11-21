import Foundation

enum TiltPacket {
    /// Fuzz reads the sixth little-endian Float64 as roll, in degrees.
    static func encode(rollDegrees: Double) -> Data? {
        guard rollDegrees.isFinite, (-180...180).contains(rollDegrees) else { return nil }
        var packet = Data(repeating: 0, count: 5 * MemoryLayout<UInt64>.size)
        withUnsafeBytes(of: rollDegrees.bitPattern.littleEndian) {
            packet.append(contentsOf: $0)
        }
        return packet
    }
}
