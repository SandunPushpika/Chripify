# ADR 0005: remove hidden-page rendering from recording

Status: implemented in 0.3.2; automated checks pass. Interactive Chrome acceptance remains pending.

## Requirements and acceptance

Screen video must continue when the recorder tab is hidden. Camera composition/background effects must not depend on HTML video presentation callbacks. Toolbar startup must obtain permissions in a visible context, leave preparing on success/error/cancellation, and release late-acquired devices. Keep existing local recordings, narrow permissions, audio mixing and library behavior unchanged.

## Alternatives

1. Add timers or a hidden/offscreen document around the existing video/canvas presentation loop. This is smaller but still depends on document rendering and timer policies; it does not address the underlying capture-versus-presentation boundary.
2. Consume native VideoFrames with Chrome's MediaStreamTrackProcessor, transfer bounded streams to a dedicated worker, composite with OffscreenCanvas and write generated video tracks. Rendering becomes frame-driven rather than visibility-driven. This introduces worker/stream lifetime and timestamp management, requiring focused regression tests.

Choose 2 for camera composition. Screen-only recording continues consuming the original screen track directly. No new extension permissions or remote code. Capability checks must fail clearly instead of silently falling back to the known frozen path.

## Boundaries and safeguards

The document acquires permissions/tracks and owns MediaRecorder/storage. A dedicated worker owns at most the latest screen/camera frame and one generated write in flight, processes effects locally, and closes replaced frames. The same worker supplies processed camera output and bounded JPEG thumbnails. No video.play, requestAnimationFrame or requestVideoFrameCallback gates encoded video.

The worker's output timestamps preserve the first screen timestamp and advance with a monotonic clock; camera updates can produce frames when the screen is static. Backpressure drops stale source frames rather than growing memory. Startup/worker failures abort preparation or stop and retain an interrupted recording.

Toolbar Start activates the recorder during browser/device permission setup, then returns to the launching tab before MediaRecorder starts. The icon itself still opens only the popup. The worker's live-state query must report the actual owner state instead of masking a successful owner as preparing while waiting for an acknowledgment. Add bounded handoff/cancellation and visible stage/error messages.

References: [Chrome insertable media processing](https://developer.chrome.com/docs/capabilities/web-apis/mediastreamtrack-insertable-media-processing), [Chrome worker frame processing](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs), [MediaStreamTrack processing specification](https://www.w3.org/TR/mediacapture-transform/).

Automated frame/lifecycle tests cannot establish real Chromium capture, A/V sync or foreground/background performance. Interactive tab-switch and exported-video acceptance remain required.
