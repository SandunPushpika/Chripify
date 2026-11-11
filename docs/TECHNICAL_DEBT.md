# Explicit remaining work

- Obtain a working Rust toolchain/network and generate/review Cargo.lock. Execute fmt, clippy, tests, Tauri ACL/config generation and native integration build. This is a release blocker.
- End-to-end permission/capture/playback/device-release tests on a real desktop. No fake capture results may substitute.
- Replace time-of-check storage checks with descriptor-relative/no-follow access and race-free destination reservation where framework APIs permit. Verify private database/WAL permissions and Windows ACLs.
- Hard streaming limits for helper stdout, independent helper shutdown watchdog, cancellation during preparation, process failure taxonomy and complete app-quit coordination.
- Validate media duration/codec with AVFoundation before presenting recordings as playable; retained partials need reconciliation/recovery UI.
- Application-managed settings schema/migrations and directory chooser with scoped, secure authority. Current setting is appearance only.
- Extract focused UI components as library and settings grow; add DOM accessibility and desktop IPC integration tests, visual checks, keyboard shortcuts and focus/error recovery.
- TypeScript/Rust protocol drift checks or generated bindings; versioned Native Messaging contracts only when extension work starts.
- Verify formatting with the pinned Prettier 3 tool and rustfmt; move the formatter into the reviewed lockfile. Run vulnerability scanners with current databases, SBOM and signed artifact gates; pin CI action SHAs after review.
- Performance benchmarks, sustained capture, interruption tests and complete OS matrix.
