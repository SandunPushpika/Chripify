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

For an existing installation, stop recording, rebuild or use the updated dist folder, and click **Reload** in `chrome://extensions`. Keep the existing extension rather than uninstalling it to preserve its local library. Approve the new capture/scripting permissions. Enable **Keep overlay on websites** in the popup only if you want it to follow navigation and tab changes; otherwise access stays temporary on the page where you invoke the extension.

**Verification:** strict compilation, lint and simulated workflow tests pass; real Chrome capture/permissions/playable export have not been verified in the execution sandbox. This is a loadable development package, not a signed Chrome Web Store release or a claim of full Loom parity.

See the [extension installation and usage guide](apps/chrome-extension/README.md), [test/acceptance record](docs/EXTENSION_TESTING.md), and [security review](docs/EXTENSION_SECURITY.md).
