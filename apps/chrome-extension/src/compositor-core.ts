export interface ClosableFrame {
  close(): void;
}

export class LatestFrames<T extends ClosableFrame> {
  screen: T | undefined;
  camera: T | undefined;

  replace(kind: 'screen' | 'camera', frame: T): void {
    this[kind]?.close();
    this[kind] = frame;
  }

  close(): void {
    this.screen?.close();
    this.camera?.close();
    this.screen = this.camera = undefined;
  }
}

/** Keep the screen's initial clock origin, independent of page presentation and camera timestamp origins. */
export class OutputClock {
  private origin: number | undefined;
  private wallOrigin = 0;
  private lastWall: number | undefined;
  private lastTimestamp = -1;

  constructor(private readonly fps: number) {
    if (!Number.isFinite(fps) || fps <= 0) throw new Error('Invalid compositor frame rate.');
  }

  next(screenTimestamp: number, wallMs: number): number | undefined {
    if (this.lastWall !== undefined && wallMs - this.lastWall < 1000 / this.fps - 0.5) return;

    if (this.origin === undefined) {
      this.origin = screenTimestamp;
      this.wallOrigin = wallMs;
    }

    const timestamp = Math.max(
      this.lastTimestamp + 1,
      Math.round(this.origin + (wallMs - this.wallOrigin) * 1000)
    );
    this.lastWall = wallMs;
    this.lastTimestamp = timestamp;

    return timestamp;
  }
}
