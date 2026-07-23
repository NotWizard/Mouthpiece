@preconcurrency import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

struct AudioInputDevice: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let isDefault: Bool
}

enum AudioCaptureError: LocalizedError {
    case permissionDenied
    case unavailableInput
    case selectedInputUnavailable
    case noAudioFrames
    case converterCreationFailed
    case converterFailed(String)

    var errorDescription: String? {
        switch self {
        case .permissionDenied: "Microphone permission is required."
        case .unavailableInput: "No microphone input is available."
        case .selectedInputUnavailable: "The selected microphone is unavailable. Choose another input device."
        case .noAudioFrames: "The microphone did not provide any audio. Check the selected input device."
        case .converterCreationFailed: "Unable to create the microphone audio converter."
        case .converterFailed(let message): "Audio conversion failed: \(message)"
        }
    }
}

@MainActor
final class AudioCaptureService {
    nonisolated static let outputSampleRate = 16_000

    nonisolated static func normalizedLevel(rms: Double, previous: Float) -> Float {
        let decibels = 20 * log10(max(rms, 0.000_001))
        let target = Float(min(max((decibels + 55) / 43, 0), 1))
        let alpha: Float = target > previous ? 0.55 : 0.18
        return previous + (target - previous) * alpha
    }

    private let engine = AVAudioEngine()
    private var converterBox: AudioConverterBox?
    private var tapInstalled = false
    private var isStarting = false
    private(set) var isRunning = false

    func requestPermission() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }

    func start(
        selectedDeviceUID: String?,
        onFrame: @escaping @Sendable (Data) -> Void,
        onLevel: @escaping @Sendable (Float) -> Void
    ) async throws {
        guard !isRunning, !isStarting else { return }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            throw AudioCaptureError.permissionDenied
        }
        isStarting = true
        defer { isStarting = false }
        // All engine access happens on engineQueue so it serializes with the
        // removeTap/stop block from resetEngine; touching inputNode here on the
        // main actor raced a still-running teardown and could double-install
        // the tap. A wedged HAL (e.g. after sleep/wake) can also block
        // engine.start for minutes; off the main thread the UI stays
        // responsive and the preparing watchdog fails the attempt instead.
        converterBox = try await Self.startEngineSession(
            EngineBox(engine: engine),
            selectedDeviceUID: selectedDeviceUID,
            onFrame: onFrame,
            onLevel: onLevel
        )
        tapInstalled = true
        isRunning = true
    }

    private struct EngineBox: @unchecked Sendable {
        let engine: AVAudioEngine
    }

    private static let engineQueue = DispatchQueue(label: "com.mouthpiece.audio-engine", qos: .userInitiated)

    private static func startEngineSession(
        _ box: EngineBox,
        selectedDeviceUID: String?,
        onFrame: @escaping @Sendable (Data) -> Void,
        onLevel: @escaping @Sendable (Float) -> Void
    ) async throws -> AudioConverterBox {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<AudioConverterBox, Error>) in
            engineQueue.async {
                do {
                    let input = box.engine.inputNode
                    if let selectedDeviceUID, !selectedDeviceUID.isEmpty {
                        do {
                            try selectInputDevice(uid: selectedDeviceUID, on: input)
                        } catch {
                            throw AudioCaptureError.selectedInputUnavailable
                        }
                    }
                    let inputFormat = input.outputFormat(forBus: 0)
                    guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
                        throw AudioCaptureError.unavailableInput
                    }
                    let converter = try AudioConverterBox(
                        inputFormat: inputFormat,
                        onFrame: onFrame,
                        onLevel: onLevel
                    )
                    input.installTap(
                        onBus: 0,
                        bufferSize: 960,
                        format: inputFormat,
                        block: makeTapHandler(for: converter)
                    )
                    box.engine.prepare()
                    do {
                        try box.engine.start()
                    } catch {
                        input.removeTap(onBus: 0)
                        box.engine.stop()
                        throw error
                    }
                    continuation.resume(returning: converter)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    // CoreAudio invokes taps on its realtime queue, outside MainActor isolation.
    nonisolated private static func makeTapHandler(for box: AudioConverterBox) -> AVAudioNodeTapBlock {
        { buffer, _ in box.process(buffer) }
    }

    func stop() async {
        guard isRunning || tapInstalled || converterBox != nil else { return }
        resetEngine()
        await converterBox?.finish()
        converterBox = nil
    }

    func availableInputDevices() -> [AudioInputDevice] {
        Self.inputDevices()
    }

    private static func selectInputDevice(uid: String, on inputNode: AVAudioInputNode) throws {
        guard let device = inputDevicesWithIDs().first(where: { $0.uid == uid }),
              let audioUnit = inputNode.audioUnit else {
            throw AudioCaptureError.unavailableInput
        }
        var deviceID = device.id
        let status = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &deviceID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )
        guard status == noErr else { throw AudioCaptureError.unavailableInput }
    }

    private func resetEngine() {
        let wasTapped = tapInstalled
        tapInstalled = false
        isRunning = false
        let box = EngineBox(engine: engine)
        Self.engineQueue.async {
            if wasTapped { box.engine.inputNode.removeTap(onBus: 0) }
            box.engine.stop()
        }
    }

    private static func inputDevices() -> [AudioInputDevice] {
        let devices = inputDevicesWithIDs()
        let defaultID = defaultInputDeviceID()
        return devices.map {
            AudioInputDevice(id: $0.uid, name: $0.name, isDefault: $0.id == defaultID)
        }.sorted {
            if $0.isDefault != $1.isDefault { return $0.isDefault }
            return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    private static func inputDevicesWithIDs() -> [(id: AudioDeviceID, uid: String, name: String)] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size
        ) == noErr else { return [] }
        var ids = [AudioDeviceID](
            repeating: 0,
            count: Int(size) / MemoryLayout<AudioDeviceID>.size
        )
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size,
            &ids
        ) == noErr else { return [] }
        return ids.compactMap { id in
            guard hasInputStreams(deviceID: id),
                  let uid = stringProperty(id, selector: kAudioDevicePropertyDeviceUID),
                  let name = stringProperty(id, selector: kAudioObjectPropertyName) else {
                return nil
            }
            return (id, uid, name)
        }
    }

    private static func hasInputStreams(deviceID: AudioDeviceID) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: kAudioDevicePropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        return AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size) == noErr && size > 0
    }

    private static func stringProperty(_ id: AudioObjectID, selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr else {
            return nil
        }
        return value?.takeUnretainedValue() as String?
    }

    private static func defaultInputDeviceID() -> AudioDeviceID {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        _ = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size,
            &id
        )
        return id
    }
}

private final class AudioConverterBox: @unchecked Sendable {
    private static let frameBytes = AudioCaptureService.outputSampleRate * 2 / 50
    private let converter: AVAudioConverter
    private let outputFormat: AVAudioFormat
    private let onFrame: @Sendable (Data) -> Void
    private let onLevel: @Sendable (Float) -> Void
    private let queue = DispatchQueue(label: "com.mouthpiece.audio-conversion", qos: .userInitiated)
    private let lock = NSLock()
    private var queuedBuffers: [AVAudioPCMBuffer] = []
    private var availableBuffers: [AVAudioPCMBuffer] = []
    private var drainScheduled = false
    private var accepting = true
    private var pendingPCM = Data()
    private var smoothedLevel: Float = 0

    init(
        inputFormat: AVAudioFormat,
        onFrame: @escaping @Sendable (Data) -> Void,
        onLevel: @escaping @Sendable (Float) -> Void
    ) throws {
        guard let outputFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: Double(AudioCaptureService.outputSampleRate),
            channels: 1,
            interleaved: true
        ), let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else {
            throw AudioCaptureError.converterCreationFailed
        }
        self.outputFormat = outputFormat
        self.converter = converter
        self.onFrame = onFrame
        self.onLevel = onLevel
        let capacity = AVAudioFrameCount(max(4_096, Int(inputFormat.sampleRate / 10)))
        availableBuffers = (0..<10).compactMap { _ in
            AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: capacity)
        }
    }

    func process(_ input: AVAudioPCMBuffer) {
        lock.lock()
        guard accepting, let reusable = availableBuffers.popLast() else {
            lock.unlock()
            return
        }
        lock.unlock()
        guard Self.copy(input, into: reusable) else {
            lock.withLock { availableBuffers.append(reusable) }
            return
        }
        lock.lock()
        guard accepting else {
            availableBuffers.append(reusable)
            lock.unlock()
            return
        }
        queuedBuffers.append(reusable)
        let shouldSchedule = !drainScheduled
        drainScheduled = true
        lock.unlock()
        if shouldSchedule {
            queue.async { [weak self] in self?.drain() }
        }
    }

    func finish() async {
        lock.withLock { accepting = false }
        await withCheckedContinuation { continuation in
            queue.async { [weak self] in
                self?.drain()
                self?.emitRemainder()
                continuation.resume()
            }
        }
    }

    private func drain() {
        while true {
            lock.lock()
            guard !queuedBuffers.isEmpty else {
                drainScheduled = false
                lock.unlock()
                return
            }
            let input = queuedBuffers.removeFirst()
            lock.unlock()
            convert(input)
            lock.withLock { availableBuffers.append(input) }
        }
    }

    private func convert(_ input: AVAudioPCMBuffer) {
        let ratio = outputFormat.sampleRate / input.format.sampleRate
        let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * ratio)) + 32
        guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
            return
        }
        let source = ConverterInputSource(buffer: input)
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
            guard let input = source.take() else {
                inputStatus.pointee = .noDataNow
                return nil
            }
            inputStatus.pointee = .haveData
            return input
        }
        guard status != .error, output.frameLength > 0,
              let pointer = output.audioBufferList.pointee.mBuffers.mData else { return }
        pendingPCM.append(Data(bytes: pointer, count: Int(output.frameLength) * MemoryLayout<Int16>.size))
        while pendingPCM.count >= Self.frameBytes {
            emit(Data(pendingPCM.prefix(Self.frameBytes)))
            pendingPCM.removeFirst(Self.frameBytes)
        }
    }

    private func emitRemainder() {
        guard !pendingPCM.isEmpty else { return }
        emit(pendingPCM)
        pendingPCM.removeAll(keepingCapacity: true)
    }

    private func emit(_ data: Data) {
        onFrame(data)
        var sum = 0.0
        var count = 0
        data.withUnsafeBytes { bytes in
            for offset in stride(from: 0, to: bytes.count - 1, by: 2) {
                let sample = Int16(bitPattern: UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8)
                let normalized = Double(sample) / 32_768
                sum += normalized * normalized
                count += 1
            }
        }
        let rms = count == 0 ? 0 : sqrt(sum / Double(count))
        smoothedLevel = AudioCaptureService.normalizedLevel(rms: rms, previous: smoothedLevel)
        onLevel(smoothedLevel)
    }

    private static func copy(_ input: AVAudioPCMBuffer, into copy: AVAudioPCMBuffer) -> Bool {
        guard input.frameLength <= copy.frameCapacity else { return false }
        copy.frameLength = input.frameLength
        let source = UnsafeMutableAudioBufferListPointer(input.mutableAudioBufferList)
        let destination = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        guard source.count == destination.count else { return false }
        for index in source.indices {
            guard let sourceData = source[index].mData,
                  let destinationData = destination[index].mData else { return false }
            let byteCount = min(Int(source[index].mDataByteSize), Int(destination[index].mDataByteSize))
            memcpy(destinationData, sourceData, byteCount)
            destination[index].mDataByteSize = UInt32(byteCount)
        }
        return true
    }
}

private final class ConverterInputSource: @unchecked Sendable {
    private let lock = NSLock()
    private var buffer: AVAudioPCMBuffer?

    init(buffer: AVAudioPCMBuffer) {
        self.buffer = buffer
    }

    func take() -> AVAudioPCMBuffer? {
        lock.lock()
        defer { lock.unlock() }
        defer { buffer = nil }
        return buffer
    }
}

enum WAVEncoder {
    static func pcm16Mono(_ pcm: Data, sampleRate: Int = 16_000) -> Data {
        var output = Data()
        output.appendASCII("RIFF")
        output.appendUInt32LE(UInt32(36 + pcm.count))
        output.appendASCII("WAVEfmt ")
        output.appendUInt32LE(16)
        output.appendUInt16LE(1)
        output.appendUInt16LE(1)
        output.appendUInt32LE(UInt32(sampleRate))
        output.appendUInt32LE(UInt32(sampleRate * 2))
        output.appendUInt16LE(2)
        output.appendUInt16LE(16)
        output.appendASCII("data")
        output.appendUInt32LE(UInt32(pcm.count))
        output.append(pcm)
        return output
    }
}

private extension Data {
    mutating func appendASCII(_ value: String) {
        append(contentsOf: value.utf8)
    }

    mutating func appendUInt16LE(_ value: UInt16) {
        var littleEndian = value.littleEndian
        Swift.withUnsafeBytes(of: &littleEndian) { append(contentsOf: $0) }
    }

    mutating func appendUInt32LE(_ value: UInt32) {
        var littleEndian = value.littleEndian
        Swift.withUnsafeBytes(of: &littleEndian) { append(contentsOf: $0) }
    }
}
