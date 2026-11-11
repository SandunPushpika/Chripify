import type { Options } from './domain.js';
import {
  defaultBubble,
  type Bubble,
  type CompositorEvent,
  type CompositorInit,
} from './compositor-protocol.js';
import { waitFor } from './lifecycle.js';

interface Processor {
  readable: ReadableStream<VideoFrame>;
}
interface GeneratedTrack extends MediaStreamTrack {
  writable: WritableStream<VideoFrame>;
}
interface FrameApi {
  MediaStreamTrackProcessor?: new (options: {
    track: MediaStreamTrack;
    maxBufferSize: number;
  }) => Processor;
  MediaStreamTrackGenerator?: new (options: { kind: 'video' }) => GeneratedTrack;
}

export class WorkerCompositor {
  readonly videoTrack: GeneratedTrack;
  readonly cameraTrack: GeneratedTrack;
  width = 0;
  height = 0;
  private readonly worker: Worker;
  private active = true;
  private failed = false;
  private readonly ready: Promise<void>;
  private readyResolve: () => void = () => undefined;
  private readyReject: (reason: Error) => void = () => undefined;
  private previewAt: number | undefined;
  private previewReader: FileReader | undefined;
  private cachedFrame: string | undefined;

  constructor(private readonly onFailure: (error: Error) => void) {
    const api = globalThis as typeof globalThis & FrameApi;
    if (
      !api.MediaStreamTrackProcessor ||
      !api.MediaStreamTrackGenerator ||
      typeof OffscreenCanvas === 'undefined' ||
      typeof VideoFrame === 'undefined'
    ) {
      throw new Error(
        'This Chrome configuration cannot process camera recording in the background. Update Chrome, or record with Camera overlay off.'
      );
    }
    const video = new api.MediaStreamTrackGenerator({ kind: 'video' });
    let camera: GeneratedTrack | undefined;
    try {
      camera = new api.MediaStreamTrackGenerator({ kind: 'video' });
      this.worker = new Worker(new URL('./compositor-worker.js', import.meta.url), {
        type: 'module',
      });
    } catch (error) {
      video.stop();
      camera?.stop();
      throw error;
    }
    this.videoTrack = video;
    this.cameraTrack = camera;
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // Ready can fail before start() attaches its deadline listener.
    void this.ready.catch(() => undefined);
    this.worker.onmessage = (event: MessageEvent<CompositorEvent>) => {
      if (!this.active) return;
      const value = event.data;
      if (value.type === 'ready') {
        if (
          !Number.isFinite(value.width) ||
          !Number.isFinite(value.height) ||
          value.width < 2 ||
          value.height < 2 ||
          value.width > 3840 ||
          value.height > 2160
        ) {
          this.fail(new Error('The camera compositor produced invalid video dimensions.'));
          return;
        }
        this.width = value.width;
        this.height = value.height;
        this.readyResolve();
      } else if (value.type === 'error') this.fail(new Error(value.message));
      else if (value.type === 'preview') this.receivePreview(value.blob);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.fail(new Error('Background camera processing failed. Retry with Camera overlay off.'));
    };
    this.worker.onmessageerror = () =>
      this.fail(new Error('The browser could not transfer camera frames to the recording worker.'));
  }
  private fail(error: Error): void {
    if (!this.active || this.failed) return;
    this.failed = true;
    this.readyReject(error);
    this.onFailure(error);
  }
  async start(
    screen: MediaStreamTrack,
    camera: MediaStreamTrack,
    options: Options,
    bubble: Bubble = defaultBubble(),
    signal?: AbortSignal
  ): Promise<void> {
    const api = globalThis as typeof globalThis & Required<FrameApi>;
    let screenReader: Processor | undefined;
    let cameraReader: Processor | undefined;
    try {
      screenReader = new api.MediaStreamTrackProcessor({ track: screen, maxBufferSize: 1 });
      cameraReader = new api.MediaStreamTrackProcessor({ track: camera, maxBufferSize: 1 });
      const message: CompositorInit = {
        type: 'start',
        screen: screenReader.readable,
        camera: cameraReader.readable,
        output: this.videoTrack.writable,
        cameraOutput: this.cameraTrack.writable,
        options,
        bubble: { ...bubble },
      };
      this.worker.postMessage(message, [
        message.screen,
        message.camera,
        message.output,
        message.cameraOutput,
      ]);
      await waitFor(
        this.ready,
        10_000,
        'The background camera compositor did not receive frames. Retry with Camera overlay off.',
        signal
      );
    } catch (error) {
      if (screenReader && !screenReader.readable.locked)
        void screenReader.readable.cancel().catch(() => undefined);
      if (cameraReader && !cameraReader.readable.locked)
        void cameraReader.readable.cancel().catch(() => undefined);
      this.dispose();
      throw error;
    }
  }
  setBubble(bubble: Bubble): void {
    if (this.active) this.worker.postMessage({ type: 'bubble', bubble: { ...bubble } });
  }
  snapshot(): string | undefined {
    if (!this.active) return;
    const now = performance.now();
    if (this.previewAt === undefined || now - this.previewAt > 1000) {
      this.previewAt = now;
      this.worker.postMessage({ type: 'preview' });
    }
    return this.cachedFrame;
  }
  private receivePreview(blob: Blob): void {
    this.previewAt = undefined;
    if (
      !(blob instanceof Blob) ||
      blob.type !== 'image/jpeg' ||
      blob.size > 70_000 ||
      this.previewReader
    )
      return;
    const reader = new FileReader();
    this.previewReader = reader;
    reader.onload = () => {
      if (this.active && typeof reader.result === 'string' && reader.result.length <= 100_000)
        this.cachedFrame = reader.result;
    };
    reader.onloadend = () => {
      if (this.previewReader === reader) this.previewReader = undefined;
    };
    reader.readAsDataURL(blob);
  }
  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.readyReject(new DOMException('Camera preparation cancelled.', 'AbortError'));
    this.previewReader?.abort();
    this.previewReader = undefined;
    this.cachedFrame = undefined;
    this.worker.postMessage({ type: 'stop' });
    this.worker.terminate();
    this.videoTrack.stop();
    this.cameraTrack.stop();
  }
}
