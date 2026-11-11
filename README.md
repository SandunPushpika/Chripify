# Chripify

The primary app is now a **standalone Chrome extension**. The desktop scaffold is retained separately and is not needed to install or use browser recording.

## Install the extension

1. Open `chrome://extensions` in desktop Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose `apps/chrome-extension/dist`.
4. Pin Chripify and click its icon to open the small recording popup. **Open main app** opens the library and full configuration.
5. Click **Start recording**, choose a screen/window/tab and grant the requested permissions. The recorder opens for setup, then returns to your browser tab before encoding starts.
6. Wait for the **3–2–1 countdown**, then record. Use **Stop & save**, then play or download the local WebM from **My recordings**.

A ZIP is available at `apps/chrome-extension/chripify-extension.zip` after packaging. Extract it before using Load unpacked; select the folder containing `manifest.json`. No Rust or native installation is required.

```sh
npm ci --ignore-scripts
npm run extension:build
npm run extension:package
npm run check
```

Implemented extension source: popup recording controls, an optional draggable browser camera/control overlay, microphone/shared-audio mixing, webcam composition, background-effect selection, pause/resume, local playback/library and downloads. Background choices include original, browser-native blur where supported, and green-screen blur/color/local-image replacement. Green-screen effects need a uniform backdrop; automatic AI cutout is not bundled. Chrome controls sharing consent/audio availability. Keep the recorder tab open; it owns capture even when the popup closes. MP4 conversion, editing, cloud links and unrestricted native overlays are not included.

Version 0.3.2 moves camera composition into a native-frame worker to remove hidden-page rendering dependencies, and adds cancellable startup stages. Real tab-switch/export acceptance is still required.

For an existing installation, stop recording, rebuild or use the updated dist folder, and click **Reload** in `chrome://extensions`. Keep the existing extension rather than uninstalling it to preserve its local library. Approve the new capture/scripting permissions. Enable **Keep overlay on websites** in the popup only if you want it to follow navigation and tab changes; otherwise access stays temporary on the page where you invoke the extension.

**Verification:** strict compilation, lint and simulated workflow tests pass; real Chrome capture/permissions/playable export have not been verified in the execution sandbox. This is a loadable development package, not a signed Chrome Web Store release or a claim of full Loom parity.

See the [extension installation and usage guide](apps/chrome-extension/README.md), [test/acceptance record](docs/EXTENSION_TESTING.md), and [security review](docs/EXTENSION_SECURITY.md).

## Retained desktop track — incomplete

A local-first screen recorder built with Tauri 2, Rust, React, TypeScript, Vite and Tailwind. This repository is an **early development slice**, not a production-ready release.

Implemented source: a recorder studio, dark/light appearance, restricted desktop commands, exclusive recording lifecycle, SQLite metadata list/search, and a macOS 15+ ScreenCaptureKit helper producing video-only H.264 MP4. No cloud service, analytics, account or upload feature.

**Verification boundary:** native helper compilation and automated checks are recorded in [docs/TESTING.md](docs/TESTING.md). Full Tauri integration and playable screen recording have not yet been verified in this environment. Rust/Cargo and full Xcode are missing. Do not treat this scaffold as a completed recording product.

## Development

Prerequisites: Node 22.12+, npm, current stable Rust with rustfmt/clippy, and [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). macOS recording requires macOS 15+ and its SDK. Install prerequisites yourself through trusted official sources; scripts do not perform privileged installations.

```sh
npm ci
npm run check
npm run native:build
cd apps/desktop/src-tauri
cargo install tauri-cli --version '^2' --locked
cargo tauri dev
```

Until Cargo.lock is generated and reviewed, run `cargo generate-lockfile` before `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D warnings`, and `cargo test --locked`. Dependency resolution and all checks must succeed before calling the desktop slice validated.

`npm run dev` opens only the Vite frontend at `http://127.0.0.1:1420`. It explicitly identifies itself as a non-recording browser preview. No native behavior is simulated.

## Recording workflow (pending interactive acceptance)

Launch the desktop app. In Studio, click the refresh button to request OS screen permission and list displays. Select a display and frame rate, then Start recording. Stop & save waits for native finalization and registers the file in the local library. The UI provides a local file path for opening in Finder; integrated playback is not implemented.

Files live under the OS app-local-data directory (`com.chripify.desktop`), each recording in an application-generated UUID subdirectory. On macOS this is under the user's Library/Application Support. Media is never uploaded. Low space triggers graceful stopping, but interrupted MP4 files are not guaranteed recoverable. Failed/partial files are retained; no user media is automatically deleted.

## Current limitations

Only macOS display capture source exists. No audio, selected-window capture, pause/resume, webcam, segmentation, custom directory, built-in playback/thumbnails, deletion or Chrome integration. Packaging is disabled until helper signing, release verification and security gates are complete. See [implementation plan](docs/IMPLEMENTATION_PLAN.md), [architecture](docs/ARCHITECTURE.md), [platform matrix](docs/PLATFORM_SUPPORT.md), [threat model](docs/THREAT_MODEL.md), and [technical debt](docs/TECHNICAL_DEBT.md).
