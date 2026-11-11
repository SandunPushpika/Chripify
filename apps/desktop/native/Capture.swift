import AVFoundation
import CoreGraphics
import Foundation
import ScreenCaptureKit

// Stdout is a bounded, line-delimited control protocol. Never emit media or window titles.
func emit(_ value: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
  FileHandle.standardOutput.write(data + Data([10]))
}

enum CaptureError: Error { case invalidArguments, missingDisplay, permissionDenied, outputExists }

@available(macOS 15.0, *)
final class Recorder: NSObject, SCRecordingOutputDelegate, SCStreamDelegate, @unchecked Sendable {
  private var stream: SCStream?
  private var stopping = false

  @MainActor
  func start(displayID: UInt32, output: URL, fps: Int) async throws {
    guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
      throw CaptureError.permissionDenied
    }
    guard !FileManager.default.fileExists(atPath: output.path) else {
      throw CaptureError.outputExists
    }
    let content = try await SCShareableContent.excludingDesktopWindows(
      false, onScreenWindowsOnly: true)
    guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
      throw CaptureError.missingDisplay
    }
    let configuration = SCStreamConfiguration()
    // Bound capture memory and encoder load; preserve aspect ratio at up to 1920 physical pixels.
    let physicalWidth = CGDisplayPixelsWide(displayID)
    let physicalHeight = CGDisplayPixelsHigh(displayID)
    let scale = min(1.0, 1920.0 / Double(max(physicalWidth, physicalHeight)))
    configuration.width = max(2, Int(Double(physicalWidth) * scale) / 2 * 2)
    configuration.height = max(2, Int(Double(physicalHeight) * scale) / 2 * 2)
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: Int32(fps))
    configuration.queueDepth = 3
    configuration.showsCursor = true
    configuration.capturesAudio = false
    configuration.captureMicrophone = false
    let recording = SCRecordingOutputConfiguration()
    recording.outputURL = output
    recording.videoCodecType = .h264
    recording.outputFileType = .mp4
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let session = SCStream(filter: filter, configuration: configuration, delegate: self)
    try session.addRecordingOutput(SCRecordingOutput(configuration: recording, delegate: self))
    stream = session
    try await session.startCapture()
  }

  @MainActor
  func stop() async {
    guard !stopping else { return }
    stopping = true
    do { try await stream?.stopCapture() } catch {
      emit(["event": "failed", "code": "stop_failed"])
      exit(1)
    }
    // Success is acknowledged only by recordingOutputDidFinishRecording.
  }

  func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    emit(["event": "recording"])
  }

  func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    emit(["event": "finished"])
    exit(0)
  }

  func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
    emit(["event": "failed", "code": "encoder_failed"])
    exit(1)
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    emit(["event": "failed", "code": "capture_interrupted"])
    exit(1)
  }
}

@main
struct CaptureMain {
  @MainActor
  static func main() async {
    guard #available(macOS 15.0, *) else {
      emit(["event": "failed", "code": "unsupported_platform"])
      exit(1)
    }
    do {
      let args = CommandLine.arguments
      if args.count == 2 && args[1] == "--list" {
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
          throw CaptureError.permissionDenied
        }
        let content = try await SCShareableContent.excludingDesktopWindows(
          false, onScreenWindowsOnly: true)
        emit([
          "event": "sources",
          "sources": content.displays.map {
            [
              "id": $0.displayID, "width": CGDisplayPixelsWide($0.displayID),
              "height": CGDisplayPixelsHigh($0.displayID),
            ]
          },
        ])
        return
      }
      guard args.count == 4, let id = UInt32(args[1]), let fps = Int(args[3]),
        [15, 30, 60].contains(fps), args[2].hasPrefix("/")
      else {
        throw CaptureError.invalidArguments
      }
      let recorder = Recorder()
      try await recorder.start(displayID: id, output: URL(fileURLWithPath: args[2]), fps: fps)
      // EOF means the owning desktop process disappeared. Release capture and finalize.
      DispatchQueue.global(qos: .utility).async {
        while let command = readLine() {
          if command == "stop" { break }
          // Ignore unknown control tokens; stdin is exclusively owned by Rust.
        }
        Task { @MainActor in await recorder.stop() }
      }
      // Keep the recorder alive while MainActor services framework callbacks.
      while true { try await Task.sleep(nanoseconds: 1_000_000_000) }
    } catch CaptureError.permissionDenied {
      emit(["event": "failed", "code": "permission_denied"])
      exit(1)
    } catch {
      emit(["event": "failed", "code": "capture_unavailable"])
      exit(1)
    }
  }
}
