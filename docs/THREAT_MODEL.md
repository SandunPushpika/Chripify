# Threat model

The standalone browser app's current boundary is documented in EXTENSION_SECURITY.md. It does not expose the future Native Messaging interface described below. These sections concern the retained desktop/native integration track.

## Assets and boundaries

Assets: screen pixels, future microphone/camera data, local MP4s, SQLite metadata, OS capture consent, helper executable and dependency/release integrity. Boundaries: WebView → Rust IPC; Rust → signed native helper; app → OS permission APIs; app → private filesystem; future extension → Native Messaging host → paired desktop.

Attackers: malicious webpages/extensions, compromised renderer, unprivileged local processes, crafted local metadata/media/models, dependency/release compromise. An administrator, kernel compromise or attacker controlling the same user's writable app files can defeat this prototype's controls. App-directory privacy is not encryption or a same-user security boundary.

| Threat                                     | Current mitigation                                                                                                | Remaining work                                                                                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web page starts hidden capture             | No browser host; no remote Tauri capability; native permission and visible studio/OS status                       | Physical testing of indicators, permission identity, app menu quit                                                                                                                 |
| Renderer invokes arbitrary native commands | Five explicit permissions, main-window authorization, typed validation, no shell/FS plugin                        | IPC denial integration tests, generated contract consistency                                                                                                                       |
| Path traversal/overwrite                   | Renderer cannot pass paths; UUID private session directory; pre-existing media rejected; metadata IDs validated   | Descriptor-relative/no-follow filesystem operations before custom directories or import                                                                                            |
| Symlink substitution                       | Root/DB symlink checks, 0700 directories, 0600 completed recordings                                               | Checks are not race-free; harden with no-follow directory handles and SQLite open flags; local same-user tampering is not fully defended                                           |
| Resource exhaustion                        | Request queue 16, queueDepth 3, fixed capture size/fps, session exclusivity, deadlines, periodic free-space check | Native helper outputs are trusted; Rust line/output readers are not hard streaming bounds; adversarial helper replacement outside threat boundary; benchmark RSS and disk behavior |
| Recording continues after parent exits     | stdin EOF initiates helper stop; child kill-on-drop; failure paths kill and reap                                  | Force-quit/sleep/hang tests; helper independent watchdog and deadline                                                                                                              |
| Broken metadata or interrupted MP4         | Metadata inserted only on native finish + successful exit + file sync; retain partials                            | Fragmented recording, startup reconciliation, recovery UX and duration/media validation                                                                                            |
| Privacy leak                               | No analytics/network/upload code; no media logging; private app root; no media over IPC                           | Signed builds, dependency audit, packet inspection, final filesystem audit                                                                                                         |
| Malicious imported file/model              | No import/model feature currently enabled                                                                         | Provenance, hash allowlist, size/type bounds and isolated decoding before implementation                                                                                           |
| Dependency/update compromise               | Explicit npm versions and lockfile when generated; production packaging disabled                                  | Cargo.lock, audits, SBOM, pinned CI actions, helper/app signing, notarization, signed updater                                                                                      |

## Future Native Messaging contract

Never install a permissive placeholder host. Require exact extension origin, versioned deny-unknown schema, bounded length-prefixed input, explicit local pairing, revocable keychain-backed authorization, replay protection where appropriate, local confirmation for capture, and no arbitrary paths/media/command execution. Extension permissions must exclude broad webpage access unless demonstrated necessary.

## Review outcome

This is a development foundation with unresolved release risks. No claim of production security, race-free storage, crash recovery or cross-platform capture is made. Distribution remains disabled until native integration, permission and signing tests are complete.
