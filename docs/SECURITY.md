# Security practices

All capture, encoding, metadata and settings stay local. No telemetry, accounts or upload service is implemented. Do not add network dependencies to capture workflows.

Do not log window titles, filenames, raw framework errors containing sensitive metadata, media buffers or authentication material. Errors crossing IPC use deliberate user-facing messages.

Keep Tauri permissions restricted to specific local windows and commands. Never accept shell strings, executable paths, arbitrary encoder options or output paths from a renderer or extension. OS permission is required in addition to application authorization.

Development artifacts are unsigned and must not be distributed. Before release: run npm and Rust audits, dependency/license review, SBOM generation, model provenance review if applicable, helper/app signing, macOS notarization, platform artifact verification and signed-update verification. Updates are not currently enabled.

There is no vulnerability reporting address configured for this new project. Before public release, the maintainer must publish a monitored private reporting channel and remediation policy. Do not include private recordings in public bug reports.

See THREAT_MODEL.md and TECHNICAL_DEBT.md for unresolved risks.
