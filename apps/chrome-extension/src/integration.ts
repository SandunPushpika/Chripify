import { validateOptions, type Options, type Phase } from './domain.js';

export const overlayOrigins = ['http://*/*', 'https://*/*'];

export interface LiveState {
  phase: Phase;
  elapsed: number;
  camera: boolean;
  frame?: string;
  warning?: string;
  stage?: string;
}

export type Control = 'pause' | 'resume' | 'stop';

export function isControl(value: unknown): value is Control {
  return value === 'pause' || value === 'resume' || value === 'stop';
}

export function canReadOverlay(
  tab: { active: boolean; url?: string },
  senderUrl: string,
  tabId: number,
  wide: boolean,
  grant?: { tabId?: number; origin?: string }
): boolean {
  try {
    if (!tab.active || !tab.url) return false;

    const sender = new URL(senderUrl);
    const actual = new URL(tab.url);

    return (
      ['http:', 'https:'].includes(sender.protocol) &&
      sender.origin === actual.origin &&
      (wide || (grant?.tabId === tabId && grant.origin === sender.origin))
    );
  } catch {
    return false;
  }
}

export function validEnvelope(
  value: unknown
): value is Record<string, unknown> & { version: 1; type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'version' in value &&
    value.version === 1 &&
    'type' in value &&
    typeof value.type === 'string' &&
    Object.keys(value).length <= 5
  );
}

export function defaultOptions(): Options {
  return {
    microphone: true,
    sharedAudio: true,
    camera: false,
    cameraId: '',
    microphoneId: '',
    fps: 30,
    maxHeight: 1080,
    microphoneGain: 1,
    sharedGain: 1,
    effect: 'original',
    keyColor: '#00ff00',
    backgroundColor: '#43335f',
    keyTolerance: 90,
  };
}

export function readOptions(value: unknown): Options {
  const defaults = defaultOptions();

  if (typeof value !== 'object' || value === null) return defaults;

  const options = { ...defaults };
  const source = value as Record<string, unknown>;

  for (const key of Object.keys(defaults) as Array<keyof Options>) {
    if (source[key] !== undefined) Object.assign(options, { [key]: source[key] });
  }

  if (source.backgroundImage !== undefined)
    options.backgroundImage = source.backgroundImage as string;

  if (
    ![options.camera, options.microphone, options.sharedAudio].every(
      (item) => typeof item === 'boolean'
    ) ||
    ![options.cameraId, options.microphoneId].every(
      (item) => typeof item === 'string' && item.length <= 512
    )
  )
    throw new Error('Saved recording settings are invalid. Reset them in the main app.');

  validateOptions(options);

  return options;
}

export function isLiveState(value: unknown): value is LiveState {
  if (typeof value !== 'object' || value === null) return false;

  const v = value as Partial<LiveState>;

  return (
    ['idle', 'preparing', 'recording', 'paused', 'stopping'].includes(String(v.phase)) &&
    typeof v.elapsed === 'number' &&
    Number.isFinite(v.elapsed) &&
    v.elapsed >= 0 &&
    typeof v.camera === 'boolean' &&
    (v.frame === undefined ||
      (typeof v.frame === 'string' &&
        v.frame.startsWith('data:image/jpeg;base64,') &&
        v.frame.length <= 100_000)) &&
    (v.warning === undefined || (typeof v.warning === 'string' && v.warning.length <= 1000)) &&
    (v.stage === undefined || (typeof v.stage === 'string' && v.stage.length <= 120))
  );
}
