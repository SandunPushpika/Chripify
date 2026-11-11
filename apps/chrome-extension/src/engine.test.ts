import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChunkWriter, RecorderEngine, SessionClock } from './engine.js';
import { MAX_PENDING_BYTES, type Options, type Recording } from './domain.js';
import { acquire } from './media.js';
import type { Library } from './storage.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('local recording clock and chunk backpressure', () => {
  it('excludes paused time and makes repeated pause/resume idempotent', () => {
    let now = 0;
    const clock = new SessionClock(() => now);
    clock.resume();
    now = 1000;
    clock.pause();
    clock.pause();
    now = 5000;
    expect(clock.elapsed()).toBe(1000);
    clock.resume();
    clock.resume();
    now = 6000;
    expect(clock.elapsed()).toBe(2000);
  });
  it('writes chunks in order and waits for durable writes', async () => {
    const writes: number[] = [];
    const writer = new ChunkWriter(async (index) => {
      writes.push(index);
    }, vi.fn());
    writer.write(new Blob(['first']));
    writer.write(new Blob());
    writer.write(new Blob(['second']));
    await writer.finish();
    expect(writes).toEqual([0, 1]);
  });
  it('stops accepting chunks after storage fails', async () => {
    const error = new DOMException('full', 'QuotaExceededError');
    const append = vi.fn().mockRejectedValue(error);
    const failed = vi.fn();
    const writer = new ChunkWriter(append, failed);
    writer.write(new Blob(['one']));
    await expect(writer.finish()).rejects.toBe(error);
    writer.write(new Blob(['two']));
    expect(append).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
  });
  it('enforces a bounded pending write queue', async () => {
    const failed = vi.fn();
    const writer = new ChunkWriter(vi.fn(), failed);
    writer.write({ size: MAX_PENDING_BYTES + 1 } as Blob);
    expect(failed).toHaveBeenCalledTimes(1);
    await expect(writer.finish()).rejects.toThrow('cannot keep up');
  });
  it('releases a stream that resolves after the permission timeout', async () => {
    vi.useFakeTimers();
    let complete: (stream: MediaStream) => void = () => undefined;
    const stop = vi.fn();
    const pending = acquire(
      new Promise((resolve) => {
        complete = resolve;
      }),
      100
    );
    const rejected = expect(pending).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    complete({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
});

class FakeTrack extends EventTarget {
  kind = 'video';
  readyState = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  getSettings() {
    return { width: 1280, height: 720 };
  }
  applyConstraints = vi.fn().mockResolvedValue(undefined);
}
class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
}
class FakeRecorder {
  static isTypeSupported = () => true;
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['synthetic-test-chunk']) });
      this.onstop?.(new Event('stop'));
    });
  }
}
function fixture(quota = 1024 ** 3) {
  const track = new FakeTrack();
  const stream = new FakeStream([track]);
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  const getDisplayMedia = vi.fn().mockResolvedValue(stream);
  const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
  vi.stubGlobal('navigator', {
    mediaDevices: { getDisplayMedia, getUserMedia },
    storage: { estimate: vi.fn().mockResolvedValue({ quota, usage: 0 }) },
  });
  const rows: Recording[] = [];
  const store = {
    create: vi.fn(async (record: Recording) => {
      rows.push({ ...record });
    }),
    append: vi.fn(async (id: string, _index: number, blob: Blob) => {
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.bytes += blob.size;
        row.chunkCount++;
      }
    }),
    list: vi.fn(async () => rows),
    update: vi.fn(async (id: string, changes: Partial<Recording>) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, changes);
    }),
  };
  const events = {
    changed: vi.fn(),
    preview: vi.fn(),
    warning: vi.fn(),
    saved: vi.fn(),
    failed: vi.fn(),
  };
  const engine = new RecorderEngine(store as unknown as Library, events);
  const options: Options = {
    microphone: false,
    sharedAudio: false,
    camera: false,
    microphoneId: '',
    cameraId: '',
    fps: 30,
    maxHeight: 1080,
    microphoneGain: 1,
    sharedGain: 1,
  };
  return { engine, options, track, store, events, rows, getDisplayMedia, getUserMedia };
}
describe('recording workflow using simulated Chrome media devices', () => {
  it('counts down after browser restoration and only then starts recording', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const encode = vi.spyOn(FakeRecorder.prototype, 'start');
    const restored = vi.fn().mockResolvedValue(undefined);
    const starting = f.engine.start(f.options, undefined, restored);
    await vi.advanceTimersByTimeAsync(0);
    expect(restored).toHaveBeenCalledOnce();
    for (const remaining of [3, 2, 1]) {
      expect(f.engine.preparationStage).toBe(`Recording starts in ${remaining}…`);
      expect(f.engine.phase).toBe('preparing');
      expect(f.engine.elapsed).toBe(0);
      expect(encode).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
    }
    await starting;
    expect(encode).toHaveBeenCalledOnce();
    expect(f.engine.phase).toBe('recording');
    await f.engine.stop();
  });
  it('cancels the countdown without starting the encoder or leaving active devices', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const encode = vi.spyOn(FakeRecorder.prototype, 'start');
    const starting = f.engine.start(f.options);
    const rejected = expect(starting).rejects.toHaveProperty('name', 'AbortError');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.engine.preparationStage).toBe('Recording starts in 2…');
    await f.engine.stop();
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(encode).not.toHaveBeenCalled();
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.engine.phase).toBe('idle');
    expect(f.events.saved).not.toHaveBeenCalled();
  });
  it('returns to the requested browser before starting the encoder', async () => {
    const f = fixture();
    const order: string[] = [];
    vi.spyOn(FakeRecorder.prototype, 'start').mockImplementation(function (this: FakeRecorder) {
      order.push('encode');
      this.state = 'recording';
    });
    await f.engine.start(f.options, undefined, async () => {
      expect(f.engine.phase).toBe('preparing');
      order.push('restore-browser');
    });
    expect(order).toEqual(['restore-browser', 'encode']);
    await f.engine.stop();
  });
  it('does not encode if the browser-return handshake fails', async () => {
    const f = fixture();
    const start = vi.spyOn(FakeRecorder.prototype, 'start');
    await expect(
      f.engine.start(f.options, undefined, async () => {
        throw new Error('tab closed');
      })
    ).rejects.toThrow('tab closed');
    expect(start).not.toHaveBeenCalled();
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.engine.phase).toBe('idle');
  });
  it('cancels pending camera permission and stops a camera stream arriving afterward', async () => {
    const f = fixture();
    let deliver: (stream: FakeStream) => void = () => undefined;
    f.getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        })
    );
    const starting = f.engine.start({ ...f.options, camera: true });
    const rejected = expect(starting).rejects.toHaveProperty('name', 'AbortError');
    await vi.waitFor(() => expect(f.getUserMedia).toHaveBeenCalledOnce());
    await f.engine.stop();
    await rejected;
    const camera = new FakeTrack();
    deliver(new FakeStream([camera]));
    await Promise.resolve();
    expect(camera.stop).toHaveBeenCalledOnce();
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.engine.phase).toBe('idle');
    expect(f.events.changed).not.toHaveBeenCalledWith('recording');
  });
  it('leaves preparing and releases capture when storage checking never completes', async () => {
    vi.useFakeTimers();
    const f = fixture();
    vi.spyOn(navigator.storage, 'estimate').mockImplementation(() => new Promise(() => undefined));
    const starting = f.engine.start(f.options);
    const rejected = expect(starting).rejects.toThrow('storage did not respond');
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(f.engine.phase).toBe('idle');
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.store.create).not.toHaveBeenCalled();
  });
  it('accepts an explicitly selected popup source without opening a second screen picker', async () => {
    const f = fixture();
    const source = vi.fn().mockResolvedValue(new FakeStream([f.track]));
    await f.engine.start(f.options, source);
    expect(source).toHaveBeenCalledOnce();
    expect(f.getDisplayMedia).not.toHaveBeenCalled();
    await f.engine.stop();
    expect(f.rows[0]?.state).toBe('complete');
  });
  it('bounds blocked audio startup and releases both requested devices', async () => {
    vi.useFakeTimers();
    const close = vi.fn().mockResolvedValue(undefined);
    class BlockedAudio {
      resume = () => new Promise<void>(() => undefined);
      close = close;
    }
    vi.stubGlobal('AudioContext', BlockedAudio);
    const f = fixture();
    const microphone = new FakeTrack();
    microphone.kind = 'audio';
    f.getUserMedia.mockResolvedValue(new FakeStream([microphone]));
    const start = f.engine.start({ ...f.options, microphone: true });
    const rejected = expect(start).rejects.toThrow('blocked audio');
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(close).toHaveBeenCalled();
    expect(microphone.stop).toHaveBeenCalled();
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.store.create).not.toHaveBeenCalled();
  });
  it('does not start an encoder after sharing ends during metadata creation', async () => {
    const f = fixture();
    f.store.create.mockImplementation(async (record) => {
      f.rows.push({ ...record });
      f.track.readyState = 'ended';
      f.track.dispatchEvent(new Event('ended'));
    });
    await expect(f.engine.start(f.options)).rejects.toThrow('ended before recording');
    expect(f.engine.phase).toBe('idle');
    expect(f.rows[0]?.state).toBe('interrupted');
    expect(f.events.saved).not.toHaveBeenCalled();
    expect(f.track.stop).toHaveBeenCalled();
  });
  it('finalizes when Chrome ends sharing outside the recorder controls', async () => {
    const f = fixture();
    await f.engine.start(f.options);
    f.track.readyState = 'ended';
    f.track.dispatchEvent(new Event('ended'));
    await f.engine.stop();
    expect(f.rows[0]?.state).toBe('complete');
    expect(f.engine.phase).toBe('idle');
    expect(f.track.stop).toHaveBeenCalled();
  });
  it('releases the shared display when camera permission is denied', async () => {
    const f = fixture();
    await expect(f.engine.start({ ...f.options, camera: true })).rejects.toHaveProperty(
      'name',
      'NotAllowedError'
    );
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.getUserMedia).toHaveBeenCalledOnce();
    expect(f.store.create).not.toHaveBeenCalled();
  });
  it('marks an encoder that never acknowledges stop as interrupted and releases devices', async () => {
    vi.useFakeTimers();
    vi.spyOn(FakeRecorder.prototype, 'stop').mockImplementation(function (this: FakeRecorder) {
      this.state = 'inactive';
    });
    const f = fixture();
    const starting = f.engine.start(f.options);
    await vi.advanceTimersByTimeAsync(3000);
    await starting;
    const completion = f.engine.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    await completion;
    expect(f.engine.phase).toBe('idle');
    expect(f.rows[0]?.state).toBe('interrupted');
    expect(f.events.saved).not.toHaveBeenCalled();
    expect(f.events.failed).toHaveBeenCalledOnce();
    expect(f.track.stop).toHaveBeenCalled();
  });
  it('starts, pauses, resumes and completes only after chunks persist', async () => {
    const f = fixture();
    await f.engine.start(f.options);
    expect(f.engine.phase).toBe('recording');
    await expect(f.engine.start(f.options)).rejects.toThrow('already active');
    f.engine.pause();
    expect(f.engine.phase).toBe('paused');
    f.engine.resume();
    await Promise.all([f.engine.stop(), f.engine.stop()]);
    expect(f.engine.phase).toBe('idle');
    expect(f.rows[0]?.state).toBe('complete');
    expect(f.store.append).toHaveBeenCalledOnce();
    expect(f.events.saved).toHaveBeenCalledOnce();
    expect(f.track.stop).toHaveBeenCalled();
  });
  it('releases capture if storage quota is low before encoding', async () => {
    const f = fixture(1);
    await expect(f.engine.start(f.options)).rejects.toThrow('128 MiB');
    expect(f.engine.phase).toBe('idle');
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.store.create).not.toHaveBeenCalled();
  });
  it('returns to idle after permission cancellation without creating a recording', async () => {
    const f = fixture();
    f.getDisplayMedia.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));
    await expect(f.engine.start(f.options)).rejects.toHaveProperty('name', 'NotAllowedError');
    expect(f.engine.phase).toBe('idle');
    expect(f.store.create).not.toHaveBeenCalled();
  });
  it('does not mark failed writes as complete', async () => {
    const f = fixture();
    f.store.append.mockRejectedValue(new Error('storage failed'));
    await f.engine.start(f.options);
    await f.engine.stop();
    expect(f.rows[0]?.state).toBe('interrupted');
    expect(f.events.saved).not.toHaveBeenCalled();
    expect(f.events.failed).toHaveBeenCalledOnce();
    expect(f.track.stop).toHaveBeenCalled();
  });
});
