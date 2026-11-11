# Extension security review

Assets: shared screen/window/tab pixels, microphone/camera samples, encoded recordings and metadata. Boundaries: Chrome user-consent APIs → recorder; recorder → IndexedDB; recorder → toolbar status; explicit user download → Chrome-managed filesystem export.

Version 0.3 requests `storage`, `activeTab`, `scripting` and `desktopCapture` for the requested popup/overlay workflow. There are no mandatory host permissions, external messaging, Native Messaging, shell execution, web-accessible resources, analytics or upload endpoints. Optional HTTP(S) website-follow access is requested only from a direct popup checkbox gesture and registers a local top-frame content script. CSP still permits bundled scripts/styles, local media, and no network connections. Titles/warnings render as textContent, never HTML.

Capture starts through an explicit popup/main-app action and Chrome sharing consent. The worker's short-lived desktop source token is immediately consumed by the persistent owner and never stored/logged. Owner identity is checked for badge/status messages; popup origin is checked for start/configuration navigation. Content-script requests are restricted to pause/resume/stop and bounded live-state previews, never capture start, files or the library. No webpage postMessage bridge exists.

Every page request checks extension identity, top frame, active tab, Chrome-visible URL matching the sender origin, and temporary tab/origin authorization or explicit website-follow permission. A permission-redacted tab URL fails closed even if an old script remains injected. Removing website-follow unregisters scripts and clears page widgets; same-origin temporary grants remain subject to actual Chrome URL access. Grants are cleared when recording returns to idle. A browser lock prevents overlapping owners; worker suspension does not own media.

Camera thumbnail relay is an intentional new internal-media boundary: at most one in-flight pull request per visible active page, five 200×200 JPEG frames per second, maximum 100,000 characters per frame, no queue. Hidden/inactive/dismissed widgets do not poll camera frames. Images live in a closed shadow root, are cleared on hide/stop, and are not made web-accessible. A hostile page can still remove/cover UI, and any overlay can be included in user-consented screen capture. Do not promise exclusion from recorded pages.

Background effects use native blur only when advertised, or explicitly labelled chroma key with locally validated colors/tolerance. User images are PNG/JPEG/WebP only, bounded in encoded size/decoded dimensions and resized/re-encoded before storage. No SVG, remote image URLs or model downloads. Original/native processing is bounded to 640px and chroma key to 320px, preserving aspect ratio. A single processed source supplies preview, thumbnail, picture-in-picture and recorded composition.

Chunk data/counts update in the same IndexedDB transaction. The write queue is bounded at 32 MiB. Quota/write failures stop capture and retain interrupted metadata. Permission responses arriving after timeout have their tracks stopped. Device/audio resources are disposed on stop/failure/pagehide. Encoder finalization has a watchdog; timeout is interrupted, never successful.

## Remaining release gates

- Real Chrome permission/capture/playback, resource cleanup, badge suspension and interruption tests.
- Browser IndexedDB durability and resource/large-export profiling; quota is not a physical-disk guarantee.
- Backgrounded camera frame rate and audio/video synchronization measurement.
- Current dependency audits, compatibility matrix, accessibility and permission UX review.
- Chrome Web Store privacy disclosures, signing/distribution review and artifact hashes. The local ZIP is a development artifact.
- AI effects need a separate model provenance/integrity/inference/CSP review; no model is currently downloaded or run.
- Real popup picker/token handoff, optional permission grant/revocation, restricted-page behavior, worker suspension, overlay capture duplication and native-blur fallback need Chrome acceptance. New source paths are not established by the user's positive feedback on version 0.2.

Browser compromise, malicious extensions and same-user processes are outside the app's complete protection. Browser data is not encrypted by the extension and is not a permanent backup. Never infer full Loom parity or production security from media simulations.
