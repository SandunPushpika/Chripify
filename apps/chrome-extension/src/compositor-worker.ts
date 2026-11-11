import { CameraEffect } from './effects.js';
import { LatestFrames, OutputClock } from './compositor-core.js';
import { validateOptions } from './domain.js';
import {
  type Bubble,
  type CompositorCommand,
  type CompositorEvent,
  type CompositorInit,
} from './compositor-protocol.js';

// A dedicated worker is intentionally used rather than an extension service worker or document renderer.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<CompositorCommand>) => void) | null;
  postMessage(message: CompositorEvent): void;
};
let active = false;
let initialized = false;
let ready = false;
let writing = false;
let dirty = false;
let previewBusy = false;
let bubble: Bubble;
let source: CompositorInit;
let effect: CameraEffect;
let background: ImageBitmap | undefined;
let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | undefined;
let clock: OutputClock;
const frames = new LatestFrames<VideoFrame>();
const readers: ReadableStreamDefaultReader<VideoFrame>[] = [];
let output: WritableStreamDefaultWriter<VideoFrame> | undefined;
let cameraOutput: WritableStreamDefaultWriter<VideoFrame> | undefined;

function shutdown(): void {
  active = false;
  frames.close();
  background?.close();
  background = undefined;
  for (const reader of readers) void reader.cancel().catch(() => undefined);
  if (output) void output.abort().catch(() => undefined);
  if (cameraOutput) void cameraOutput.abort().catch(() => undefined);
}
function failure(error: unknown): void {
  if (!active) return;
  scope.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : 'Background video processing failed.',
  });
  shutdown();
}
async function preview(): Promise<void> {
  if (!active || !ready || previewBusy) return;
  previewBusy = true;
  try {
    const image = effect.canvas;
    const thumb = new OffscreenCanvas(200, 200);
    const ctx = thumb.getContext('2d', { alpha: false });
    if (!ctx) return;
    const side = Math.min(image.width, image.height);
    if (bubble.mirror) {
      ctx.translate(200, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(
      image,
      (image.width - side) / 2,
      (image.height - side) / 2,
      side,
      side,
      0,
      0,
      200,
      200
    );
    const blob = await thumb.convertToBlob({ type: 'image/jpeg', quality: 0.65 });
    if (active && blob.size <= 70_000) scope.postMessage({ type: 'preview', blob });
  } catch {
    /* A missing thumbnail must never stop the encoded recording. */
  } finally {
    previewBusy = false;
  }
}
function compose(screen: VideoFrame, camera: VideoFrame): OffscreenCanvas {
  if (!canvas || !context) {
    const scale = Math.min(
      1,
      source.options.maxHeight / screen.displayHeight,
      3840 / screen.displayWidth
    );
    canvas = new OffscreenCanvas(
      Math.max(2, Math.round((screen.displayWidth * scale) / 2) * 2),
      Math.max(2, Math.round((screen.displayHeight * scale) / 2) * 2)
    );
    context = canvas.getContext('2d', { alpha: false }) ?? undefined;
    if (!context) throw new Error('Offscreen video composition is unavailable.');
  }
  const ctx = context;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const fit = Math.min(canvas.width / screen.displayWidth, canvas.height / screen.displayHeight);
  const width = screen.displayWidth * fit;
  const height = screen.displayHeight * fit;
  ctx.drawImage(screen, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  const cameraImage = effect.draw(camera);
  if (bubble.visible) {
    const size = Math.min(canvas.width, canvas.height) * bubble.size;
    const x = bubble.x * (canvas.width - size);
    const y = bubble.y * (canvas.height - size);
    ctx.save();
    ctx.beginPath();
    if (bubble.circle) ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    else ctx.roundRect(x, y, size, size, size * 0.08);
    ctx.clip();
    if (bubble.mirror) {
      ctx.translate(x * 2 + size, 0);
      ctx.scale(-1, 1);
    }
    const side = Math.min(cameraImage.width, cameraImage.height);
    ctx.drawImage(
      cameraImage,
      (cameraImage.width - side) / 2,
      (cameraImage.height - side) / 2,
      side,
      side,
      x,
      y,
      size,
      size
    );
    ctx.restore();
  }
  return canvas;
}
async function render(): Promise<void> {
  if (writing || !active) return;
  writing = true;
  try {
    while (active && dirty && frames.screen && frames.camera) {
      dirty = false;
      const timestamp = clock.next(frames.screen.timestamp, performance.now());
      if (timestamp === undefined) continue;
      const image = compose(frames.screen, frames.camera);
      const frame = new VideoFrame(image, { timestamp });
      const cameraFrame = new VideoFrame(effect.canvas, { timestamp });
      try {
        // Readiness is sent before writing so a sink waiting for MediaRecorder cannot deadlock preparation.
        if (!ready) {
          ready = true;
          scope.postMessage({ type: 'ready', width: image.width, height: image.height });
        }
        await Promise.all([output?.write(frame), cameraOutput?.write(cameraFrame)]);
      } finally {
        frame.close();
        cameraFrame.close();
      }
    }
  } catch (error) {
    failure(error);
  } finally {
    writing = false;
  }
}
async function consume(
  kind: 'screen' | 'camera',
  stream: ReadableStream<VideoFrame>
): Promise<void> {
  const reader = stream.getReader();
  readers.push(reader);
  try {
    while (active) {
      const { value, done } = await reader.read();
      if (done) {
        if (active)
          throw new Error(`${kind === 'screen' ? 'Screen' : 'Camera'} frames stopped arriving.`);
        break;
      }
      if (!active) {
        value.close();
        break;
      }
      frames.replace(kind, value);
      dirty = true;
      void render();
    }
  } catch (error) {
    failure(error);
  } finally {
    reader.releaseLock();
  }
}
async function start(message: CompositorInit): Promise<void> {
  if (initialized) return;
  initialized = true;
  active = true;
  source = message;
  bubble = message.bubble;
  try {
    validateOptions(message.options);
    if (message.options.effect === 'green-image' && message.options.backgroundImage) {
      const encoded = message.options.backgroundImage.split(',')[1];
      if (!encoded) throw new Error('The local background image is invalid.');
      const raw = atob(encoded);
      const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
      background = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      if (!active) {
        background.close();
        background = undefined;
        return;
      }
    }
    effect = new CameraEffect(message.options, background);
    clock = new OutputClock(message.options.fps);
    output = message.output.getWriter();
    cameraOutput = message.cameraOutput.getWriter();
    void consume('screen', message.screen);
    void consume('camera', message.camera);
  } catch (error) {
    failure(error);
  }
}
scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'start') void start(message);
  else if (message.type === 'stop') shutdown();
  else if (message.type === 'bubble' && active) {
    bubble = message.bubble;
    dirty = true;
    void render();
  } else if (message.type === 'preview') void preview();
};
