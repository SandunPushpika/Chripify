import { clock, message, type Options } from './domain.js';
import { isLiveState, overlayOrigins, readOptions } from './integration.js';

function get<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) throw new Error(`Missing popup control: ${id}`);

  return element as T;
}

const mic = get<HTMLInputElement>('popup-mic');
const audio = get<HTMLInputElement>('popup-audio');
const camera = get<HTMLInputElement>('popup-camera');
const effect = get<HTMLSelectElement>('popup-effect');
const start = get<HTMLButtonElement>('popup-start');
const pause = get<HTMLButtonElement>('popup-pause');
const follow = get<HTMLInputElement>('popup-follow');
let options: Options;
let current = 'idle';
let busy = false;
let contextNotice = '';
let saveQueue = Promise.resolve();

function failure(error: unknown): void {
  get('popup-error').textContent = message(error);
  get('popup-error').hidden = false;
}

function save(): Promise<void> {
  options = {
    ...options,
    microphone: mic.checked,
    sharedAudio: audio.checked,
    camera: camera.checked,
    effect: effect.value as Options['effect'],
  };
  get('popup-effects').hidden = !camera.checked;
  const validated = readOptions(options);
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(() => chrome.storage.local.set({ options: validated }));

  return saveQueue;
}

async function poll(): Promise<void> {
  try {
    const result = await chrome.runtime.sendMessage({ version: 1, type: 'get-state' });

    if (!isLiveState(result)) throw new Error('Reload the extension to connect the new popup.');

    current = result.phase;
    get('popup-notice').textContent = result.warning || contextNotice;
    get('popup-notice').hidden = !result.warning && !contextNotice;
    get('popup-state').textContent = {
      idle: 'Ready to record',
      preparing: result.stage || 'Choose what to share…',
      recording: '● Recording',
      paused: 'Ⅱ Paused',
      stopping: 'Saving locally…',
    }[result.phase];
    get('popup-time').textContent = clock(result.elapsed);
    get<HTMLFieldSetElement>('popup-settings').disabled = current !== 'idle' || busy;
    start.hidden = current === 'recording' || current === 'paused' || current === 'preparing';
    start.disabled = current !== 'idle' || busy;
    get('popup-controls').hidden =
      current !== 'recording' && current !== 'paused' && current !== 'preparing';
    pause.disabled = current === 'preparing';
    get('popup-stop').textContent = current === 'preparing' ? 'Cancel' : '■ Stop & save';
    pause.textContent = current === 'paused' ? 'Resume' : 'Pause';
  } catch (error) {
    failure(error);
  }
}

for (const control of [mic, audio, camera, effect])
  control.addEventListener('change', () => {
    try {
      void save().catch(failure);
    } catch (error) {
      failure(error);
    }
  });

start.onclick = () => {
  if (busy || current !== 'idle') return;

  busy = true;
  start.disabled = true;
  get('popup-error').hidden = true;
  void (async () => {
    await save();
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const result = await chrome.runtime.sendMessage({
      version: 1,
      type: 'start',
      returnTab: tab?.id,
    });

    if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true)
      throw new Error('Could not start. Check the main app for details.');

    window.close();
  })()
    .catch(failure)
    .finally(() => {
      busy = false;
      start.disabled = false;
    });
};

pause.onclick = () => {
  void chrome.runtime
    .sendMessage({ version: 1, type: 'control', action: current === 'paused' ? 'resume' : 'pause' })
    .then(poll)
    .catch(failure);
};

get<HTMLButtonElement>('popup-stop').onclick = () => {
  void chrome.runtime
    .sendMessage({ version: 1, type: 'control', action: 'stop' })
    .then(poll)
    .catch(failure);
};

get<HTMLButtonElement>('popup-app').onclick = () => {
  void chrome.runtime
    .sendMessage({ version: 1, type: 'open-app' })
    .then(() => window.close())
    .catch(failure);
};

follow.onchange = () => {
  follow.disabled = true;
  // Request immediately within the user's click; this permission is never requested silently.
  const permission = follow.checked
    ? chrome.permissions.request({ origins: overlayOrigins })
    : chrome.permissions.remove({ origins: overlayOrigins });
  void permission
    .then(async () => {
      follow.checked = await chrome.permissions.contains({ origins: overlayOrigins });
      await chrome.runtime.sendMessage({ version: 1, type: 'overlay-access' });
    })
    .catch(failure)
    .finally(() => {
      follow.disabled = false;
    });
};

async function initialize(): Promise<void> {
  options = readOptions((await chrome.storage.local.get('options')).options);
  mic.checked = options.microphone;
  audio.checked = options.sharedAudio;
  camera.checked = options.camera;
  effect.value = options.effect ?? 'original';
  get('popup-effects').hidden = !camera.checked;
  follow.checked = await chrome.permissions.contains({ origins: overlayOrigins });
  const previous = await chrome.storage.session.get('lastError');

  if (typeof previous.lastError === 'string') failure(new Error(previous.lastError));

  await chrome.runtime.sendMessage({ version: 1, type: 'overlay-access' });
  await poll();

  if (current === 'recording' || current === 'paused') {
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

    if (tab?.id !== undefined) {
      const result = await chrome.runtime.sendMessage({
        version: 1,
        type: 'show-overlay',
        tabId: tab.id,
      });

      if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === false)
        contextNotice =
          'Chrome does not allow a page overlay here. Use these popup controls instead.';
    }
  }

  setInterval(() => {
    void poll();
  }, 750);
}

start.disabled = true;
get<HTMLFieldSetElement>('popup-settings').disabled = true;

void initialize().catch(failure);