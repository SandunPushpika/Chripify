export type Phase = 'idle' | 'preparing' | 'recording' | 'paused' | 'stopping';
export type RecordingState = 'recording' | 'complete' | 'interrupted';
export interface Recording {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number;
  bytes: number;
  chunkCount: number;
  mimeType: string;
  state: RecordingState;
  width: number;
  height: number;
}
export interface Options {
  microphone: boolean;
  sharedAudio: boolean;
  camera: boolean;
  microphoneId: string;
  cameraId: string;
  fps: number;
  maxHeight: number;
  microphoneGain: number;
  sharedGain: number;
  effect?: 'original' | 'native-blur' | 'green-blur' | 'green-color' | 'green-image';
  keyColor?: string;
  backgroundColor?: string;
  keyTolerance?: number;
  backgroundImage?: string;
}
export const MAX_PENDING_BYTES = 32 * 1024 * 1024;
export const MIN_FREE_BYTES = 128 * 1024 * 1024;
export function transition(from: Phase, to: Phase): Phase {
  const edges: Record<Phase, readonly Phase[]> = {
    idle: ['preparing'],
    preparing: ['recording', 'idle'],
    recording: ['paused', 'stopping'],
    paused: ['recording', 'stopping'],
    stopping: ['idle'],
  };
  if (!edges[from].includes(to)) throw new Error(`Cannot change recorder from ${from} to ${to}.`);
  return to;
}
export function validateOptions(options: Options): void {
  if (
    ![15, 30, 60].includes(options.fps) ||
    ![720, 1080, 1440, 2160].includes(options.maxHeight) ||
    ![options.microphoneGain, options.sharedGain].every(
      (g) => Number.isFinite(g) && g >= 0 && g <= 2
    )
  ) {
    throw new Error('Choose a supported resolution, frame rate and audio gain.');
  }
  if (
    options.effect !== undefined &&
    !['original', 'native-blur', 'green-blur', 'green-color', 'green-image'].includes(
      options.effect
    )
  )
    throw new Error('Choose a supported camera effect.');
  for (const color of [options.keyColor, options.backgroundColor]) {
    if (color !== undefined && !/^#[\da-f]{6}$/i.test(color))
      throw new Error('Choose a valid camera background color.');
  }
  if (
    options.keyTolerance !== undefined &&
    (!Number.isFinite(options.keyTolerance) ||
      options.keyTolerance < 10 ||
      options.keyTolerance > 200)
  )
    throw new Error('Choose a valid green-screen tolerance.');
  if (
    options.backgroundImage !== undefined &&
    (!/^data:image\/(png|jpeg|webp);base64,/.test(options.backgroundImage) ||
      options.backgroundImage.length > 2_000_000)
  )
    throw new Error('Use a local PNG, JPEG or WebP background smaller than 2 MB.');
  if (options.camera && options.effect === 'green-image' && !options.backgroundImage)
    throw new Error('Choose a background image first.');
}
export function validateTitle(title: string): string {
  const result = title.trim();
  if (
    !result ||
    result.length > 120 ||
    Array.from(result).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new Error('Use a title of 1–120 printable characters.');
  return result;
}
export function chooseMime(supported: (mime: string) => boolean): string {
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(
    supported
  );
  if (!mime)
    throw new Error('This browser does not support local WebM recording. Update desktop Chrome.');
  return mime;
}
export function message(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError')
      return 'Sharing was cancelled or permission was denied. Click Record to try again.';
    if (error.name === 'NotFoundError')
      return 'The selected camera or microphone is unavailable. Refresh devices and try again.';
    if (error.name === 'NotReadableError')
      return 'The selected screen or device is unavailable or in use. Check OS permissions.';
    if (error.name === 'QuotaExceededError')
      return 'Local browser storage is full. Download existing recordings and free space.';
  }
  return error instanceof Error
    ? error.message
    : 'Recording failed. Any saved chunks remain in the local library.';
}
export function clock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
export function validBadge(value: unknown): value is { version: 1; type: 'status'; phase: Phase } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 3 &&
    'version' in value &&
    value.version === 1 &&
    'type' in value &&
    value.type === 'status' &&
    'phase' in value &&
    ['idle', 'preparing', 'recording', 'paused', 'stopping'].includes(String(value.phase))
  );
}
