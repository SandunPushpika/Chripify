# Implementation plan

## Current priority: standalone Chrome extension

The user clarified that the primary app must run independently as an installable Chrome extension. ADR 0003 supersedes the original desktop-first rollout below. Browser recording no longer depends on the native toolchain or Native Messaging.

Source includes screen/window/tab capture, microphone/shared audio, webcam composition, pause/resume, local playback/library, rename, download and confirmed deletion. See EXTENSION_TESTING.md for build/simulation evidence and required interactive acceptance. AI effects, native-equivalent overlays and production validation remain incomplete.

## Current extension follow-up slice

Version 0.3 adds the requested toolbar popup, browser-only camera/control overlay and camera background choices. Acceptance requires a popup Start that closes safely while recording continues, retained main app/library access, pause/resume/stop from authorized websites, explicit optional website-follow consent, consistent local camera effects and unchanged recording storage. See ADR 0004 and EXTENSION_TESTING.md. Automatic AI segmentation is deferred because no approved model/runtime is available locally and package/model downloads are blocked.

## Original desktop scope and acceptance

Build one local macOS video-only display recording slice before expanding the media pipeline. The repository was empty on discovery. No installations with elevated privileges, cloud services, accounts, telemetry, or recording of the developer's screen are part of automated setup.

Boundaries: React presents controls; typed IPC crosses the WebView trust boundary; a Rust actor owns session state and child lifetime; a bundled Swift helper owns ScreenCaptureKit; Rust owns filesystem and SQLite. The extension has no authority until the later pairing design is implemented.

Primary risks: missing Rust/Xcode, native permission identity, native framework callbacks, incomplete MP4 after interruption, filesystem races, hardware-dependent capture performance, and signed helper distribution. These prevent a source scaffold from being considered a production release.

## Milestones

| Phase            | Acceptance criteria                                                                                                          | Current status                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 0: discovery     | Environment inventory, architectural alternatives, threat model, test strategy                                               | Documented                                                                                                         |
| 1: foundation    | React/strict TS/Vite/Tailwind, Tauri capabilities, SQLite, appearance setting, automated checks                              | Source implemented; verification recorded in TESTING.md                                                            |
| 2: first capture | Display selection, permission, start/stop, one session, playable local H.264 MP4, clean device release                       | Source implemented; native helper compilation verified; interactive capture and Rust integration remain unverified |
| 3: portability   | ScreenCaptureKit, Windows Graphics Capture, PipeWire portal and X11; real OS test matrix                                     | Pending                                                                                                            |
| 4: audio         | Mic/system audio, timestamps, bounded queues, mix, device removal, sync tests                                                | Pending                                                                                                            |
| 5: camera        | Overlay, compositing, locally verified segmentation model, identical preview/export                                          | Pending                                                                                                            |
| 6: library       | Playback, thumbnails, search, rename, deletion, missing-file handling, configurable directory                                | Metadata list and date/ID search only; rest pending                                                                |
| 7: browser       | Versioned schema, exact extension origin, pairing, bounded messages, no media transfer                                       | Deferred; no extension or host executable installed                                                                |
| 8: release       | Profiling, accessibility review, dependency audits, lockfiles, SBOM, signed helper/app, notarization and update verification | Pending; distribution disabled                                                                                     |

## First slice manual acceptance gate

1. Build the desktop app with a verified Rust toolchain and macOS SDK.
2. Launch in a real macOS desktop session. Confirm no permission request or device access before user action.
3. Click Find displays. Test denial, granting permission, cancellation and permission timeout. Verify stable permission identity for helper and app.
4. Choose a display and 15/30/60 fps. Record a known on-screen clock for 10 seconds. Attempt overlapping starts through IPC; reject them.
5. Stop; wait for finalization; verify positive duration, actual video dimensions and frame rate with AVFoundation or ffprobe; play the entire MP4 in QuickTime. Confirm cursor capture and no audio tracks.
6. Verify library entry, private permissions, restart persistence, and missing file indication. Never delete user media automatically.
7. Test low disk, encoder failure, revoked permissions, display disconnection, sleep/wake, quit, forced parent death, startup/finalization timeout, and repeated sessions. Confirm capture indicator disappears and no helper remains.
8. Record CPU, memory, dropped frames and thermal behavior over a 30-minute session. Do not assert performance before measurement.

Each subsequent slice must update this document and TESTING.md with actual results. Automated CI checks do not substitute for capture acceptance on physical systems.
