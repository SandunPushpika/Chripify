# ADR 0004: popup controls, scoped page overlays and local camera effects

Status: implemented source; new Chrome UI/permission flows require interactive acceptance. User reports the previous 0.2 recording extension works well.

## Popup capture ownership

Alternatives: own MediaRecorder in the action popup, or retain the persistent recorder and send narrow commands. Choose the persistent recorder because Chrome destroys a popup when it closes. The toolbar now opens `popup.html`; Open main app is a separate action.

Popup Start asks the worker to show `desktopCapture.chooseDesktopMedia`. Its opaque, single-use, short-lived source token is handed to the existing recorder tab and consumed immediately through Chrome's desktop stream constraints. It is never persisted or logged. The main app retains the existing getDisplayMedia workflow. The camera/mic consent, state machine, bounded writer, stop cleanup and library remain shared. Audio startup has a deadline instead of hanging if background autoplay is blocked.

### 0.3.1 correction

The initial worker picker omitted its target tab, which Chromium requires in service workers even though the API's general signature marks the argument optional. Supply the actual recorder Tab from tabs.get, verify its document through getContexts, and include the recorder's own extension URL when Chrome redacts it. The token is bound to the consuming extension tab, never the website being captured. No broad tabs permission is introduced.

The hidden owner must not wait for enumerateDevices: device enumeration may wait for a visible document. Initialize preferences and recovery before readiness, then refresh device labels/quota independently and defer enumeration while hidden. Saved device IDs remain selected even before labels can be exposed.

Evidence: [Chromium target-tab issue](https://issuetracker.google.com/issues/41493089), [Media Capture visibility checks](https://www.w3.org/TR/mediacapture-streams/).

## Browser overlay

Alternatives: a new camera capture in every page, local WebRTC peers, or a bounded thumbnail relay from the single capture owner. Choose an isolated-world content script, a closed shadow root and a pull-based JPEG preview: at most one request in flight, up to five 200×200 JPEG frames per second per visible active page, maximum 100,000 characters per frame. No STUN, external signaling or extra camera streams.

The overlay exposes pause/resume/stop only; webpages cannot start capture or access the library. Source selection is authorized only from the popup or main app. Every frame/control request requires this extension's sender identity, top frame, matching HTTP(S) origin, an active tab with a Chrome-visible URL and a temporary tab/origin grant or explicit website-follow permission. Revoked or redacted URL access fails closed. A hidden page does not poll frames.

Required permissions: storage, activeTab, scripting and desktopCapture. No mandatory host permissions. Website-follow is an optional HTTP(S) host grant requested in a direct checkbox gesture; it registers a local top-frame content script. Existing page injection and all frame relays still enforce authorization. Internal Chrome pages and the Chrome Web Store block injection.

Page overlays are part of page rendering and may appear in shared recordings, including duplicate camera imagery alongside the recorder-composited camera. Chrome does not provide reliable universal exclusion. Include Hide camera and Hide overlay actions; do not promise exclusion. Overlay drag position is separate from the camera position encoded by the recorder.

## Camera backgrounds

Alternatives: a bundled MediaPipe/ONNX runtime/model, or available native blur plus explicit chroma-key effects. Registry/model downloads are blocked and no approved ML assets are cached. Do not ship remote executable/model fetching or pretend a heuristic is AI segmentation.

Implement original, native blur when the camera advertises backgroundBlur support, and green-screen blur/color/local-image replacement. Native failure is visibly reported with original-background fallback. Chroma-key effects require a uniform backdrop and have adjustable key color/tolerance. User images are restricted to PNG/JPEG/WebP, bounded in encoded size and decoded dimensions, then locally re-encoded; no SVG or remote URLs. Settings remain local.

As updated by ADR 0005, a worker-owned processed canvas supplies recording composition, the processed picture-in-picture view and the browser JPEG preview. Original/native output preserves camera aspect ratio and up to 640px; chroma key limits processing to 320px. Do not claim measured frame rate or automatic person cutout.

References: [desktop capture](https://developer.chrome.com/docs/extensions/reference/api/desktopCapture), [activeTab and restricted pages](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [optional host permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [background blur constraints](https://w3c.github.io/mediacapture-main/getusermedia.html).
