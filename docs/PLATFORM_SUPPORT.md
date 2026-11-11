# Platform support

The standalone Chrome extension has browser capture source for current desktop Chrome (minimum API version 116) and does not need Rust or native installation. Its strict build and simulated media tests pass on this macOS host. Actual capture, audio availability and webcam performance have not been interactively verified on any OS. See EXTENSION_TESTING.md; the table below concerns the older native desktop track.

| Platform                | Implementation                                           | Actual validation                                                                                                    |
| ----------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| macOS 15+ Apple Silicon | ScreenCaptureKit helper and Tauri/Rust controller source | Helper compiled on macOS 26.6.2 arm64 using Swift 6.1/macOS 15.4 SDK. Capture and full Tauri build are not verified. |
| macOS 15+ Intel         | Same source with x86_64 build target                     | Not built or tested                                                                                                  |
| Windows                 | UI and backend scaffold; no capture adapter              | No build/capture tests performed                                                                                     |
| Linux Wayland           | Planned PipeWire/XDG Portal adapter                      | No implementation/build/capture tests                                                                                |
| Linux X11               | Planned explicit fallback                                | No implementation/build/capture tests                                                                                |

Host discovery: Node 22.13.1, npm 10.9.2, Swift command-line tools 6.1; Rust/Cargo and full Xcode absent. Package registry network DNS unavailable in execution sandbox. No OS packages or privileged tools were installed.

macOS helper requires macOS 15 because SCRecordingOutput was introduced there. Earlier macOS requires a future AVAssetWriter adapter. System audio and microphone are deliberately disabled in this first video-only implementation. Capture size is capped at 1920 on the longest edge; it is not full HiDPI resolution. Only one display is recorded per session.
