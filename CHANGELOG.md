# Changelog

## 0.3.3 — recording countdown

- Show a cancellable 3–2–1 countdown after capture setup and browser restoration, before starting the encoder or elapsed recording clock. Both Studio and toolbar starts use the same lifecycle.
- Display large countdown numbers in the browser overlay and countdown status in Studio/popup. Existing Cancel controls release capture immediately.
- Add regression checks for countdown order, delayed encoding, excluded countdown duration and cancellation cleanup. No permissions or library schema changes.

## 0.3.2 — background capture and bounded startup

- Move camera composition/effects to a dedicated native-frame worker with bounded streams and explicit frame cleanup. Screen-only capture retains the native screen track. Encoded video no longer depends on hidden-page video playback or presentation callbacks.
- Foreground the recorder for permission setup, then restore the launching browser tab before encoding starts. Report preparation stages and allow cancellation with deadlines and cleanup of late device streams.
- Report actual recorder state during toolbar startup; retain actionable startup errors. No new permissions, remote processing or library schema changes.
- Added 20 regression tests for frame flow/backpressure, resource ownership, worker failures, startup handoff, cancellation and deadlines. Interactive Chrome tab-switch/export acceptance remains pending.

## 0.3.1 — toolbar recording startup fix

- Bind the service-worker desktop picker to the actual consuming recorder tab, including its verified extension URL, instead of omitting Chrome's required target-tab argument.
- Stop hidden-owner initialization waiting for camera/microphone enumeration. Device menus and quota display refresh separately from the ready handshake; saved device choices are preserved.
- Report native picker errors distinctly from cancellation and handle synchronous failure/callbacks, chooser timeout and late responses without leaking a timer.
- Added eight regression tests for the Chrome picker contract and hidden-tab enumeration. Existing recordings and permissions are unchanged.

## 0.3.0 — popup, browser overlays and camera backgrounds

- Toolbar clicks open a compact popup with Start, Pause/Resume, Stop and Open main app.
- Added Chrome's source-picker handoff to the persistent recorder, retaining capture when the popup closes.
- Added a draggable isolated browser overlay with camera preview, timer and pause/resume/stop controls; temporary page access and optional website-follow permission are validated separately.
- Added browser-native blur with capability checks and visible fallback, plus local green-screen blur/color/image replacement. Effects are shared by recording, browser thumbnail and picture-in-picture.
- Added saved camera preferences, bounded local image processing, popup/control permission tests, and compatibility validation for classic content scripts. No user recordings or IndexedDB schema were changed.

## 0.2.0 — standalone Chrome extension

- Added an independent Manifest V3 recorder studio and local library.
- Added browser-mediated screen/window/tab capture, microphone/shared audio, webcam composition, pause/resume, local WebM playback and explicit downloads.
- Added IndexedDB chunks, bounded writes, interruption retention, device cleanup and a single-owner browser lock.
- Added local build/ZIP packaging, a narrow manifest and simulated workflow tests. Real Chrome capture and production acceptance remain unverified.

## 0.1.0 — development foundation

- Documented architecture, threat model, milestones and platform limitations.
- Added strict React/TypeScript recorder studio, metadata library and local theme setting.
- Added restricted Tauri IPC, Rust session owner, SQLite metadata and private session storage source.
- Added macOS ScreenCaptureKit video-only helper and local build script.
- Added lifecycle/validation tests and CI configuration. Native integration and interactive recording acceptance remain pending.
