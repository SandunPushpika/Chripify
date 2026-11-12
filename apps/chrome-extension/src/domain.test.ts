import { describe, expect, it } from 'vitest';
import {
  chooseMime,
  clock,
  message,
  transition,
  validBadge,
  validateOptions,
  validateTitle,
  type Options,
} from './domain.js';

const options: Options = {
  microphone: false,
  camera: false,
  sharedAudio: false,
  microphoneId: '',
  cameraId: '',
  fps: 30,
  maxHeight: 1080,
  microphoneGain: 1,
  sharedGain: 1,
};
describe('extension trust boundaries and lifecycle', () => {
  it('accepts recording, pause, resume and finalization in order', () => {
    let phase = transition('idle', 'preparing');

    for (const next of ['recording', 'paused', 'recording', 'stopping', 'idle'] as const)
      phase = transition(phase, next);

    expect(phase).toBe('idle');
    expect(() => transition('recording', 'preparing')).toThrow();
    expect(() => transition('paused', 'idle')).toThrow();
  });
  it('rejects unsupported encoder settings and non-finite gain', () => {
    expect(() => validateOptions(options)).not.toThrow();

    for (const invalid of [
      { fps: 240 },
      { maxHeight: 20000 },
      { microphoneGain: NaN },
      { sharedGain: -1 },
    ])
      expect(() => validateOptions({ ...options, ...invalid })).toThrow();
  });
  it('validates titles while treating markup as plain text', () => {
    expect(validateTitle('  Demo <script>  ')).toBe('Demo <script>');

    for (const title of ['', '\u0000name', 'x'.repeat(121)])
      expect(() => validateTitle(title)).toThrow();
  });
  it('negotiates supported local codecs and fails explicitly if none exists', () => {
    expect(chooseMime((mime) => mime.includes('vp8'))).toBe('video/webm;codecs=vp8,opus');
    expect(() => chooseMime(() => false)).toThrow();
  });
  it('rejects unauthorized message schemas and future protocol versions', () => {
    expect(validBadge({ version: 1, type: 'status', phase: 'recording' })).toBe(true);

    for (const value of [
      null,
      {},
      { version: 2, type: 'status', phase: 'recording' },
      { version: 1, type: 'status', phase: 'idle', command: 'capture' },
      { version: 1, type: 'status', phase: 'unknown' },
    ])
      expect(validBadge(value)).toBe(false);
  });
  it('maps permission cancellation and formats elapsed time', () => {
    expect(message(new DOMException('private framework detail', 'NotAllowedError'))).toContain(
      'cancelled'
    );
    expect(message(new DOMException('private detail', 'QuotaExceededError'))).toContain(
      'storage is full'
    );
    expect(clock(-1000)).toBe('00:00');
    expect(clock(65_999)).toBe('01:05');
  });
});
