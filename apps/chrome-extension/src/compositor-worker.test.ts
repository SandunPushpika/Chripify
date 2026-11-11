import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositorCommand, CompositorEvent, CompositorInit } from './compositor-protocol.js';
import { defaultBubble } from './compositor-protocol.js';
import { defaultOptions } from './integration.js';

class Frame {
  displayWidth: number;
  displayHeight: number;
  timestamp: number;
  close = vi.fn();
  constructor(source: { width: number; height: number }, init: { timestamp: number }) {
    this.displayWidth = source.width;
    this.displayHeight = source.height;
    this.timestamp = init.timestamp;
  }
}
class Canvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return {
      filter: 'none',
      fillStyle: '',
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      roundRect: vi.fn(),
      clip: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    };
  }
  convertToBlob() {
    return Promise.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }));
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture(blockWrite = false) {
  vi.resetModules();
  let wall = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => wall);
  const post = vi.fn<(event: CompositorEvent) => void>();
  vi.stubGlobal('document', undefined);
  vi.stubGlobal('postMessage', post);
  vi.stubGlobal('onmessage', null);
  vi.stubGlobal('OffscreenCanvas', Canvas);
  vi.stubGlobal('VideoFrame', Frame);
  await import('./compositor-worker.js');
  const scope = globalThis as typeof globalThis & {
    onmessage(event: MessageEvent<CompositorCommand>): void;
  };
  let screen!: ReadableStreamDefaultController<VideoFrame>;
  let camera!: ReadableStreamDefaultController<VideoFrame>;
  const written: Frame[] = [];
  const cameraWritten: Frame[] = [];
  let release: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const source: CompositorInit = {
    type: 'start',
    options: { ...defaultOptions(), camera: true },
    bubble: defaultBubble(),
    screen: new ReadableStream({
      start(controller) {
        screen = controller;
      },
    }),
    camera: new ReadableStream({
      start(controller) {
        camera = controller;
      },
    }),
    output: new WritableStream({
      write(frame) {
        written.push(frame as unknown as Frame);
        if (blockWrite && written.length === 1) return blocked;
      },
    }),
    cameraOutput: new WritableStream({
      write(frame) {
        cameraWritten.push(frame as unknown as Frame);
      },
    }),
  };
  const send = (message: CompositorCommand) =>
    scope.onmessage({ data: message } as MessageEvent<CompositorCommand>);
  send(source);
  const frame = (timestamp: number) => new Frame({ width: 1280, height: 720 }, { timestamp });
  return {
    screen,
    camera,
    post,
    written,
    cameraWritten,
    release,
    send,
    frame,
    time: (now: number) => {
      wall = now;
    },
  };
}
describe('dedicated worker compositor with simulated native frames', () => {
  it('keeps recording new frames with no document or video presentation callbacks', async () => {
    const f = await fixture();
    const screen = f.frame(100_000);
    const camera = f.frame(5);
    f.screen.enqueue(screen as unknown as VideoFrame);
    f.camera.enqueue(camera as unknown as VideoFrame);
    await vi.waitFor(() => expect(f.written).toHaveLength(1));
    f.time(40);
    f.camera.enqueue(f.frame(6) as unknown as VideoFrame);
    await vi.waitFor(() => expect(f.written).toHaveLength(2));
    expect(f.written.map((frame) => frame.timestamp)).toEqual([100_000, 140_000]);
    expect(camera.close).toHaveBeenCalledOnce();
    f.time(80);
    f.screen.enqueue(f.frame(180_000) as unknown as VideoFrame);
    await vi.waitFor(() => expect(f.written).toHaveLength(3));
    f.send({ type: 'stop' });
    expect(screen.close).toHaveBeenCalledOnce();
    for (const output of f.written) expect(output.close).toHaveBeenCalledOnce();
  });
  it('signals readiness before sink acknowledgment and drops stale input under backpressure', async () => {
    const f = await fixture(true);
    f.screen.enqueue(f.frame(1000) as unknown as VideoFrame);
    f.camera.enqueue(f.frame(1) as unknown as VideoFrame);
    await vi.waitFor(() => expect(f.written).toHaveLength(1));
    expect(f.post).toHaveBeenCalledWith({ type: 'ready', width: 1280, height: 720 });
    const replacements = Array.from({ length: 20 }, (_value, i) => f.frame(2000 + i));
    f.time(100);
    for (const frame of replacements) f.screen.enqueue(frame as unknown as VideoFrame);
    await vi.waitFor(() => expect(replacements[18]?.close).toHaveBeenCalledOnce());
    expect(f.written).toHaveLength(1);
    expect(replacements[19]?.close).not.toHaveBeenCalled();
    f.release();
    await vi.waitFor(() => expect(f.written).toHaveLength(2));
    f.send({ type: 'stop' });
    expect(replacements[19]?.close).toHaveBeenCalledOnce();
  });
  it('reports a source ending instead of leaving an apparently live frozen frame', async () => {
    const f = await fixture();
    f.screen.close();
    await vi.waitFor(() =>
      expect(f.post).toHaveBeenCalledWith({
        type: 'error',
        message: 'Screen frames stopped arriving.',
      })
    );
  });
});
