import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseDesktopSource, enumerateVisibleDevices } from './desktop-source.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Callback = (id: string, options: { canRequestAudioTrack: boolean }) => void;

function fixture() {
  const choose =
    vi.fn<
      (sources: string[], target: { id?: number; url?: string }, callback: Callback) => number
    >();
  const cancel = vi.fn();
  const runtime = {
    getURL: (path: string) => `chrome-extension://test/${path}`,
    lastError: undefined as { message?: string } | undefined,
  };
  vi.stubGlobal('chrome', {
    runtime,
    desktopCapture: { chooseDesktopMedia: choose, cancelChooseDesktopMedia: cancel },
  });
  const target = { id: 17, url: runtime.getURL('recorder.html'), active: false, windowId: 4 };

  return { choose, cancel, runtime, target };
}

describe('toolbar desktop picker regression', () => {
  it('cancels the browser picker when preparation is cancelled', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.choose.mockReturnValue(8);
    const chosen = chooseDesktopSource(f.target, true, 120_000, controller.signal);
    controller.abort(new DOMException('User cancelled.', 'AbortError'));
    await expect(chosen).rejects.toHaveProperty('name', 'AbortError');
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(8);
  });
  it('passes the consuming recorder tab, including its extension URL, as the required second argument', async () => {
    const f = fixture();
    f.choose.mockImplementation((_sources, _target, callback) => {
      queueMicrotask(() => callback('opaque-source', { canRequestAudioTrack: true }));

      return 8;
    });
    await expect(chooseDesktopSource(f.target, true)).resolves.toEqual({
      streamId: 'opaque-source',
      audio: true,
    });
    expect(f.choose).toHaveBeenCalledWith(
      ['screen', 'window', 'tab', 'audio'],
      f.target,
      expect.any(Function)
    );
    expect(f.cancel).not.toHaveBeenCalled();
  });
  it('rejects a website or missing target before asking Chrome for capture', async () => {
    const f = fixture();

    for (const target of [
      {},
      { id: -1, url: f.target.url },
      { id: 3, url: 'https://example.com' },
    ]) {
      await expect(chooseDesktopSource(target, true)).rejects.toThrow('recording tab');
    }

    expect(f.choose).not.toHaveBeenCalled();
  });
  it('preserves picker cancellation without starting a stream', async () => {
    const f = fixture();
    f.choose.mockImplementation((_sources, _target, callback) => {
      queueMicrotask(() => callback('', { canRequestAudioTrack: false }));

      return 8;
    });
    await expect(chooseDesktopSource(f.target, true)).rejects.toHaveProperty(
      'name',
      'NotAllowedError'
    );
  });
  it('surfaces Chrome runtime picker errors instead of treating them as cancellation', async () => {
    const f = fixture();
    f.choose.mockImplementation((_sources, _target, callback) => {
      queueMicrotask(() => {
        f.runtime.lastError = { message: 'Native picker failed' };
        callback('', { canRequestAudioTrack: false });
        f.runtime.lastError = undefined;
      });

      return 8;
    });
    await expect(chooseDesktopSource(f.target, true)).rejects.toThrow('Native picker failed');
  });
  it('handles a synchronous picker failure and synchronous callbacks without leaking a timer', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.choose.mockImplementation(() => {
      throw new Error('API unavailable');
    });
    await expect(chooseDesktopSource(f.target, true)).rejects.toThrow('API unavailable');
    f.choose.mockImplementation((_sources, _target, callback) => {
      callback('source', { canRequestAudioTrack: true });

      return 8;
    });
    await expect(chooseDesktopSource(f.target, false)).resolves.toEqual({
      streamId: 'source',
      audio: false,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(f.choose.mock.calls[1]?.[0]).toEqual(['screen', 'window', 'tab']);
  });
  it('cancels a timed-out chooser once and ignores late callbacks', async () => {
    vi.useFakeTimers();
    const f = fixture();

    let respond: Callback = () => undefined;

    f.choose.mockImplementation((_sources, _target, callback) => {
      respond = callback;

      return 8;
    });
    const chosen = chooseDesktopSource(f.target, true, 100);
    const rejected = expect(chosen).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    respond('late-source', { canRequestAudioTrack: true });
    expect(f.cancel).toHaveBeenCalledExactlyOnceWith(8);
    expect(vi.getTimerCount()).toBe(0);
  });
});
describe('hidden recorder startup regression', () => {
  it('does not call an enumeration API that waits for visibility while the owner tab is hidden', async () => {
    const enumerateDevices = vi.fn(() => new Promise<MediaDeviceInfo[]>(() => undefined));
    await expect(enumerateVisibleDevices({ enumerateDevices }, 'hidden')).resolves.toBeUndefined();
    expect(enumerateDevices).not.toHaveBeenCalled();
  });
  it('still lists device choices in a visible main app', async () => {
    const enumerateDevices = vi
      .fn()
      .mockResolvedValue([{ deviceId: 'camera', kind: 'videoinput' }]);
    await expect(enumerateVisibleDevices({ enumerateDevices }, 'visible')).resolves.toEqual([
      { deviceId: 'camera', kind: 'videoinput' },
    ]);
    expect(enumerateDevices).toHaveBeenCalledOnce();
  });
});
