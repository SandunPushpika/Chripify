# ADR 0003: standalone Chrome recorder as primary deliverable

Status: accepted after the user clarified that the app must be added to Chrome and record independently. Supersedes the original desktop-first rollout; the native scaffold is retained separately.

## Alternatives and decision

1. Native Messaging controls a desktop recorder: supports native capture and overlays, but requires a signed native installation, pairing, origin authorization and platform backends.
2. A persistent recorder extension tab owns getDisplayMedia/getUserMedia, Web Audio, canvas, MediaRecorder and IndexedDB: no native install, much smaller authority, but subject to Chrome consent, codec/audio availability and background throttling.
3. An offscreen owner plus popup UI: survives popup closure, but adds permission, acquisition handoff and cross-context control complexity.

Choose 2. The toolbar opens/focuses the persistent recorder tab; it never owns streams. A browser lock prevents duplicate owners. Explicit Start invokes the sharing picker in the user gesture before awaiting storage/device work. Keep this tab open until finalization.

## Boundaries

- `background.ts`: toolbar navigation, recorder tab ID and serialized badge state.
- `domain.ts`: lifecycle, settings/title validation, codec selection, versioned status schema.
- `engine.ts`: capture/encoder ownership, pause clock, write backpressure, finalization and cleanup.
- `media.ts`: local audio mixing and camera composition driven by both source frame callbacks.
- `storage.ts`: IndexedDB chunk/metadata transactions and interrupted-session reconciliation.
- `ui.ts`: settings, preview, local playback/library, explicit downloads and camera positioning.

No Native Messaging, host permissions, webpage content scripts, localhost listener or external control surface is introduced. Worker messages carry only a validated badge state from this extension's recorder URL; never media, filesystem paths or capture commands.

## Tradeoffs

Use browser-supported WebM VP9/VP8/Opus instead of FFmpeg/WASM or cloud transcoding. Persist one-second chunks in sequence; completion requires encoder stop, successful writes and non-empty media. IndexedDB transactions do not guarantee crash-proof filesystem durability or recoverable WebM. Export assembles browser-managed Blobs instead of JS byte arrays, but browser-managed memory can still grow for large exports.

Canvas callbacks from both camera and screen avoid freezing camera motion on a static screen. Background/occlusion throttling still requires measurement. Native-equivalent overlays, verified frame rate, AI effects and complete Loom parity are not claimed.

References: [Chrome capture guide](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture), [runtime contexts](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getContexts), [worker lifecycle/storage](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers), [Screen Capture specification](https://www.w3.org/TR/screen-capture/), [MediaStream Recording specification](https://www.w3.org/TR/mediastream-recording/).
