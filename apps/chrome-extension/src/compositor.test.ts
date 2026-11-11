import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerCompositor } from './compositor.js';
import { defaultOptions } from './integration.js';
import type { CompositorEvent, CompositorInit } from './compositor-protocol.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture(ready = true, failConstruction = false) {
  const generated: Generator[] = [];
  const workers: FakeWorker[] = [];
  const processors: Array<{ maxBufferSize: number }> = [];
  class Generator {
    writable = new WritableStream<VideoFrame>();
    stop = vi.fn();
    constructor() {
      generated.push(this);
    }
  }
  class Processor {
    readable = new ReadableStream<VideoFrame>();
    constructor(options: { track: MediaStreamTrack; maxBufferSize: number }) {
      processors.push(options);
    }
  }
  class FakeWorker {
    onmessage: ((event: MessageEvent<CompositorEvent>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = vi.fn();
    postMessage = vi.fn((message: { type: string }) => {
      if (ready && message.type === 'start')
        queueMicrotask(() =>
          this.onmessage?.({
            data: { type: 'ready', width: 1280, height: 720 },
          } as MessageEvent<CompositorEvent>)
        );
    });
    constructor() {
      if (failConstruction) throw new Error('Worker unavailable');
      workers.push(this);
    }
  }
  vi.stubGlobal('document', undefined);
  vi.stubGlobal('MediaStreamTrackGenerator', Generator);
  vi.stubGlobal('MediaStreamTrackProcessor', Processor);
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('VideoFrame', class {});
  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  return { generated, workers, processors, track };
}
describe('worker compositor browser adapter', () => {
  it('transfers bounded native streams and becomes ready without an HTML preview', async () => {
    const f = fixture();
    const failed = vi.fn();
    const compositor = new WorkerCompositor(failed);
    await compositor.start(f.track, f.track, { ...defaultOptions(), camera: true });
    expect(compositor.width).toBe(1280);
    expect(compositor.height).toBe(720);
    expect(f.processors.map((p) => p.maxBufferSize)).toEqual([1, 1]);
    const call = f.workers[0]?.postMessage.mock.calls[0];
    expect((call?.[0] as CompositorInit).screen).toBeInstanceOf(ReadableStream);
    expect(failed).not.toHaveBeenCalled();
    compositor.dispose();
    compositor.dispose();
    expect(f.workers[0]?.terminate).toHaveBeenCalledOnce();
    for (const track of f.generated) expect(track.stop).toHaveBeenCalledOnce();
  });
  it('cleans generated tracks if a worker cannot be constructed', () => {
    const f = fixture(false, true);
    expect(() => new WorkerCompositor(vi.fn())).toThrow('Worker unavailable');
    expect(f.generated).toHaveLength(2);
    for (const track of f.generated) expect(track.stop).toHaveBeenCalledOnce();
  });
  it('times out and terminates a worker that never produces a frame', async () => {
    vi.useFakeTimers();
    const f = fixture(false);
    const compositor = new WorkerCompositor(vi.fn());
    const starting = compositor.start(f.track, f.track, defaultOptions());
    const rejected = expect(starting).rejects.toThrow('did not receive frames');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    expect(f.workers[0]?.terminate).toHaveBeenCalledOnce();
    for (const track of f.generated) expect(track.stop).toHaveBeenCalledOnce();
  });
  it('fails explicitly when background frame APIs are unavailable', () => {
    const f = fixture();
    vi.stubGlobal('MediaStreamTrackProcessor', undefined);
    expect(() => new WorkerCompositor(vi.fn())).toThrow('Camera overlay off');
    expect(f.generated).toHaveLength(0);
    expect(f.workers).toHaveLength(0);
  });
});
