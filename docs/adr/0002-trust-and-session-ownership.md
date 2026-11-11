# ADR 0002: native-owned session and narrow desktop authority

Status: accepted; integration verification pending.

Alternatives: UI-owned state plus broad filesystem/shell plugins, or native-owned lifecycle with narrow commands. Choose a Rust actor with a bounded queue and exclusive ownership of the capture child. UI state is a projection of native state. This prevents overlapping sessions across frontend rerenders and concurrent IPC.

Alternatives for integration: localhost HTTP/WebSocket service or child stdin/stdout. Choose private child pipes. No listening port, cross-origin access, local authentication secret or browser exposure is needed in this slice.

Custom application commands receive explicit generated permissions and a single local main-window capability. No remote capabilities are configured. The global Tauri API is enabled solely to call the documented core invoke API without an additional JS runtime dependency. Its availability is not authority: native capabilities and validation enforce authority.

Metadata resides in SQLite, while media is stored in UUID directories. Separate metadata from media for small transactions and avoid storing paths provided by the renderer. No public Native Messaging authority exists yet.

References: [Tauri capabilities](https://v2.tauri.app/security/capabilities/), [application command manifests](https://docs.rs/tauri-build/latest/tauri_build/struct.AppManifest.html), [Tauri invoke](https://v2.tauri.app/develop/calling-rust/).
