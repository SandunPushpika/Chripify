# Verification record

This is the earlier desktop track's verification record. The primary standalone Chrome extension now has its own current evidence and acceptance gate in EXTENSION_TESTING.md.

Host: macOS 26.6.2, arm64. This records actual local results; no GitHub Actions run or interactive recording test is implied.

| Check                                                                              | Result                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clean `npm ci --offline --ignore-scripts`                                          | Passed from a writable clone of the existing npm cache; lockfile has registry resolutions and integrity hashes                                               |
| TypeScript strict check                                                            | Passed                                                                                                                                                       |
| ESLint, including React hooks rules                                                | Passed after correcting lazy time initialization and effect-driven library loading                                                                           |
| Frontend unit tests                                                                | 5 tests: active-session presentation, elapsed formatting, error mapping, browser capture rejection, structured IPC dispatch                                  |
| Production Vite bundle                                                             | Passed; approximately 204 kB JS / 17 kB CSS before gzip                                                                                                      |
| Swift helper optimized compilation                                                 | Passed with macOS 15 deployment target and local macOS 15.4 SDK                                                                                              |
| Native invalid-input tests                                                         | Passed: 4 cases rejected before capture permission or initialization                                                                                         |
| Swift strict formatting lint                                                       | Passed using installed swift-format                                                                                                                          |
| Frontend/docs/config formatting                                                    | Passed with locally installed Prettier 2.8.8 using repository configuration; CI is configured for pinned Prettier 3.9.10, which could not be fetched locally |
| Rust formatting, clippy, unit tests, build, Tauri ACL generation                   | Not run: Rust/Cargo unavailable. Five Rust tests are written, not executed.                                                                                  |
| npm vulnerability audit                                                            | Attempted; blocked by registry DNS failure. No clean audit claim.                                                                                            |
| Rust dependency audit / SBOM / artifact signing                                    | Not run; no release artifacts produced                                                                                                                       |
| Dev server smoke test                                                              | Blocked: sandbox denies binding 127.0.0.1:1420 (EPERM)                                                                                                       |
| Browser screenshot                                                                 | Attempted with installed Chrome in a separate temporary profile; browser exited before rendering. No visual validation claim.                                |
| OS permission, actual capture, playable MP4, device release, sustained performance | Not tested; requires interactive desktop and complete native build                                                                                           |

The broad default Vitest search initially discovered third-party tests in a temporary copied dependency directory. The test configuration now explicitly selects application/package source tests; the temporary dependency copy was removed. All project tests must pass; unrelated dependency source tests are not part of the product suite.

## CI intent and current blockers

CI defines frontend type/lint/test/build/format/audit checks, macOS helper compile/argument checks, Rust fmt/clippy/tests/build on macOS/Windows/Linux, and dependency review/audit. **The workflow has not been executed.** Rust and security jobs intentionally require a committed Cargo.lock; they will fail until a supported environment generates and reviews it. This gate is not skipped or replaced by an unlocked build.

The npm lock was generated offline on macOS. Reconcile platform-specific optional native packages in a connected environment and verify clean installs on the full matrix. A macOS-only successful build is not a cross-platform result. Move the pinned formatter into the reviewed development dependency graph when network access is available; the current format command fetches an explicitly pinned tool version through npm exec.

## Manual acceptance

Follow docs/IMPLEMENTATION_PLAN.md for permission, playback, failure, shutdown and performance scenarios. Report duration, resolution, frame rate, disk usage, memory, CPU and device-release observations. Test ordinary Quit and forced process termination separately; close-window guarding alone does not establish complete shutdown correctness.
