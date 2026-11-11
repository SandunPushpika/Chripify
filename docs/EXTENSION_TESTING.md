# Chrome extension verification

The extension compiles with strict TypeScript, passes ESLint, and has no runtime npm dependencies. Current project tests include 60 extension tests plus 5 earlier desktop frontend tests (65 total).

Version 0.3.1 fixes two independently identified toolbar-start defects: missing targetTab in a service-worker desktop picker call, and hidden-tab initialization awaiting visibility-dependent device enumeration. Eight new regressions verify target/extension-origin binding, rejection of wrong/missing targets, cancellation, Chrome runtime errors, synchronous throws/callbacks, timeout/late callback cleanup, skipped hidden enumeration, and normal visible device listing. These are API-contract simulations; the new build still needs an interactive Chrome toolbar recording check.

The user reports version 0.2 works well in Chrome. That is positive baseline feedback, not evidence that the new 0.3 popup, permission, camera-effect and content-script paths have been interactively verified.

New automated cases cover popup source-provider handoff without a second picker, a bounded blocked-audio startup, temporary overlay grants, active/matching-origin checks, revoked permission URL redaction, allowed command schemas, bounded thumbnails/warnings, persisted settings validation, chroma-key alpha/feathering and supported/unsupported/rejected native blur. The build checks exact reviewed mandatory/optional permissions, both HTML control trees, local module closure and classic (non-module) content-script output.

Extension tests cover lifecycle legality, encoder settings/title validation, codec negotiation, versioned status schema rejection, error mapping, elapsed time, pause clock, chunk order, failed writes, write backpressure, late permission stream cleanup, and simulated start/pause/resume/stop, low quota and resource cleanup.

Workflow tests use fake MediaStream/MediaRecorder objects. They verify application logic, **not** real encoding, permissions, audio sync, canvas rendering, IndexedDB durability, or playable exports. Interactive Chrome capture is not verified in this execution environment. Desktop/Swift checks do not verify the extension.

A fresh headless Chrome launch was attempted for this extension work; the browser exited with signal 6 before rendering. No test browser (Chromium/Chrome for Testing) is installed. This is an environment limitation, not a passing browser test.

## Interactive acceptance gate

Load the dist folder following the extension README. Record real results separately for macOS, Windows and Linux:

1. Reload the existing extension without uninstalling; confirm older recordings remain. Click icon: a compact popup, not automatic navigation. Open main app explicitly. Popup Start shows one Chrome picker and hands its token to one persistent recorder; closing the popup must not stop capture. Restart worker: it finds the actual lock-owning recorder, not a duplicate tab.
2. Start screen-only recording. Cancel/deny sharing: idle state, no active devices and no empty complete recording.
3. Record a Chrome tab with a known audiovisual clock; enable Share tab audio and disable microphone. Switch tabs and navigate the captured tab. Stop, play the complete local clip, download and play the WebM independently.
4. Test entire screen and window separately. Verify clear warnings when shared audio is unavailable, and OS permission errors.
5. Test microphone/camera selection and permission denial. Verify audio mix/gain, A/V sync, camera motion over a static screen, shapes, mirroring, size, position and visibility in preview and export.
6. Pause for 5 seconds and resume. Saved duration must exclude pause. Stop while paused; repeat stop; get one finalized entry.
7. Test picture-in-picture and cleanup. Measure webcam behavior while another app is active and the recorder is backgrounded/occluded/minimized. A 60 fps setting is not evidence of actual 60 fps.
8. Close toolbar menu: capture continues. Click icon: controls return. Check REC/pause badge, Chrome indicators, persistent stop and keyboard controls (Alt+Shift+S/P within recorder; Alt+Shift+R opens it where Chrome allows).
9. Duplicate recorder tab: one owner only. Close/reload active recorder: devices release; next open retains interrupted chunks. Closing unrelated tabs must not clear the badge.
10. Simulate full/slow/failed storage, encoder failure, camera/mic removal and Chrome's Stop sharing. Require device cleanup, retained interrupted state and no false success.
11. Hostile-looking titles render literally. Test search/sort/rename, cancelled/confirmed deletion and independent downloaded copies.
12. Record 30 minutes with/without webcam at 720p/1080p. Measure CPU/RSS, storage, dropped frames, sync drift, thermals and export memory. Verify no network media transfer.

## Package checks and limits

The build validates a Manifest V3 package with only local scripts, reviewed capture/scripting permissions, optional website host grants, no mandatory host permissions and no external messaging. ZIP packaging verifies the archive. No signed Chrome Web Store artifact is produced.

No automatic AI person cutout, MP4 conversion, editing, cloud links, native desktop overlay control or multi-monitor composition. Native blur depends on camera/browser support; chroma-key effects need a uniform backdrop. Storage is not app-encrypted and browser data can be deleted; download important media. Actual OS/audio support and sustained webcam performance remain unverified.

## Version 0.3 acceptance additions

1. Popup Start with microphone/camera off, then on; cancel picker and each device prompt. One picker per start, no token reuse, no capture after popup closure without source consent, no orphan devices on errors. If Chrome blocks background audio, show actionable fallback instead of hanging.
2. Toggle Camera in both popup and Make it your own. The background selector appears only when enabled, settings synchronize, and no device opens merely from selecting a preference.
3. Check original, native blur supported/unsupported, green-key blur/color and local image replacement. Compare main preview, browser preview, PiP and exported video. Test non-4:3 cameras and verify no stretching. Reject SVG, malformed/oversized images and remote URLs. Native failure must warn instead of claiming blur.
4. Start on a normal website: draggable camera and controls appear. Pause/resume/stop there, test keyboard drag, Hide camera, Hide overlay and re-show by clicking the extension icon. Both camera and recording stop on Stop; overlay images are cleared. Verify no second camera device request from content scripts.
5. Deny website-follow: temporary starting-page access only. Grant it explicitly: overlays follow tab activation/navigation. Remove it during capture, including via Chrome's permission UI: unauthorized pages must stop receiving frames. Background/hidden tabs must not poll camera previews.
6. Test chrome:// pages, Web Store, extension pages, navigation between unrelated origins, multiple windows, duplicate recorder tabs and worker restart. Restricted pages retain popup controls without an injected camera. One page must not acquire another origin's preview through stale tab IDs or sender spoofing.
7. Record a page containing the overlay: verify the documented inclusion/duplicate-camera risk and hide controls when desired. No universal exclusion promise is made. Profile JPEG polling and chroma-key processing during a sustained recording.

## Version 0.3.2 acceptance additions

Automated simulations cover native-frame transfer without a document, camera updates over a static screen, bounded backpressure and frame closure, worker readiness before sink consumption, unsupported APIs, startup deadlines/cancellation, late permission cleanup and returning to the browser before encoding. These do not measure real GPU behavior or encoding.

1. Reload version 0.3.2 in the same extension installation. Start from the popup with camera/microphone both off, then both on. Permission setup should show the recorder; encoding starts after returning to the launching tab. Confirm progress stages, recording state and working overlay controls.
2. Share Entire screen for each camera mode. Move among several tabs and another desktop app, animate the camera over a static screen, then stop and replay the downloaded WebM throughout. Check motion, audio sync and effects after each switch. Compare the saved file with the live preview.
3. Cancel preparation, deny permissions and retry. Test stalled device/worker startup and source removal. Require an actionable error, idle state, no leaked devices and no false completed recording.
4. Test supported/unsupported native frame-processing APIs. Unsupported camera composition must fail explicitly; screen-only recording remains available.

## Version 0.3.3 countdown acceptance

Automated lifecycle tests check the 3–2–1 stages after browser restoration, no encoding or elapsed recording time until all three seconds pass, and cancellation/device cleanup before encoding.

In Chrome, test toolbar and Studio starts: after permission setup, see 3, 2, 1, then recording. On permitted websites, the overlay shows large numbers; restricted pages use the popup/Studio status. Cancel during each countdown step and retry. Replay a downloaded clip to confirm the countdown is excluded. Timers can run late under browser throttling; the app waits for each full countdown step rather than skipping numbers. These new visual flows still require interactive acceptance.
