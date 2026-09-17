// Local person mask: stdin [UInt32LE width, height, BGRA8 pixels],
// stdout [UInt32LE width, height, gray8 mask]. Rows are top-down in both.
import Foundation
import Vision
import CoreVideo
import ImageIO

private enum MaskError: Error {
    case invalidArguments, invalidDimensions, truncatedFrame, allocation, segmentation
}

private let input = FileHandle.standardInput
private let output = FileHandle.standardOutput

// An empty read is valid only between frames; partial frames are rejected.
private func readExactly(_ count: Int, allowEOF: Bool = false) throws -> Data? {
    var data = Data()
    data.reserveCapacity(count)
    while data.count < count {
        guard let chunk = try input.read(upToCount: count - data.count), !chunk.isEmpty else {
            if data.isEmpty && allowEOF { return nil }
            throw MaskError.truncatedFrame
        }
        data.append(chunk)
    }
    return data
}

private func uint32LE(_ bytes: Data, _ offset: Int) -> UInt32 {
    (0..<4).reduce(UInt32(0)) { $0 | (UInt32(bytes[offset + $1]) << (8 * $1)) }
}

private func appendUInt32LE(_ value: Int, to data: inout Data) {
    let value = UInt32(value)
    for shift in stride(from: 0, to: 32, by: 8) {
        data.append(UInt8(truncatingIfNeeded: value >> shift))
    }
}

private func processFrame(
    _ header: Data,
    request: VNGeneratePersonSegmentationRequest,
    handler: VNSequenceRequestHandler
) throws {
    let width = Int(uint32LE(header, 0))
    let height = Int(uint32LE(header, 4))
    guard width > 0, height > 0, width <= 512, height <= 512,
          width * height <= 262_144 else { throw MaskError.invalidDimensions }
    guard let pixels = try readExactly(width * height * 4) else {
        throw MaskError.truncatedFrame
    }

    var buffer: CVPixelBuffer?
    guard CVPixelBufferCreate(
        kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
        nil, &buffer
    ) == kCVReturnSuccess, let buffer else { throw MaskError.allocation }
    guard CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess else {
        throw MaskError.allocation
    }
    do {
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let address = CVPixelBufferGetBaseAddress(buffer) else {
            throw MaskError.allocation
        }
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        pixels.withUnsafeBytes { bytes in
            for row in 0..<height {
                address.advanced(by: row * stride).copyMemory(
                    from: bytes.baseAddress!.advanced(by: row * width * 4),
                    byteCount: width * 4
                )
            }
        }
    }

    try handler.perform([request], on: buffer, orientation: .up)
    guard let mask = request.results?.first?.pixelBuffer else {
        throw MaskError.segmentation
    }
    let bytes = try resizedMask(mask, width: width, height: height)
    var response = Data()
    response.reserveCapacity(8 + bytes.count)
    appendUInt32LE(width, to: &response)
    appendUInt32LE(height, to: &response)
    response.append(bytes)
    try output.write(contentsOf: response)
}

private func resizedMask(_ mask: CVPixelBuffer, width: Int, height: Int) throws -> Data {
    let maskWidth = CVPixelBufferGetWidth(mask)
    let maskHeight = CVPixelBufferGetHeight(mask)
    guard maskWidth > 0, maskHeight > 0,
          CVPixelBufferGetPixelFormatType(mask) == kCVPixelFormatType_OneComponent8,
          CVPixelBufferLockBaseAddress(mask, .readOnly) == kCVReturnSuccess else {
        throw MaskError.segmentation
    }
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
    guard let address = CVPixelBufferGetBaseAddress(mask) else {
        throw MaskError.segmentation
    }

    // Vision chooses its own mask resolution; return the exact input size.
    // Read rows directly so no color-space conversion changes mask coverage.
    let source = address.assumingMemoryBound(to: UInt8.self)
    let maskStride = CVPixelBufferGetBytesPerRow(mask)
    var bytes = Data(count: width * height)
    bytes.withUnsafeMutableBytes { destination in
        let destination = destination.baseAddress!.assumingMemoryBound(to: UInt8.self)
        for y in 0..<height {
            let sy = max(0, min(Double(maskHeight - 1),
                (Double(y) + 0.5) * Double(maskHeight) / Double(height) - 0.5))
            let y0 = Int(sy), y1 = min(y0 + 1, maskHeight - 1)
            let fy = sy - Double(y0)
            for x in 0..<width {
                let sx = max(0, min(Double(maskWidth - 1),
                    (Double(x) + 0.5) * Double(maskWidth) / Double(width) - 0.5))
                let x0 = Int(sx), x1 = min(x0 + 1, maskWidth - 1)
                let fx = sx - Double(x0)
                let top = Double(source[y0 * maskStride + x0]) * (1 - fx)
                    + Double(source[y0 * maskStride + x1]) * fx
                let bottom = Double(source[y1 * maskStride + x0]) * (1 - fx)
                    + Double(source[y1 * maskStride + x1]) * fx
                destination[y * width + x] = UInt8(clamping: Int((top * (1 - fy) + bottom * fy).rounded()))
            }
        }
    }
    return bytes
}

private func run() throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard arguments.isEmpty || arguments == ["--fast"] || arguments == ["--balanced"] else {
        throw MaskError.invalidArguments
    }
    let request = VNGeneratePersonSegmentationRequest()
    request.revision = VNGeneratePersonSegmentationRequestRevision1
    request.qualityLevel = arguments == ["--fast"] ? .fast : .balanced
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8
    let handler = VNSequenceRequestHandler()
    while let header = try readExactly(8, allowEOF: true) {
        try autoreleasepool {
            try processFrame(header, request: request, handler: handler)
        }
    }
}

do {
    try run()
} catch {
    // No frame contents, device information or private paths in diagnostics.
    let message: String
    switch error {
    case MaskError.invalidArguments: message = "person-mask: use --fast or --balanced\n"
    case MaskError.invalidDimensions: message = "person-mask: invalid frame dimensions\n"
    case MaskError.truncatedFrame: message = "person-mask: incomplete frame\n"
    default: message = "person-mask: processing failed\n"
    }
    try? FileHandle.standardError.write(contentsOf: Data(message.utf8))
    exit(1)
}
