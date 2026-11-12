import type { Options } from './domain.js';

export interface Bubble {
  x: number;
  y: number;
  size: number;
  circle: boolean;
  mirror: boolean;
  visible: boolean;
}

export const defaultBubble = (): Bubble => ({
  x: 0.82,
  y: 0.73,
  size: 0.2,
  circle: true,
  mirror: true,
  visible: true,
});

export interface CompositorInit {
  type: 'start';
  options: Options;
  bubble: Bubble;
  screen: ReadableStream<VideoFrame>;
  camera: ReadableStream<VideoFrame>;
  output: WritableStream<VideoFrame>;
  cameraOutput: WritableStream<VideoFrame>;
}

export type CompositorCommand =
  | CompositorInit
  | { type: 'bubble'; bubble: Bubble }
  | { type: 'preview' }
  | { type: 'stop' };

export type CompositorEvent =
  | { type: 'ready'; width: number; height: number }
  | { type: 'preview'; blob: Blob }
  | { type: 'error'; message: string };
