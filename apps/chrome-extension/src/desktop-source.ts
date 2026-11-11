export interface DesktopSource {
  streamId: string;
  audio: boolean;
}

/** The picker must bind its token to the consuming recorder tab, not the captured website. */
export function chooseDesktopSource(
  target: { id?: number; url?: string },
  audio: boolean,
  timeoutMs = 120_000,
  signal?: AbortSignal
): Promise<DesktopSource> {
  if (
    !Number.isSafeInteger(target.id) ||
    (target.id ?? -1) < 0 ||
    target.url?.split('#')[0] !== chrome.runtime.getURL('recorder.html')
  ) {
    return Promise.reject(
      new Error('The recording tab is unavailable. Open the main app and retry.')
    );
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestId: number | undefined;
    const finish = (error?: unknown, source?: DesktopSource) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      if (error) reject(error);
      else if (source) resolve(source);
    };
    const cancelled = () => {
      finish(signal?.reason ?? new DOMException('Sharing cancelled.', 'AbortError'));
      if (requestId !== undefined) chrome.desktopCapture.cancelChooseDesktopMedia(requestId);
    };
    if (signal?.aborted) {
      cancelled();
      return;
    }
    signal?.addEventListener('abort', cancelled, { once: true });
    try {
      requestId = chrome.desktopCapture.chooseDesktopMedia(
        audio ? ['screen', 'window', 'tab', 'audio'] : ['screen', 'window', 'tab'],
        target,
        (streamId, options) => {
          const error = chrome.runtime.lastError;
          if (error)
            finish(new Error(error.message || 'Chrome could not open the sharing picker.'));
          else if (!streamId) finish(new DOMException('Sharing cancelled.', 'NotAllowedError'));
          else
            finish(undefined, { streamId, audio: audio && options?.canRequestAudioTrack === true });
        }
      );
      if (!settled)
        timer = setTimeout(() => {
          finish(new Error('Sharing selection timed out.'));
          if (requestId !== undefined) chrome.desktopCapture.cancelChooseDesktopMedia(requestId);
        }, timeoutMs);
    } catch (error) {
      finish(error);
    }
  });
}

/** enumerateDevices may wait for visibility; never put that wait on hidden-owner startup. */
export async function enumerateVisibleDevices(
  devices: Pick<MediaDevices, 'enumerateDevices'>,
  visibility: DocumentVisibilityState
): Promise<MediaDeviceInfo[] | undefined> {
  if (visibility !== 'visible') return undefined;
  return devices.enumerateDevices();
}
