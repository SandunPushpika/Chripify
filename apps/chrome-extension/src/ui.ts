import { clock, message, type Options, type Recording, type Phase } from './domain.js';
import { RecorderEngine } from './engine.js';
import { Library } from './storage.js';
import { enumerateVisibleDevices } from './desktop-source.js';
import { waitFor } from './lifecycle.js';
import { isControl, readOptions, validEnvelope } from './integration.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing application element: ${id}`);
  return value as T;
}
const input = (id: string) => element<HTMLInputElement>(id);
const select = (id: string) => element<HTMLSelectElement>(id);
const button = (id: string) => element<HTMLButtonElement>(id);
const preview = element<HTMLVideoElement>('preview');
const player = element<HTMLVideoElement>('player');
const dialog = element<HTMLDialogElement>('player-dialog');
let library: Library;
let engine: RecorderEngine;
let recordings: Recording[] = [];
let ownsSession = false;
let playerUrl: string | undefined;
let releaseSession: (() => void) | undefined;
let operation = false;
let backgroundImage: string | undefined;
let settingsSave = Promise.resolve();
let initialized = false;
let currentNotice = '';

function notice(text: string): void {
  currentNotice = text;
  element('notice').textContent = text;
  element('notice').hidden = !text;
}
function failure(error: unknown): void {
  element('error').textContent = message(error);
  element('error').hidden = false;
}
function clearError(): void {
  element('error').hidden = true;
}
async function action(work: () => Promise<void>): Promise<void> {
  if (operation) return;
  operation = true;
  clearError();
  try {
    await work();
  } catch (error) {
    failure(error);
  } finally {
    operation = false;
  }
}
function page(name: 'studio' | 'library'): void {
  element('studio').hidden = name !== 'studio';
  element('library').hidden = name !== 'library';
  element('page-name').textContent = name === 'studio' ? 'Studio' : 'Recordings';
  button('studio-nav').setAttribute('aria-current', name === 'studio' ? 'page' : 'false');
  button('library-nav').setAttribute('aria-current', name === 'library' ? 'page' : 'false');
}
function options(): Options {
  return {
    microphone: input('microphone').checked,
    sharedAudio: input('shared-audio').checked,
    camera: input('camera').checked,
    microphoneId: select('microphone-device').value,
    cameraId: select('camera-device').value,
    fps: Number(select('fps').value),
    maxHeight: Number(select('resolution').value),
    microphoneGain: Number(input('microphone-gain').value),
    sharedGain: Number(input('shared-gain').value),
    effect: select('background-effect').value as Options['effect'],
    keyColor: input('key-color').value,
    backgroundColor: input('background-color').value,
    keyTolerance: Number(input('key-tolerance').value),
    backgroundImage,
  };
}
function effectControls(): void {
  element('background-settings').hidden = !input('camera').checked;
  const effect = select('background-effect').value;
  element('green-settings').hidden = !effect.startsWith('green-');
  input('background-file').disabled = effect !== 'green-image';
}
function selectDevicePreference(id: string, value: string): void {
  const menu = select(id);
  if (value && !Array.from(menu.options).some((option) => option.value === value)) {
    menu.add(new Option('Saved device (checked when recording starts)', value));
  }
  menu.value = value;
}
function applyOptions(value: Options): void {
  input('microphone').checked = value.microphone;
  input('shared-audio').checked = value.sharedAudio;
  input('camera').checked = value.camera;
  select('fps').value = String(value.fps);
  select('resolution').value = String(value.maxHeight);
  input('microphone-gain').value = String(value.microphoneGain);
  input('shared-gain').value = String(value.sharedGain);
  selectDevicePreference('microphone-device', value.microphoneId);
  selectDevicePreference('camera-device', value.cameraId);
  select('background-effect').value = value.effect ?? 'original';
  input('key-color').value = value.keyColor ?? '#00ff00';
  input('background-color').value = value.backgroundColor ?? '#43335f';
  input('key-tolerance').value = String(value.keyTolerance ?? 90);
  backgroundImage = value.backgroundImage;
  element('background-file-label').textContent = backgroundImage
    ? 'A local background image is saved.'
    : 'Choose a local image for image replacement.';
  effectControls();
}
function saveOptions(): Promise<void> {
  effectControls();
  const value = options();
  if (value.camera && value.effect === 'green-image' && !value.backgroundImage)
    return Promise.resolve();
  // Permit selecting image mode before selecting its file, but do not start until it is supplied.
  settingsSave = settingsSave
    .catch(() => undefined)
    .then(() => chrome.storage.local.set({ options: value }));
  return settingsSave;
}
function state(phase: Phase): void {
  const idle = phase === 'idle';
  const labels: Record<Phase, string> = {
    idle: 'Ready to record',
    preparing: 'Choose what to share…',
    recording: '● Recording',
    paused: 'Ⅱ Paused',
    stopping: 'Saving locally…',
  };
  element('state').textContent = labels[phase];
  button('record').disabled = !idle || !ownsSession;
  element<HTMLFieldSetElement>('settings').disabled = !idle;
  button('pause').disabled = phase !== 'recording' && phase !== 'paused';
  button('pause').textContent = phase === 'paused' ? 'Resume' : 'Pause';
  button('stop').disabled = phase !== 'recording' && phase !== 'paused' && phase !== 'preparing';
  button('quick-stop').hidden =
    phase !== 'recording' && phase !== 'paused' && phase !== 'preparing';
  button('stop').textContent = button('quick-stop').textContent =
    phase === 'preparing' ? 'Cancel' : '■ Stop & save';
  element('camera-controls').hidden =
    !engine?.capture?.cameraVideo || idle || phase === 'preparing';
  element('bubble-handle').hidden =
    element('camera-controls').hidden || !input('camera-visible').checked;
  element('live-tag').hidden = idle || phase === 'preparing' || phase === 'stopping';
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    void chrome.runtime.sendMessage({ version: 1, type: 'status', phase }).catch(() => undefined);
  }
  if (idle) void refreshLibrary().catch(failure);
}
async function devices(): Promise<void> {
  // Enumerate only: do not open camera/microphone just to display their names.
  const devices = await enumerateVisibleDevices(navigator.mediaDevices, document.visibilityState);
  if (!devices) return;
  for (const [id, kind] of [
    ['microphone-device', 'audioinput'],
    ['camera-device', 'videoinput'],
  ] as const) {
    const menu = select(id);
    const previous = menu.value;
    menu.replaceChildren(new Option('System default', ''));
    devices
      .filter((device) => device.kind === kind && device.deviceId && device.deviceId !== 'default')
      .forEach((device, i) =>
        menu.add(
          new Option(
            device.label || `${kind === 'audioinput' ? 'Microphone' : 'Camera'} ${i + 1}`,
            device.deviceId
          )
        )
      );
    selectDevicePreference(id, previous);
  }
}
function makeButton(
  text: string,
  callback: () => Promise<void>,
  danger = false
): HTMLButtonElement {
  const result = document.createElement('button');
  result.textContent = text;
  if (danger) result.className = 'danger';
  result.addEventListener('click', () => {
    result.disabled = true;
    void action(callback).finally(() => {
      result.disabled = false;
    });
  });
  return result;
}
async function openPlayer(record: Recording): Promise<void> {
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = URL.createObjectURL(await library.blob(record));
  player.src = playerUrl;
  element('player-title').textContent = record.title;
  dialog.showModal();
}
async function download(record: Recording): Promise<void> {
  const blob = await library.blob(record);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeTitle = Array.from(record.title.replace(/[<>:"/\\|?*]/gu, '-'))
    .map((char) => (char.charCodeAt(0) < 32 ? '-' : char))
    .join('')
    .slice(0, 90);
  link.download = `Chripify-${safeTitle}-${record.id.slice(0, 8)}.webm`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  notice(
    'Download requested. Check Chrome’s Downloads list to confirm it finished. Your local library copy is retained.'
  );
}
function renderLibrary(): void {
  const query = input('search').value.toLocaleLowerCase();
  const sort = select('sort').value;
  const items = recordings
    .filter((record) =>
      `${record.title} ${new Date(record.createdAt).toLocaleString()}`
        .toLocaleLowerCase()
        .includes(query)
    )
    .sort((a, b) =>
      sort === 'oldest'
        ? a.createdAt - b.createdAt
        : sort === 'longest'
        ? b.durationMs - a.durationMs
        : b.createdAt - a.createdAt
    );
  const container = element('recording-list');
  container.replaceChildren();
  element('count').textContent = String(recordings.length);
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const heading = document.createElement('h2');
    heading.textContent = query ? 'No matching recordings' : 'A home for your next big idea';
    const description = document.createElement('p');
    description.textContent = query
      ? 'Try a different title or date.'
      : 'Record your first video in the Studio.';
    empty.append(heading, description);
    container.append(empty);
    return;
  }
  for (const record of items) {
    const article = document.createElement('article');
    article.className = 'recording-item';
    const thumbnail = document.createElement('div');
    thumbnail.className = 'recording-thumbnail';
    thumbnail.textContent = '▷';
    thumbnail.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'recording-copy';
    const title = document.createElement('h2');
    title.textContent = record.title;
    const metadata = document.createElement('p');
    metadata.textContent = `${new Date(record.createdAt).toLocaleString()} · ${clock(
      record.durationMs
    )} · ${(record.bytes / 1024 / 1024).toFixed(1)} MB · ${record.width} × ${record.height}`;
    copy.append(title, metadata);
    if (record.state !== 'complete') {
      const warning = document.createElement('p');
      warning.className = 'interrupted';
      warning.textContent =
        record.state === 'recording'
          ? 'Recording in progress'
          : 'Interrupted — partial video may not be playable';
      copy.append(warning);
    }
    const actions = document.createElement('div');
    actions.className = 'recording-actions';
    if (record.state !== 'recording') {
      if (record.bytes)
        actions.append(
          makeButton('Play', () => openPlayer(record)),
          makeButton('Download', () => download(record))
        );
      actions.append(
        makeButton('Rename', async () => {
          const title = prompt('Recording title (1–120 characters)', record.title);
          if (title === null) return;
          await library.update(record.id, { title });
          await refreshLibrary();
        }),
        makeButton(
          'Delete',
          async () => {
            if (
              !confirm(
                `Delete “${record.title}” from this browser? This cannot be undone. Download a copy first if you want to keep it.`
              )
            )
              return;
            await library.delete(record.id);
            await refreshLibrary();
          },
          true
        )
      );
    }
    article.append(thumbnail, copy, actions);
    container.append(article);
  }
}
async function refreshLibrary(): Promise<void> {
  if (!library) return;
  recordings = await library.list();
  renderLibrary();
}
async function storageInfo(): Promise<void> {
  const estimate = await navigator.storage.estimate();
  const free =
    estimate.quota !== undefined && estimate.usage !== undefined
      ? estimate.quota - estimate.usage
      : undefined;
  element('storage-info').textContent =
    free === undefined
      ? 'Local browser storage'
      : `${(free / 1024 / 1024 / 1024).toFixed(1)} GB browser quota remaining`;
  if (
    free !== undefined &&
    free < 128 * 1024 * 1024 &&
    engine &&
    ['recording', 'paused'].includes(engine.phase)
  ) {
    notice('Local browser storage is low. Stopping now to preserve your recording.');
    await engine.stop();
  }
}
function updateBubble(): void {
  const bubble = engine?.capture?.bubble;
  if (!bubble) return;
  bubble.size = Number(input('bubble-size').value);
  bubble.circle = select('bubble-shape').value === 'circle';
  bubble.mirror = input('mirror').checked;
  bubble.visible = input('camera-visible').checked;
  engine.capture?.updateBubble();
  const handle = element('bubble-handle');
  handle.hidden = !bubble.visible;
  // Position the handle at the normalized camera center; canvas composition uses the same normalized origin.
  const area = element('preview-area');
  const settings =
    preview.srcObject instanceof MediaStream
      ? preview.srcObject.getVideoTracks()[0]?.getSettings()
      : undefined;
  const ratio = (settings?.width ?? 16) / (settings?.height ?? 9);
  const w = Math.min(area.clientWidth, area.clientHeight * ratio);
  const h = w / ratio;
  const size = Math.min(w, h) * bubble.size;
  handle.style.left = `${(area.clientWidth - w) / 2 + bubble.x * (w - size) + size / 2 - 18}px`;
  handle.style.top = `${(area.clientHeight - h) / 2 + bubble.y * (h - size) + size / 2 - 18}px`;
}
function moveBubble(event: PointerEvent): void {
  const bubble = engine?.capture?.bubble;
  if (!bubble) return;
  const area = element('preview-area').getBoundingClientRect();
  const settings =
    preview.srcObject instanceof MediaStream
      ? preview.srcObject.getVideoTracks()[0]?.getSettings()
      : undefined;
  const ratio = (settings?.width ?? 16) / (settings?.height ?? 9);
  const w = Math.min(area.width, area.height * ratio);
  const h = w / ratio;
  const size = Math.min(w, h) * bubble.size;
  bubble.x = Math.max(
    0,
    Math.min(
      1,
      (event.clientX - area.left - (area.width - w) / 2 - size / 2) / Math.max(1, w - size)
    )
  );
  bubble.y = Math.max(
    0,
    Math.min(
      1,
      (event.clientY - area.top - (area.height - h) / 2 - size / 2) / Math.max(1, h - size)
    )
  );
  updateBubble();
}

button('studio-nav').onclick = () => page('studio');
document.querySelector('.brand')?.addEventListener('click', (event) => {
  event.preventDefault();
  page('studio');
});
button('library-nav').onclick = () => {
  page('library');
  void refreshLibrary().catch(failure);
};
button('record').onclick = () => {
  if (!ownsSession) return;
  notice('');
  void saveOptions().catch(failure);
  // No await before engine.start calls getDisplayMedia: preserve the click's user activation.
  void action(() => engine.start(options()));
};
element('settings').addEventListener('change', () => {
  void saveOptions().catch(failure);
});
input('background-file').addEventListener('change', () => {
  void action(async () => {
    const file = input('background-file').files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000)
      throw new Error('Choose a PNG, JPEG or WebP image smaller than 5 MB.');
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 16_777_216)
        throw new Error('Use a background image with at most 16 megapixels.');
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image processing is unavailable.');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const candidate = canvas.toDataURL('image/jpeg', 0.85);
      readOptions({ ...options(), backgroundImage: candidate });
      backgroundImage = candidate;
      element('background-file-label').textContent = 'A local background image is saved.';
      await saveOptions();
    } finally {
      bitmap.close();
    }
  });
});
chrome.runtime.onMessage.addListener((value, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    (sender.url !== undefined && sender.url !== chrome.runtime.getURL('background.js')) ||
    !validEnvelope(value)
  )
    return;
  if (value.type === 'owner-ready') {
    respond({ ready: initialized && ownsSession && engine?.phase === 'idle' });
    return;
  }
  if (value.type === 'owner-state') {
    respond({
      phase: engine?.phase ?? 'idle',
      elapsed: engine?.elapsed ?? 0,
      camera: Boolean(engine?.capture?.cameraVideo && engine.capture.bubble.visible),
      warning: currentNotice.slice(0, 1000),
      stage: engine?.preparationStage ?? '',
      frame: value.frame === true ? engine?.capture?.cameraSnapshot() : undefined,
    });
    return;
  }
  if (value.type === 'owner-error' && typeof value.error === 'string') {
    failure(new Error(value.error.slice(0, 1000)));
    return;
  }
  if (value.type === 'owner-cancel') {
    engine?.cancelPreparation();
    respond({ ok: true });
    return;
  }
  if (value.type === 'owner-control' && isControl(value.action)) {
    void (async () => {
      if (value.action === 'stop') await engine.stop();
      else if (value.action === 'pause') engine.pause();
      else engine.resume();
      respond({ ok: true });
    })().catch((error) => respond({ ok: false, error: message(error) }));
    return true;
  }
  if (
    value.type === 'owner-start' &&
    initialized &&
    ownsSession &&
    engine.phase === 'idle' &&
    typeof value.source === 'object' &&
    value.source !== null
  ) {
    const source = value.source as { streamId?: unknown; audio?: unknown };
    if (
      typeof source.streamId !== 'string' ||
      !source.streamId ||
      source.streamId.length > 8192 ||
      typeof source.audio !== 'boolean'
    )
      return;
    const streamId = source.streamId;
    const audio = source.audio;
    void (async () => {
      const settings = readOptions((await chrome.storage.local.get('options')).options);
      applyOptions(settings);
      page('studio');
      notice('');
      clearError();
      await engine.start(
        settings,
        () => {
          const mandatory = { chromeMediaSource: 'desktop', chromeMediaSourceId: streamId };
          return navigator.mediaDevices.getUserMedia({
            video: { mandatory },
            audio: audio ? { mandatory } : false,
          } as unknown as MediaStreamConstraints);
        },
        async () => {
          const response = await chrome.runtime.sendMessage({ version: 1, type: 'owner-prepared' });
          if (
            typeof response !== 'object' ||
            response === null ||
            !('ok' in response) ||
            response.ok !== true
          )
            throw new Error('The shared browser could not be restored. Recording was cancelled.');
        }
      );
      respond({ ok: true });
    })().catch((error) => {
      failure(error);
      respond({ ok: false, error: message(error) });
    });
    return true;
  }
  if (value.type === 'owner-start')
    respond({ ok: false, error: 'A recording is already active or the main app is not ready.' });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.options || !initialized || engine?.phase !== 'idle') return;
  try {
    applyOptions(readOptions(changes.options.newValue));
  } catch (error) {
    failure(error);
  }
});
document.addEventListener('visibilitychange', () => {
  if (
    document.visibilityState !== 'visible' ||
    !initialized ||
    engine.phase !== 'idle' ||
    operation
  )
    return;
  void devices()
    .then(async () => {
      if (engine.phase === 'idle' && !operation)
        applyOptions(readOptions((await chrome.storage.local.get('options')).options));
    })
    .catch(failure);
});
button('stop').onclick = button('quick-stop').onclick = () => {
  void engine.stop().catch(failure);
};
button('pause').onclick = () => {
  try {
    if (engine.phase === 'paused') engine.resume();
    else engine.pause();
  } catch (error) {
    failure(error);
  }
};
button('devices').onclick = () => {
  void action(devices);
};
button('refresh-library').onclick = () => {
  void action(refreshLibrary);
};
input('search').oninput = renderLibrary;
select('sort').onchange = renderLibrary;
for (const id of ['bubble-size', 'bubble-shape', 'mirror', 'camera-visible'])
  element(id).addEventListener('input', updateBubble);
const handle = element('bubble-handle');
handle.onpointerdown = (event) => {
  handle.setPointerCapture(event.pointerId);
  moveBubble(event);
};
handle.onpointermove = (event) => {
  if (handle.hasPointerCapture(event.pointerId)) moveBubble(event);
};
handle.onkeydown = (event) => {
  const bubble = engine?.capture?.bubble;
  if (!bubble || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const step = event.shiftKey ? 0.1 : 0.02;
  bubble.x = Math.max(
    0,
    Math.min(
      1,
      bubble.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)
    )
  );
  bubble.y = Math.max(
    0,
    Math.min(1, bubble.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0))
  );
  updateBubble();
};
window.addEventListener('resize', updateBubble);
button('pip').onclick = () => {
  const video = engine?.capture?.cameraVideo;
  if (!video) return;
  void action(async () => {
    if (!document.pictureInPictureEnabled)
      throw new Error('Floating webcam is not supported by this Chrome configuration.');
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else {
      await waitFor(video.play(), 5000, 'The floating camera preview could not start.');
      await video.requestPictureInPicture();
    }
  });
};
button('close-player').onclick = () => dialog.close();
dialog.addEventListener('close', () => {
  player.pause();
  player.removeAttribute('src');
  player.load();
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = undefined;
});
button('theme').onclick = () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('chripify-extension-theme', theme);
  } catch {
    /* In-memory appearance still works. */
  }
};
try {
  document.documentElement.dataset.theme =
    localStorage.getItem('chripify-extension-theme') === 'light' ? 'light' : 'dark';
} catch {
  /* Use default theme. */
}
window.addEventListener('beforeunload', (event) => {
  if (engine && engine.phase !== 'idle') {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener('pagehide', () => {
  engine?.dispose();
  releaseSession?.();
});
window.addEventListener('keydown', (event) => {
  if (!event.altKey || !event.shiftKey) return;
  if (event.code === 'KeyS') {
    event.preventDefault();
    void engine?.stop().catch(failure);
  }
  if (event.code === 'KeyP') {
    event.preventDefault();
    button('pause').click();
  }
});

async function initialize(): Promise<void> {
  if (
    !window.isSecureContext ||
    !navigator.mediaDevices?.getDisplayMedia ||
    typeof MediaRecorder === 'undefined'
  )
    throw new Error('Install this extension in current desktop Chrome to use screen recording.');
  library = await Library.open();
  engine = new RecorderEngine(library, {
    changed: state,
    preview: (stream) => {
      preview.srcObject = stream ?? null;
      element('placeholder').hidden = Boolean(stream);
      if (stream) {
        void preview.play().catch(failure);
        updateBubble();
      }
    },
    warning: notice,
    failed: failure,
    saved: () => {
      notice('Your video is saved locally. Download a copy to keep it outside this browser.');
      page('library');
      void refreshLibrary().catch(failure);
    },
  });
  // A browser-managed lock survives worker suspension and prevents two recorder tabs owning capture.
  void navigator.locks
    .request('chripify-recording-owner', { ifAvailable: true }, async (lock) => {
      if (!lock) {
        notice(
          'Another Chripify recorder tab is open. Use that tab, or close it and reload this one.'
        );
        return;
      }
      await library.recover();
      await refreshLibrary();
      ownsSession = true;
      state('idle');
      await new Promise<void>((resolve) => {
        releaseSession = resolve;
      });
    })
    .catch(failure);
  await refreshLibrary();
  applyOptions(readOptions((await chrome.storage.local.get('options')).options));
  initialized = true;
  // Device labels and quota display must not block the background owner's ready handshake.
  void devices()
    .then(async () => {
      if (engine.phase === 'idle' && !operation)
        applyOptions(readOptions((await chrome.storage.local.get('options')).options));
    })
    .catch(failure);
  void storageInfo().catch(failure);
  setInterval(() => {
    element('elapsed').textContent = clock(engine.elapsed);
    if (engine.phase === 'preparing')
      element('state').textContent = engine.preparationStage || 'Preparing…';
  }, 500);
  setInterval(() => {
    void storageInfo().catch(failure);
  }, 10_000);
}
void initialize().catch(failure);
