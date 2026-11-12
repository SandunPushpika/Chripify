import { describe, expect, it, vi } from 'vitest';
import { LatestFrames, OutputClock } from './compositor-core.js';

describe('bounded background frame ownership', () => {
  it('retains only the newest input per track and closes replaced frames', () => {
    const frames = new LatestFrames<{ close(): void }>();
    const screen = Array.from({ length: 100 }, () => ({ close: vi.fn() }));
    const camera = { close: vi.fn() };
    frames.replace('camera', camera);

    for (const frame of screen) frames.replace('screen', frame);

    for (const frame of screen.slice(0, -1)) expect(frame.close).toHaveBeenCalledOnce();

    expect(screen[99]?.close).not.toHaveBeenCalled();
    expect(frames.screen).toBe(screen[99]);
    frames.close();
    frames.close();
    expect(screen[99]?.close).toHaveBeenCalledOnce();
    expect(camera.close).toHaveBeenCalledOnce();
    expect(frames.screen).toBeUndefined();
    expect(frames.camera).toBeUndefined();
  });
});
describe('frame clock independent of document presentation', () => {
  it('advances camera motion on a static screen using the screen clock origin', () => {
    const clock = new OutputClock(30);
    expect(clock.next(100_000, 20)).toBe(100_000);
    expect(clock.next(100_000, 60)).toBe(140_000);
    expect(clock.next(100_000, 100)).toBe(180_000);
  });
  it('drops over-rate frames and keeps timestamps monotonic when source timestamps jump', () => {
    const clock = new OutputClock(30);
    expect(clock.next(2_000, 0)).toBe(2_000);
    expect(clock.next(9_000_000, 10)).toBeUndefined();
    expect(clock.next(10, 40)).toBe(42_000);
    expect(clock.next(100, 39)).toBeUndefined();
    expect(clock.next(1, 80)).toBe(82_000);
  });
  it('rejects invalid frame rates', () => {
    for (const value of [0, -1, Infinity, NaN]) expect(() => new OutputClock(value)).toThrow();
  });
});
