import type { Options } from './domain.js';

export function keyAlpha(
  red: number,
  green: number,
  blue: number,
  key: readonly number[],
  tolerance: number
): number {
  const distance = Math.hypot(red - (key[0] ?? 0), green - (key[1] ?? 255), blue - (key[2] ?? 0));

  return Math.max(0, Math.min(1, (distance - tolerance) / 35));
}

export async function configureNativeBlur(
  track: MediaStreamTrack,
  options: Options,
  warn: (text: string) => void
): Promise<void> {
  if (options.effect !== 'native-blur') return;

  const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
    backgroundBlur?: boolean[];
  };

  if (Array.isArray(capabilities.backgroundBlur) && capabilities.backgroundBlur.includes(true)) {
    try {
      await track.applyConstraints({ backgroundBlur: true } as MediaTrackConstraints);
    } catch {
      warn(
        'This camera could not enable browser-native background blur. Using the original background.'
      );
    }
  } else
    warn(
      'Background blur is not supported by this Chrome/camera combination. Using the original background. Green-screen effects work locally with a uniform background.'
    );
}

/** Worker-only renderer: no HTMLVideoElement, document visibility, presentation callback or DOM canvas. */
export class CameraEffect {
  readonly canvas = new OffscreenCanvas(320, 240);
  private readonly foreground = new OffscreenCanvas(320, 240);
  private readonly context: OffscreenCanvasRenderingContext2D;
  private readonly mask: OffscreenCanvasRenderingContext2D;

  constructor(private readonly options: Options, private readonly image?: ImageBitmap) {
    const context = this.canvas.getContext('2d', { alpha: false });
    const mask = this.foreground.getContext('2d', { willReadFrequently: true });

    if (!context || !mask) throw new Error('Camera background processing is unavailable.');

    this.context = context;
    this.mask = mask;
  }

  draw(frame: VideoFrame): OffscreenCanvas {
    const { canvas, context: ctx, foreground, mask, options } = this;
    const limit = options.effect?.startsWith('green-') ? 320 : 640;
    const scale = Math.min(1, limit / frame.displayWidth, limit / frame.displayHeight);
    const width = Math.max(1, Math.round(frame.displayWidth * scale));
    const height = Math.max(1, Math.round(frame.displayHeight * scale));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = foreground.width = width;
      canvas.height = foreground.height = height;
    }

    ctx.filter = 'none';
    ctx.drawImage(frame, 0, 0, width, height);

    if (!options.effect?.startsWith('green-')) return canvas;

    mask.clearRect(0, 0, width, height);
    mask.drawImage(frame, 0, 0, width, height);
    const pixels = mask.getImageData(0, 0, width, height);
    const key = [1, 3, 5].map((start) =>
      parseInt((options.keyColor ?? '#00ff00').slice(start, start + 2), 16)
    );

    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i + 3] = Math.round(
        255 *
          keyAlpha(
            pixels.data[i] ?? 0,
            pixels.data[i + 1] ?? 0,
            pixels.data[i + 2] ?? 0,
            key,
            options.keyTolerance ?? 90
          )
      );
    }

    mask.putImageData(pixels, 0, 0);

    if (options.effect === 'green-blur') {
      ctx.filter = 'blur(14px)';
      ctx.drawImage(frame, -15, -15, width + 30, height + 30);
      ctx.filter = 'none';
    } else if (this.image) {
      const scale = Math.max(width / this.image.width, height / this.image.height);
      const w = this.image.width * scale;
      const h = this.image.height * scale;
      ctx.drawImage(this.image, (width - w) / 2, (height - h) / 2, w, h);
    } else {
      ctx.fillStyle = options.backgroundColor ?? '#43335f';
      ctx.fillRect(0, 0, width, height);
    }

    ctx.drawImage(foreground, 0, 0);

    return canvas;
  }
}
