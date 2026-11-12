import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  canReadOverlay,
  defaultOptions,
  isControl,
  isLiveState,
  readOptions,
  validEnvelope,
} from './integration.js';
import { configureNativeBlur, keyAlpha } from './effects.js';

afterEach(() => vi.unstubAllGlobals());
describe('popup and browser overlay authority', () => {
  it('requires matching active-page origin and an explicit temporary grant', () => {
    const tab = { active: true, url: 'https://example.com/docs' };
    expect(
      canReadOverlay(tab, 'https://example.com/other', 8, false, {
        tabId: 8,
        origin: 'https://example.com',
      })
    ).toBe(true);
    expect(canReadOverlay(tab, 'https://example.com', 8, false)).toBe(false);
    expect(
      canReadOverlay(tab, 'https://example.com', 8, false, {
        tabId: 9,
        origin: 'https://example.com',
      })
    ).toBe(false);
  });
  it('rejects hidden tabs, stale origins and permission-redacted URLs even with website access', () => {
    expect(
      canReadOverlay({ active: false, url: 'https://example.com' }, 'https://example.com', 8, true)
    ).toBe(false);
    expect(canReadOverlay({ active: true }, 'https://example.com', 8, true)).toBe(false);
    expect(
      canReadOverlay({ active: true, url: 'https://private.test' }, 'https://example.com', 8, true)
    ).toBe(false);
    expect(
      canReadOverlay({ active: true, url: 'chrome://settings' }, 'chrome://settings', 8, true)
    ).toBe(false);
    expect(canReadOverlay({ active: true, url: 'https://example.com' }, 'bad url', 8, true)).toBe(
      false
    );
  });
  it('permits website-follow only for the actual same-origin active page', () => {
    expect(
      canReadOverlay(
        { active: true, url: 'https://new.test/path' },
        'https://new.test/path',
        12,
        true
      )
    ).toBe(true);
  });
  it('limits overlay controls to pause/resume/stop and rejects protocol mismatches', () => {
    expect(isControl('pause')).toBe(true);
    expect(isControl('resume')).toBe(true);
    expect(isControl('stop')).toBe(true);

    for (const command of ['start', 'download', 'delete', 'execute', null, {}])
      expect(isControl(command)).toBe(false);

    expect(validEnvelope({ version: 1, type: 'get-state' })).toBe(true);
    expect(validEnvelope({ version: 2, type: 'control' })).toBe(false);
    expect(validEnvelope({ version: 1, type: 5 })).toBe(false);
  });
  it('bounds camera payloads, elapsed values and warning text', () => {
    const state = { phase: 'recording', elapsed: 100, camera: true };
    expect(isLiveState({ ...state, frame: 'data:image/jpeg;base64,a' })).toBe(true);
    expect(isLiveState({ ...state, frame: 'https://remote.test/image' })).toBe(false);
    expect(isLiveState({ ...state, frame: 'data:image/jpeg;base64,' + 'a'.repeat(100000) })).toBe(
      false
    );
    expect(isLiveState({ ...state, elapsed: Infinity })).toBe(false);
    expect(isLiveState({ ...state, warning: 'a'.repeat(1001) })).toBe(false);
  });
  it('preserves older settings and validates effects at the preference boundary', () => {
    expect(readOptions(undefined)).toEqual(defaultOptions());
    expect(readOptions({ fps: 15, camera: true }).effect).toBe('original');
    expect(() => readOptions({ microphone: 'yes' })).toThrow();
    expect(() => readOptions({ effect: 'remote-code' })).toThrow();
    expect(() => readOptions({ keyColor: 'url(evil)' })).toThrow();
    expect(() => readOptions({ keyTolerance: -5 })).toThrow();
    expect(() => readOptions({ camera: true, effect: 'green-image' })).toThrow('image');
    expect(() => readOptions({ backgroundImage: 'data:image/svg+xml;base64,abc' })).toThrow();
    expect(() => readOptions({ backgroundImage: 'https://remote.test/bg.png' })).toThrow();
  });
});
describe('local camera effects', () => {
  it('removes the keyed background, preserves different colors and feathers boundaries', () => {
    expect(keyAlpha(0, 255, 0, [0, 255, 0], 90)).toBe(0);
    expect(keyAlpha(210, 150, 130, [0, 255, 0], 90)).toBe(1);
    expect(keyAlpha(110, 255, 0, [0, 255, 0], 90)).toBeCloseTo(20 / 35);
    expect(keyAlpha(255, 255, 255, [0, 255, 0], 10)).toBeGreaterThanOrEqual(0);
  });
  const blurOptions = { ...defaultOptions(), camera: true, effect: 'native-blur' as const };
  it('applies native blur only when the camera advertises it', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    const warn = vi.fn();
    await configureNativeBlur(
      {
        getCapabilities: () => ({ backgroundBlur: [false, true] }),
        applyConstraints,
      } as unknown as MediaStreamTrack,
      blurOptions,
      warn
    );
    expect(applyConstraints).toHaveBeenCalledWith({ backgroundBlur: true });
    expect(warn).not.toHaveBeenCalled();
  });
  it('reports unsupported blur and failed native effects without pretending to segment a person', async () => {
    const warn = vi.fn();
    await configureNativeBlur(
      { getCapabilities: () => ({}) } as unknown as MediaStreamTrack,
      blurOptions,
      warn
    );
    expect(warn).toHaveBeenCalledOnce();
    await configureNativeBlur(
      {
        getCapabilities: () => ({ backgroundBlur: [true] }),
        applyConstraints: vi.fn().mockRejectedValue(new Error('unsupported')),
      } as unknown as MediaStreamTrack,
      blurOptions,
      warn
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
