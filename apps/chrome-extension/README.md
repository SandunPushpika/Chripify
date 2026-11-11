# Chripify Chrome extension

A standalone Manifest V3 screen recorder. **No desktop app, Rust, account or Native Messaging installation is required.** All media stays local.

## Add it to Chrome

The built extension is in `apps/chrome-extension/dist`. The ZIP is `apps/chrome-extension/chripify-extension.zip`.

1. Open `chrome://extensions` in desktop Chrome 116 or newer.
2. Enable **Developer mode** at the top right.
3. Click **Load unpacked** and select the **dist folder**, not the source folder or ZIP. If using the ZIP, extract it first and select the folder containing `manifest.json`.
4. Pin Chripify using Chrome's Extensions menu, then click its icon.
5. The icon opens a compact popup. Set microphone, shared audio, camera and background effect there; use **Open main app** for resolution, devices, green-screen options, images and the library.
6. Click **Start recording**, choose a screen, window or tab in Chrome's picker, and click **Share**. For tab sound, choose a Chrome tab and enable **Share tab audio**.
7. Grant camera/microphone permission if enabled. Capture begins after all requested devices are available.
8. Use **Pause**, **Resume**, or **Stop & save** in the popup, main app or page overlay. Click the extension icon on another website to show the overlay there. Enable **Keep overlay on websites** if you want it to follow other tabs and navigation automatically; Chrome asks for that optional site permission.
9. In **My recordings**, play, rename, download or delete the video. Downloads are **WebM** (Chrome, Edge and VLC support it). MP4 conversion is not included.

Keep the recorder tab open until saving completes. You can switch to other tabs or applications. Closing/reloading this tab interrupts capture. Closing the toolbar menu does not stop recording because the tab owns the streams.

For an existing installation, stop any recording and update the files in the **same unpacked folder** Chrome already uses, then click **Reload** in `chrome://extensions`. If you installed from the ZIP, copy the updated ZIP contents into that existing folder; loading a different folder can create a different extension ID and separate library. Approve the new required permissions, then refresh existing website tabs. Do not remove/reinstall the extension if you want to preserve the current browser library. The IndexedDB schema and existing recordings are unchanged.

## Webcam

The saved video contains the same camera composition as the preview. Drag the ✥ handle or focus it and use arrow keys (Shift for larger steps). Adjust size, shape, mirroring and visibility beneath the preview.

The browser overlay is a separate draggable camera view with a timer and pause/resume/stop buttons. Drag its header or use arrow keys; ✕ hides it without stopping capture. Hide camera preview hides only the browser thumbnail. It is available on permitted HTTP(S) pages, not Chrome internal pages or the Web Store. It may appear in the shared page/screen recording, including a second camera image beside the encoded webcam; hide it when needed. Its position does not change the webcam position encoded by the recorder.

**Float webcam** opens Chrome picture-in-picture if supported. Its desktop position is separate from the camera position in the saved video; Chrome controls the floating window shape/size. Backgrounded/occluded recorder tabs may be throttled, so test a short webcam clip on your device first.

## Background effects

Turn Camera overlay on in the popup or Make it your own card to reveal the background selector. Effects apply when recording starts and are shared by the recording preview, browser camera thumbnail, saved video and processed picture-in-picture.

- **Original:** preserve the camera image.
- **Background blur:** uses Chrome/camera on-device support. If unavailable or rejected, a visible warning explains the original-background fallback; it is not silently represented as working blur.
- **Green-screen blur/color/image:** local chroma key, requiring a uniform backdrop. Choose the backdrop color and tolerance in the main app. For image mode, upload PNG/JPEG/WebP (up to 5 MB / 16 megapixels); it is resized/re-encoded locally and stored with preferences. No SVG or remote image URLs.

These are not bundled AI person segmentation. No ML model/runtime is cached, and model/registry downloads are unavailable in the build environment. Automatic cutout against an arbitrary room background remains future work. Camera and effect choices are stored locally; no device opens just from changing a preference.

## Storage and privacy

- Encoded chunks are persisted to IndexedDB every second, with at most 32 MiB of pending writes.
- Quota is checked before encoding and every 10 seconds. Browser quota estimates do not guarantee free physical disk space.
- No mandatory host permissions, external control, accounts, network calls, analytics or uploads. Local content scripts provide only the requested overlay.
- Required permissions are `storage`, `activeTab`, `scripting` and `desktopCapture`. The popup's website-follow checkbox requests optional HTTP(S) host access. Without that grant, overlay access stays temporary to the site where you invoke the extension.
- Preferences and the background image stay in local extension storage. Session storage holds owner/status and temporary overlay authorization, not recording files.
- The single recording camera supplies bounded 200×200 JPEG thumbnails to authorized visible active pages through internal Chrome messaging, up to five times per second. No frames go to a network service or Native Messaging host. Hiding/ending capture clears page preview images.
- One browser lock prevents simultaneous capture owners. Chrome indicators and the REC/pause badge show capture state.
- Interrupted sessions retain partial chunks and are labelled; their WebM may not be playable.
- Uninstalling the extension, clearing browser data, profile loss or eviction can delete the library. **Download important recordings.** Incognito is not supported by this package.

## Limits

Sharing always requires Chrome consent. Screen/window/system audio varies by Chrome, OS and source; a warning appears if no shared audio track is available. Protected content may appear black. No simultaneous multi-monitor composition, editing, automatic AI cutout, cloud links, MP4 conversion or arbitrary native desktop overlay is included. Audio gains/effects are configured before recording. Frame rate and resolution depend on browser/device capabilities; sustained performance is unverified.

## Development

From the repository root:

```sh
npm ci --ignore-scripts
npm run extension:build
npm run extension:package
npm run check
```

Packaging uses Python 3's ZIP library; installed recording needs only Chrome. The extension consists of strict TypeScript compiled to local ES modules, HTML/CSS and an icon, with no runtime npm dependencies.

See [acceptance and verification](../../docs/EXTENSION_TESTING.md). Automated media simulations do not establish actual Chrome permission, audio sync or playable recording results. Interactive acceptance remains required.
