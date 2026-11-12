import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from './lifecycle.js';
import { acquire } from './media.js';

afterEach(() => vi.useRealTimers());
describe('bounded/cancellable recording startup', () => {
  it('removes deadlines after success and propagates native failures', async () => {
    vi.useFakeTimers();
    await expect(waitFor(Promise.resolve(7), 100, 'timeout')).resolves.toBe(7);
    await expect(
      waitFor(Promise.reject(new Error('native failure')), 100, 'timeout')
    ).rejects.toThrow('native failure');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('times out a stalled browser operation and observes its late rejection', async () => {
    vi.useFakeTimers();

    let fail: (error: Error) => void = () => undefined;

    const waiting = waitFor(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
      100,
      'storage timed out'
    );
    const rejected = expect(waiting).rejects.toThrow('storage timed out');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    fail(new Error('late failure'));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts preparation immediately without waiting for a browser API deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const waiting = waitFor(new Promise(() => undefined), 60_000, 'timeout', controller.signal);
    controller.abort(new DOMException('User cancelled.', 'AbortError'));
    await expect(waiting).rejects.toHaveProperty('name', 'AbortError');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops tracks returned after device acquisition has been cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const stop = vi.fn();

    let deliver: (stream: MediaStream) => void = () => undefined;

    const waiting = acquire(
      new Promise((resolve) => {
        deliver = resolve;
      }),
      60_000,
      controller.signal
    );
    controller.abort();
    await expect(waiting).rejects.toHaveProperty('name', 'AbortError');
    deliver({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
