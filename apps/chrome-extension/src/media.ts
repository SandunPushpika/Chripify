import type { Options } from './domain.js';
import { configureNativeBlur } from './effects.js';
import { WorkerCompositor } from './compositor.js';
import { defaultBubble } from './compositor-protocol.js';
import { abortReason, waitFor } from './lifecycle.js';

export { defaultBubble, type Bubble } from './compositor-protocol.js';

export async function acquire(
  promise: Promise<MediaStream>,
  timeoutMs = 60_000,
  signal?: AbortSignal
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancelled);
    };

    const fail = (error: unknown) => {
      if (settled) return;

      settled = true;
      cleanup();
      reject(error);
    };

    const cancelled = () =>
      fail(signal ? abortReason(signal) : new DOMException('Cancelled.', 'AbortError'));

    promise.then(
      (stream) => {
        if (settled) {
          stream.getTracks().forEach((track) => track.stop());

          return;
        }

        settled = true;
        cleanup();
        resolve(stream);
      },
      (error) => fail(error)
    );
    const timeout = setTimeout(
      () => fail(new Error('Device selection timed out. Close the sharing dialog and try again.')),
      timeoutMs
    );

    if (signal?.aborted) {
      cancelled();

      return;
    }

    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

export class Capture {
  readonly bubble = defaultBubble();
  private readonly streams: MediaStream[] = [];
  private active = true;
  private context: AudioContext | undefined;
  private gains: GainNode[] = [];
  private compositor: WorkerCompositor | undefined;
  cameraVideo: HTMLVideoElement | undefined;
  output: MediaStream | undefined;

  get width(): number {
    return this.compositor?.width ?? 0;
  }

  get height(): number {
    return this.compositor?.height ?? 0;
  }

  cameraSnapshot(): string | undefined {
    return this.active && this.bubble.visible ? this.compositor?.snapshot() : undefined;
  }

  updateBubble(): void {
    this.compositor?.setBubble(this.bubble);
  }

  own(stream: MediaStream): MediaStream {
    this.streams.push(stream);

    return stream;
  }

  audio(context: AudioContext): void {
    this.context = context;
  }

  async prepare(
    display: MediaStream,
    devices: MediaStream | undefined,
    options: Options,
    warn: (text: string) => void = () => undefined,
    signal?: AbortSignal,
    onFailure: (error: Error) => void = () => undefined
  ): Promise<MediaStream> {
    const tracks: MediaStreamTrack[] = [];
    const audioTracks = [
      ...(options.sharedAudio ? display.getAudioTracks() : []),
      ...(options.microphone ? devices?.getAudioTracks() ?? [] : []),
    ];

    if (audioTracks.length && this.context) {
      const destination = this.context.createMediaStreamDestination();

      for (const track of audioTracks) {
        const gain = this.context.createGain();
        gain.gain.value = display.getAudioTracks().includes(track)
          ? options.sharedGain
          : options.microphoneGain;
        this.context
          .createMediaStreamSource(new MediaStream([track]))
          .connect(gain)
          .connect(destination);
        this.gains.push(gain);
      }

      tracks.push(...destination.stream.getAudioTracks());
      this.own(destination.stream);
    }

    const camera = devices?.getVideoTracks()[0];
    const screen = display.getVideoTracks()[0];

    if (!screen) throw new Error('The selected screen has no video track.');

    if (camera) {
      await waitFor(
        configureNativeBlur(camera, options, warn),
        5000,
        'Camera effects could not initialize.',
        signal
      );

      if (signal?.aborted) throw abortReason(signal);

      const compositor = new WorkerCompositor(onFailure);
      this.compositor = compositor;
      await compositor.start(screen, camera, options, this.bubble, signal);

      if (!this.active || signal?.aborted)
        throw signal ? abortReason(signal) : new Error('Capture was cancelled.');

      tracks.push(compositor.videoTrack);
      // PiP/HTML preview is only a consumer. It never gates or drives recording frames.
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([compositor.cameraTrack]);
      this.cameraVideo = video;
      void video.play().catch(() => undefined);
    } else tracks.push(screen);

    this.output = new MediaStream(tracks);

    return this.output;
  }

  dispose(): void {
    if (!this.active) return;

    this.active = false;
    this.compositor?.dispose();
    this.compositor = undefined;

    for (const stream of this.streams) stream.getTracks().forEach((track) => track.stop());

    if (this.cameraVideo) {
      this.cameraVideo.pause();
      this.cameraVideo.srcObject = null;
    }

    for (const gain of this.gains) gain.disconnect();

    this.gains = [];

    if (this.context) void this.context.close().catch(() => undefined);

    this.output?.getTracks().forEach((track) => track.stop());
  }
}
