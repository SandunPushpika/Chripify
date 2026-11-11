export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Recording preparation cancelled.', 'AbortError');
}

/** Keep the encoder stopped for three full, cancellable countdown steps. */
export async function recordingCountdown(
  signal: AbortSignal,
  show: (remaining: number) => void
): Promise<void> {
  for (const remaining of [3, 2, 1]) {
    if (signal.aborted) throw abortReason(signal);
    show(remaining);
    await new Promise<void>((resolve, reject) => {
      const cancelled = () => {
        clearTimeout(timer);
        reject(abortReason(signal));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancelled);
        resolve();
      }, 1000);
      signal.addEventListener('abort', cancelled, { once: true });
    });
  }
  if (signal.aborted) throw abortReason(signal);
}

/** Bound browser operations without leaving rejected late promises unobserved. */
export function waitFor<T>(
  promise: Promise<T>,
  timeoutMs: number,
  error: string,
  signal?: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (success: boolean, value: T | unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      if (success) resolve(value as T);
      else reject(value);
    };
    const cancelled = () => finish(false, signal ? abortReason(signal) : new Error(error));
    promise.then(
      (value) => finish(true, value),
      (reason) => finish(false, reason)
    );
    const timer = setTimeout(() => finish(false, new Error(error)), timeoutMs);
    if (signal?.aborted) {
      cancelled();
      return;
    }
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}
