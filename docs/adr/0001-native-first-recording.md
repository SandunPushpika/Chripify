# ADR 0001: native macOS recording helper for the first slice

Status: accepted for the prototype slice; release and compositor review required.

Alternatives:

1. Rust bindings to ScreenCaptureKit plus AVAssetWriter/FFmpeg: one runtime boundary but more native binding, media queue and distribution complexity for first capture.
2. A small bundled Swift helper using ScreenCaptureKit and SCRecordingOutput: Apple's maintained native API, native encoder and bounded OS capture queue; introduces a process protocol, helper signing and macOS 15 minimum.

Choose 2 for a narrowly scoped video-only vertical slice. Rust remains the application/session/storage owner. A fixed bundle-relative helper path, structured arguments and exclusively owned pipes prevent exposing arbitrary execution. The helper is compiled during development/release preparation, never downloaded or installed at runtime.

The first native recording output cannot satisfy future frame compositing, pause/resume and robust interrupted recording recovery alone. Revisit AVAssetWriter or an approved encoder adapter when those requirements enter scope. Do not advertise them now.

References checked during implementation: [Apple SCRecordingOutput](https://developer.apple.com/documentation/screencapturekit/screcordingoutput), local macOS 15.4 SDK ScreenCaptureKit headers, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
