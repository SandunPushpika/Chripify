import {
  chooseMime,
  MAX_PENDING_BYTES,
  MIN_FREE_BYTES,
  transition,
  validateOptions,
  type Options,
  type Phase,
  type Recording,
} from './domain.js';
import { acquire, Capture } from './media.js';
import { abortReason, recordingCountdown, waitFor } from './lifecycle.js';
import type { Library } from './storage.js';

export class SessionClock {
  private started = 0;
  private accumulated = 0;
  private running = false;
  constructor(private readonly now: () => number = () => performance.now()) {}
  resume(): void {
    if (!this.running) {
      this.started = this.now();
      this.running = true;
    }
  }
  pause(): void {
    if (this.running) {
      this.accumulated += this.now() - this.started;
      this.running = false;
    }
  }
  elapsed(): number {
    return this.accumulated + (this.running ? this.now() - this.started : 0);
  }
}

export class ChunkWriter {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private index = 0;
  private failed = false;
  error: unknown;
  constructor(
    private readonly append: (index: number, blob: Blob) => Promise<void>,
    private readonly fail: (error: unknown) => void
  ) {}
  write(blob: Blob): void {
    if (!blob.size || this.failed) return;
    if (this.pending + blob.size > MAX_PENDING_BYTES) {
      this.error = new Error(
        'Local storage cannot keep up with recording. Reduce quality or free disk space.'
      );
      this.failed = true;
      this.fail(this.error);
      return;
    }
    this.pending += blob.size;
    const index = this.index++;
    this.tail = this.tail
      .then(async () => {
        if (this.failed) return;
        await this.append(index, blob);
      })
      .catch((error) => {
        if (!this.failed) {
          this.failed = true;
          this.error = error;
          this.fail(error);
        }
      })
      .finally(() => {
        this.pending -= blob.size;
      });
  }
  async finish(): Promise<void> {
    await this.tail;
    if (this.failed) throw this.error;
  }
}

interface Events {
  changed(phase: Phase): void;
  preview(stream: MediaStream | undefined): void;
  warning(text: string): void;
  saved(recording: Recording): void;
  failed(error: unknown): void;
}
export class RecorderEngine {
  phase: Phase = 'idle';
  capture: Capture | undefined;
  private recorder: MediaRecorder | undefined;
  private clock = new SessionClock();
  private completion: Promise<void> | undefined;
  private stopRequested = false;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private finishFallback: (() => void) | undefined;
  private preparation: AbortController | undefined;
  private stage = '';
  get preparationStage(): string {
    return this.stage;
  }
  cancelPreparation(): void {
    this.preparation?.abort(new DOMException('Recording preparation cancelled.', 'AbortError'));
  }
  constructor(private readonly library: Library, private readonly events: Events) {}
  get elapsed(): number {
    return this.clock.elapsed();
  }
  private set(next: Phase): void {
    this.phase = transition(this.phase, next);
    this.events.changed(next);
  }
  async start(
    options: Options,
    displaySource?: () => Promise<MediaStream>,
    beforeRecord?: () => Promise<void>
  ): Promise<void> {
    validateOptions(options);
    if (this.phase !== 'idle') throw new Error('A recording session is already active.');
    const mimeType = chooseMime((mime) => MediaRecorder.isTypeSupported(mime));
    this.clock = new SessionClock();
    this.set('preparing');
    const capture = new Capture();
    this.capture = capture;
    const preparation = new AbortController();
    this.preparation = preparation;
    const signal = preparation.signal;
    const cancelled = () => capture.dispose();
    signal.addEventListener('abort', cancelled, { once: true });
    const startupTimer = setTimeout(
      () =>
        preparation.abort(
          new Error('Recording startup timed out. Check permissions in the main app and retry.')
        ),
      90_000
    );
    this.stopRequested = false;
    let record: Recording | undefined;
    let captureFailure: Error | undefined;
    try {
      // Invoke directly in the click handler, before awaiting storage/device work: Chrome requires user activation.
      let audioContext: AudioContext | undefined;
      if (options.microphone || options.sharedAudio) {
        const context = new AudioContext();
        audioContext = context;
        capture.audio(context);
        void context.resume().catch(() => undefined);
      }
      this.stage = 'Waiting for screen sharing';
      const displayRequest = acquire(
        displaySource
          ? displaySource()
          : navigator.mediaDevices.getDisplayMedia({
              video: {
                frameRate: { ideal: options.fps, max: options.fps },
                height: { ideal: options.maxHeight },
              },
              audio: options.sharedAudio,
              selfBrowserSurface: 'exclude',
              systemAudio: options.sharedAudio ? 'include' : 'exclude',
            } as DisplayMediaStreamOptions),
        60_000,
        signal
      );
      const display = capture.own(await displayRequest);
      const displayTrack = display.getVideoTracks()[0];
      if (!displayTrack) throw new Error('Chrome did not provide a screen video track.');
      let sharingEnded = false;
      displayTrack.addEventListener(
        'ended',
        () => {
          sharingEnded = true;
          if (this.capture === capture && (this.phase === 'recording' || this.phase === 'paused'))
            void this.stop();
        },
        { once: true }
      );
      await waitFor(
        displayTrack.applyConstraints({
          height: { max: options.maxHeight },
          width: { max: 3840 },
          frameRate: { max: options.fps },
        }),
        5000,
        'The screen capture settings could not be applied.',
        signal
      );
      this.stage = 'Checking local recording storage';
      const estimate = await waitFor(
        navigator.storage.estimate(),
        5000,
        'Browser storage did not respond. Retry or free space.',
        signal
      );
      if (
        estimate.quota !== undefined &&
        estimate.usage !== undefined &&
        estimate.quota - estimate.usage < MIN_FREE_BYTES
      ) {
        throw new Error(
          'At least 128 MiB of local browser storage is required. Download recordings and free space.'
        );
      }
      let devices: MediaStream | undefined;
      if (options.camera || options.microphone) {
        this.stage = 'Allow camera/microphone in the recorder tab';
        devices = capture.own(
          await acquire(
            navigator.mediaDevices.getUserMedia({
              audio: options.microphone
                ? {
                    deviceId: options.microphoneId ? { exact: options.microphoneId } : undefined,
                    echoCancellation: true,
                    noiseSuppression: true,
                  }
                : false,
              video: options.camera
                ? {
                    deviceId: options.cameraId ? { exact: options.cameraId } : undefined,
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 },
                  }
                : false,
            }),
            60_000,
            signal
          )
        );
      }
      if (sharingEnded || displayTrack.readyState !== 'live')
        throw new Error('Screen sharing ended before recording could start.');
      if (audioContext && (display.getAudioTracks().length || devices?.getAudioTracks().length)) {
        this.stage = 'Starting audio processing';
        const context = audioContext;
        await waitFor(
          context.resume(),
          5000,
          'Chrome blocked audio processing. Open the main app and start recording there to grant audio permission.',
          signal
        );
      }
      if (options.sharedAudio && !display.getAudioTracks().length)
        this.events.warning(
          'Chrome did not provide shared audio. For tab audio, choose a Chrome tab and enable “Share tab audio” in the picker.'
        );
      this.stage = options.camera
        ? 'Starting background camera/video processing'
        : 'Starting screen recording';
      const stream = await capture.prepare(
        display,
        devices,
        options,
        this.events.warning,
        signal,
        (error) => {
          captureFailure = error;
          if (this.phase === 'preparing') preparation.abort(error);
          else if (this.phase === 'recording' || this.phase === 'paused') {
            this.events.warning(error.message);
            void this.stop();
          }
        }
      );
      const settings = stream.getVideoTracks()[0]?.getSettings();
      record = {
        id: crypto.randomUUID(),
        title: `Recording ${new Date().toLocaleString()}`,
        createdAt: Date.now(),
        durationMs: 0,
        bytes: 0,
        chunkCount: 0,
        mimeType,
        state: 'recording',
        width: settings?.width || capture.width || 0,
        height: settings?.height || capture.height || 0,
      };
      this.stage = 'Creating local recording';
      await waitFor(
        this.library.create(record),
        5000,
        'The local recording could not be created in time.',
        signal
      );
      if (beforeRecord) {
        this.stage = 'Returning to the shared browser';
        await waitFor(
          beforeRecord(),
          5000,
          'Could not return to the shared browser. Recording was cancelled.',
          signal
        );
      }
      await recordingCountdown(signal, (remaining) => {
        this.stage = `Recording starts in ${remaining}…`;
      });
      if (signal.aborted) throw abortReason(signal);
      if (captureFailure) throw captureFailure;
      if (
        sharingEnded ||
        displayTrack.readyState !== 'live' ||
        devices?.getTracks().some((track) => track.readyState !== 'live')
      ) {
        throw new Error('Sharing or a selected device ended before recording could start.');
      }
      const recording = record;
      let failure: unknown;
      const writer = new ChunkWriter(
        (index, blob) => this.library.append(recording.id, index, blob),
        (error) => {
          failure = error;
          void this.stop();
        }
      );
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: options.maxHeight > 1080 ? 10_000_000 : 5_000_000,
        audioBitsPerSecond: 128_000,
      });
      this.recorder = recorder;
      this.completion = new Promise((resolve) => {
        let finalized = false;
        recorder.ondataavailable = (event) => writer.write(event.data);
        recorder.onerror = () => {
          failure = new Error(
            'Chrome’s media encoder failed. Any saved chunks remain in your library.'
          );
          void this.stop();
        };
        recorder.onstop = () => {
          if (finalized) return;
          finalized = true;
          clearTimeout(this.watchdog);
          recorder.ondataavailable = null;
          if (this.phase === 'recording' || this.phase === 'paused') {
            this.clock.pause();
            this.set('stopping');
          }
          capture.dispose();
          this.events.preview(undefined);
          void (async () => {
            try {
              await writer.finish();
              if (captureFailure) throw captureFailure;
              if (failure) throw failure;
              const stored = (await this.library.list()).find((item) => item.id === recording.id);
              if (!stored?.bytes)
                throw new Error('Chrome produced an empty recording. No complete video was saved.');
              await this.library.update(recording.id, {
                state: 'complete',
                durationMs: this.clock.elapsed(),
              });
              this.events.saved({ ...stored, state: 'complete', durationMs: this.clock.elapsed() });
            } catch (error) {
              await this.library
                .update(recording.id, { state: 'interrupted', durationMs: this.clock.elapsed() })
                .catch(() => undefined);
              this.events.failed(error);
            } finally {
              this.recorder = undefined;
              this.capture = undefined;
              this.finishFallback = undefined;
              this.set('idle');
              resolve();
            }
          })();
        };
        this.finishFallback = () => {
          failure = new Error(
            'Chrome did not finish the recording in time. Saved chunks have been retained as an interrupted recording.'
          );
          recorder.onstop?.(new Event('stop'));
        };
      });
      for (const track of devices?.getTracks() ?? [])
        track.addEventListener(
          'ended',
          () => {
            if (this.capture !== capture) return;
            this.events.warning('A camera or microphone disconnected. Recording has been stopped.');
            void this.stop();
          },
          { once: true }
        );
      recorder.start(1000);
      this.clock.resume();
      this.set('recording');
      this.stage = '';
      this.events.preview(stream);
    } catch (error) {
      capture.dispose();
      this.capture = undefined;
      this.recorder = undefined;
      if (record)
        void this.library.update(record.id, { state: 'interrupted' }).catch(() => undefined);
      this.set('idle');
      throw error;
    } finally {
      clearTimeout(startupTimer);
      signal.removeEventListener('abort', cancelled);
      if (this.preparation === preparation) this.preparation = undefined;
      this.stage = '';
    }
  }
  pause(): void {
    if (this.phase !== 'recording' || !this.recorder) return;
    this.recorder.pause();
    this.clock.pause();
    this.set('paused');
  }
  resume(): void {
    if (this.phase !== 'paused' || !this.recorder) return;
    this.recorder.resume();
    this.clock.resume();
    this.set('recording');
  }
  async stop(): Promise<void> {
    if (this.phase === 'preparing') {
      this.cancelPreparation();
      return;
    }
    if (this.phase === 'stopping') return this.completion;
    if (
      !this.recorder ||
      this.stopRequested ||
      (this.phase !== 'recording' && this.phase !== 'paused')
    )
      return;
    this.stopRequested = true;
    this.clock.pause();
    this.set('stopping');
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.capture?.dispose();
    this.watchdog = setTimeout(() => this.finishFallback?.(), 20_000);
    return this.completion;
  }
  dispose(): void {
    this.cancelPreparation();
    this.capture?.dispose();
  }
}
