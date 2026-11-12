import { afterEach, describe, expect, it, vi } from 'vitest';
import { canStart, elapsed, errorMessage, invoke } from './contracts';

afterEach(() => {
  vi.unstubAllGlobals();
});
describe('recording presentation rules', () => {
  it('never enables a second session while one is active', () => {
    for (const phase of ['preparing', 'recording', 'paused', 'finalizing'] as const)
      expect(canStart(phase)).toBe(false);

    for (const phase of ['idle', 'completed', 'failed', 'cancelled'] as const)
      expect(canStart(phase)).toBe(true);
  });
  it('formats elapsed time and tolerates clock skew', () => {
    expect(elapsed(null, 1000)).toBe('00:00');
    expect(elapsed(100, 95000)).toBe('00:00');
    expect(elapsed(100, 165000)).toBe('01:05');
  });
  it('handles typed IPC and unexpected failures without dumping objects', () => {
    expect(errorMessage({ code: 'permission', message: 'Access denied' })).toBe('Access denied');
    expect(errorMessage(undefined)).toBe('Something went wrong. Please try again.');
  });
});

describe('desktop IPC boundary', () => {
  it('rejects browser recording instead of simulating native success', async () => {
    vi.stubGlobal('window', {});
    await expect(invoke('start_recording', { request: { displayId: 1, fps: 30 } })).rejects.toThrow(
      'Open the desktop app'
    );
  });
  it('passes structured capture settings to the native API', async () => {
    const nativeInvoke = vi
      .fn()
      .mockResolvedValue({ phase: 'preparing', startedAt: null, error: null });
    vi.stubGlobal('window', { __TAURI__: { core: { invoke: nativeInvoke } } });
    const result = await invoke('start_recording', { request: { displayId: 1, fps: 30 } });
    expect(nativeInvoke).toHaveBeenCalledExactlyOnceWith('start_recording', {
      request: { displayId: 1, fps: 30 },
    });
    expect(result.phase).toBe('preparing');
  });
});
