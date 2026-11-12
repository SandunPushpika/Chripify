import { validBadge, type Phase } from './domain.js';
import { chooseDesktopSource } from './desktop-source.js';
import { abortReason, waitFor } from './lifecycle.js';
import {
  canReadOverlay,
  isControl,
  isLiveState,
  overlayOrigins,
  validEnvelope,
  type LiveState,
} from './integration.js';

const url = chrome.runtime.getURL('recorder.html');
const popup = chrome.runtime.getURL('popup.html');

const idle = (): LiveState => ({ phase: 'idle', elapsed: 0, camera: false });

let opening: Promise<number> | undefined;
let starting = false;
let startup: AbortController | undefined;
let phase: Phase = 'idle';
let badgeQueue = Promise.resolve();

async function recorderContext() {
  const contexts = await chrome.runtime.getContexts({ documentUrls: [url] });
  const saved = await chrome.storage.session.get('recorderTab');

  return contexts.find((context) => context.tabId === saved.recorderTab) ?? contexts[0];
}

async function owner(focus = false): Promise<number> {
  const context = await recorderContext();

  if (context && context.tabId >= 0) {
    if (focus) {
      await chrome.tabs.update(context.tabId, { active: true });
      await chrome.windows.update(context.windowId, { focused: true });
    }

    return context.tabId;
  }

  if (opening) return opening;

  opening = chrome.tabs.create({ url, active: focus }).then(async (tab) => {
    if (tab.id === undefined) throw new Error('Could not open the recording app.');

    await chrome.storage.session.set({ recorderTab: tab.id });

    return tab.id;
  });

  try {
    return await opening;
  } finally {
    opening = undefined;
  }
}

async function broadcast(): Promise<void> {
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id !== undefined)
      void chrome.tabs
        .sendMessage(tab.id, { version: 1, type: 'overlay-status', phase })
        .catch(() => undefined);
  }
}

function status(next: Phase): void {
  phase = next;
  badgeQueue = badgeQueue
    .then(async () => {
      const text = { idle: '', preparing: '…', recording: 'REC', paused: 'Ⅱ', stopping: '…' }[next];
      await chrome.action.setBadgeBackgroundColor({
        color: next === 'paused' ? '#936018' : '#b83253',
      });
      await chrome.action.setBadgeText({ text });
      await chrome.action.setTitle({
        title: next === 'idle' ? 'Chripify recorder' : `Chripify: ${next}`,
      });
      await chrome.storage.session.set({ phase: next });

      if (next === 'idle' && phase === 'idle') {
        await chrome.storage.session.remove('overlayGrant');
        await chrome.storage.session.remove('startupReturnTab');
      }

      await broadcast();
    })
    .catch(() => undefined);
}

async function inject(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });

    return true;
  } catch {
    return false;
  } // Chrome internal pages/Web Store disallow injection.
}

async function showOverlay(tabId: number): Promise<boolean> {
  const target = await chrome.tabs.get(tabId);

  if (!target.url || !/^https?:\/\//.test(target.url)) return false;

  await chrome.storage.session.set({ overlayGrant: { tabId, origin: new URL(target.url).origin } });

  if (!(await inject(tabId))) return false;

  const saved = await chrome.storage.session.get('phase');
  await chrome.tabs
    .sendMessage(tabId, { version: 1, type: 'overlay-show', phase: saved.phase ?? 'idle' })
    .catch(() => undefined);

  return true;
}

async function registerOverlay(): Promise<void> {
  const allowed = await chrome.permissions.contains({ origins: overlayOrigins });
  const registered = (await chrome.scripting.getRegisteredContentScripts()).some(
    (script) => script.id === 'chripify-overlay'
  );

  if (allowed && !registered)
    await chrome.scripting.registerContentScripts([
      {
        id: 'chripify-overlay',
        matches: overlayOrigins,
        js: ['content.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);

  if (allowed) {
    const saved = await chrome.storage.session.get('phase');

    if (saved.phase && saved.phase !== 'idle')
      for (const tab of await chrome.tabs.query({ active: true })) {
        if (tab.id !== undefined) await showOverlay(tab.id).catch(() => false);
      }
  }

  if (!allowed && registered)
    await chrome.scripting.unregisterContentScripts({ ids: ['chripify-overlay'] });

  if (!allowed)
    for (const tab of await chrome.tabs.query({})) {
      if (tab.id !== undefined)
        void chrome.tabs
          .sendMessage(tab.id, { version: 1, type: 'overlay-disabled' })
          .catch(() => undefined);
    }
}

async function ready(tabId: number, signal: AbortSignal): Promise<void> {
  const deadline = performance.now() + 5000;

  while (performance.now() < deadline) {
    if (signal.aborted) throw abortReason(signal);

    const result = await waitFor(
      chrome.tabs.sendMessage(tabId, { version: 1, type: 'owner-ready' }),
      500,
      'Recorder readiness timed out.',
      signal
    ).catch(() => {
      if (signal.aborted) throw abortReason(signal);

      return undefined;
    });

    if (typeof result === 'object' && result !== null && 'ready' in result && result.ready === true)
      return;

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    'The recorder is not ready. Open the main app and close duplicate recorder tabs.'
  );
}

async function start(returnTab?: number): Promise<void> {
  if (starting || phase !== 'idle') return;

  starting = true;
  const preparation = new AbortController();
  startup = preparation;
  const signal = preparation.signal;
  const deadline = setTimeout(
    () => preparation.abort(new Error('Recording startup timed out. Retry from the main app.')),
    230_000
  );
  status('preparing');

  try {
    void chrome.storage.session.remove('lastError').catch(() => undefined);

    if (returnTab !== undefined)
      await waitFor(
        chrome.storage.session.set({ startupReturnTab: returnTab }),
        2000,
        'The startup target could not be saved.',
        signal
      );

    if (returnTab !== undefined)
      await waitFor(
        showOverlay(returnTab),
        2000,
        'The browser overlay did not respond.',
        signal
      ).catch(() => undefined);

    // Input permission prompts and browser media initialization need a visible consuming document.
    const tabId = await waitFor(
      owner(true),
      5000,
      'The recording app did not open in time.',
      signal
    );
    await ready(tabId, signal);
    const stored = await waitFor(
      chrome.storage.local.get('options'),
      5000,
      'Recording settings could not be loaded.',
      signal
    );
    const audio =
      typeof stored.options === 'object' &&
      stored.options !== null &&
      'sharedAudio' in stored.options
        ? stored.options.sharedAudio === true
        : true;
    const target = await waitFor(
      chrome.tabs.get(tabId),
      2000,
      'The recorder tab did not respond.',
      signal
    );
    const stillOwner = (
      await waitFor(
        chrome.runtime.getContexts({ documentUrls: [url] }),
        2000,
        'The recorder context did not respond.',
        signal
      )
    ).some((context) => context.tabId === tabId);

    if (!stillOwner)
      throw new Error(
        'The recorder tab was closed or navigated away. Open the main app and retry.'
      );

    // Own-extension URLs are known from getContexts; no broad tabs permission is needed.
    const source = await chooseDesktopSource(
      { ...target, url: target.url ?? url },
      audio,
      120_000,
      signal
    );
    const response = await waitFor(
      chrome.tabs.sendMessage(tabId, {
        version: 1,
        type: 'owner-start',
        source,
      }),
      95_000,
      'The recording app did not finish preparation. Check its permission prompts and retry.',
      signal
    );

    if (
      typeof response !== 'object' ||
      response === null ||
      !('ok' in response) ||
      response.ok !== true
    ) {
      throw new Error(
        typeof response === 'object' && response !== null && 'error' in response
          ? String(response.error)
          : 'Could not start recording.'
      );
    }

    if (returnTab !== undefined) {
      await inject(returnTab);
      await chrome.tabs.update(returnTab, { active: true }).catch(() => undefined);
    }
  } catch (error) {
    const current = await waitFor(
      recorderContext(),
      2000,
      'The recorder context did not respond.'
    ).catch(() => undefined);

    if (current)
      await waitFor(
        chrome.tabs.sendMessage(current.tabId, { version: 1, type: 'owner-cancel' }),
        1000,
        'Cancellation timed out.'
      ).catch(() => undefined);

    const active = current
      ? await waitFor(
          chrome.tabs.sendMessage(current.tabId, { version: 1, type: 'owner-state', frame: false }),
          2000,
          'The recorder did not respond.'
        ).catch(() => undefined)
      : undefined;
    status(isLiveState(active) ? active.phase : 'idle');

    if (
      !(error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name))
    ) {
      const text = error instanceof Error ? error.message : 'Recording could not start.';
      await chrome.storage.session.set({ lastError: text });
      const tabId = await waitFor(
        owner(true),
        5000,
        'The recording app could not be opened.'
      ).catch(() => undefined);

      if (tabId !== undefined)
        await waitFor(
          chrome.tabs.sendMessage(tabId, { version: 1, type: 'owner-error', error: text }),
          2000,
          'The error could not be displayed.'
        ).catch(() => undefined);
    } else if (returnTab !== undefined)
      await chrome.tabs.update(returnTab, { active: true }).catch(() => undefined);
  } finally {
    clearTimeout(deadline);

    if (startup === preparation) startup = undefined;

    starting = false;
  }
}

async function live(frame: boolean): Promise<LiveState> {
  const preparing = (): LiveState => ({
    ...idle(),
    phase: 'preparing',
    stage: 'Choose what to share, or allow camera/microphone in the recorder tab',
  });

  const stored = await chrome.storage.session.get('phase');

  if ((stored.phase === undefined || stored.phase === 'idle') && !starting && phase === 'idle')
    return idle();

  const context = await recorderContext();

  if (!context || context.tabId < 0) {
    if (starting && !startup?.signal.aborted) return preparing();

    status('idle');

    return idle();
  }

  const result = await waitFor(
    chrome.tabs.sendMessage(context.tabId, { version: 1, type: 'owner-state', frame }),
    2000,
    'The recorder did not respond.'
  ).catch(() => undefined);

  if (!isLiveState(result)) {
    if (starting && !startup?.signal.aborted) return preparing();

    status('idle');

    return idle();
  }

  if (starting && phase === 'preparing' && result.phase === 'idle' && !startup?.signal.aborted)
    return preparing();

  if (phase !== result.phase) status(result.phase);

  return result;
}

chrome.runtime.onMessage.addListener((value, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;

  const origin = sender.url?.split('#')[0];

  if (origin === url && validBadge(value)) {
    if (sender.tab?.id !== undefined)
      void chrome.storage.session.set({ recorderTab: sender.tab.id });

    if (!(starting && value.phase === 'idle' && phase === 'preparing')) status(value.phase);

    return;
  }

  if (origin === url && validEnvelope(value) && value.type === 'owner-prepared') {
    void (async () => {
      const owner = await chrome.storage.session.get('recorderTab');

      if (sender.tab?.id !== owner.recorderTab)
        throw new Error('The recording owner changed during preparation.');

      const saved = await chrome.storage.session.get('startupReturnTab');

      if (typeof saved.startupReturnTab === 'number') {
        const target = await chrome.tabs.get(saved.startupReturnTab);
        await chrome.tabs.update(saved.startupReturnTab, { active: true });
        await chrome.windows.update(target.windowId, { focused: true });
      }

      await chrome.storage.session.remove('startupReturnTab');
      respond({ ok: true });
    })().catch((error) =>
      respond({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not return to the shared browser.',
      })
    );

    return true;
  }

  if (!validEnvelope(value)) return;

  const fromPopup = origin === popup;
  const fromPage =
    sender.tab?.id !== undefined && sender.frameId === 0 && /^https?:\/\//.test(origin ?? '');

  if (!fromPopup && !fromPage) return;

  const route = async (): Promise<unknown> => {
    if (fromPage && sender.tab?.id !== undefined) {
      const tab = await chrome.tabs.get(sender.tab.id);
      const wide = await chrome.permissions.contains({ origins: overlayOrigins });
      const stored = await chrome.storage.session.get('overlayGrant');
      const grant = stored.overlayGrant as { tabId?: number; origin?: string } | undefined;

      if (!canReadOverlay(tab, sender.url ?? '', sender.tab.id, wide, grant))
        return value.type === 'get-state' ? idle() : { ok: false };
    }

    if (value.type === 'get-state') {
      return live(fromPage && value.frame === true);
    }

    if (value.type === 'control' && isControl(value.action)) {
      if (value.action === 'stop' && starting)
        startup?.abort(new DOMException('Recording preparation cancelled.', 'AbortError'));

      const context = await recorderContext();

      if (context)
        return chrome.tabs.sendMessage(context.tabId, {
          version: 1,
          type: 'owner-control',
          action: value.action,
        });

      return { ok: false };
    }

    if (!fromPopup) return { ok: false };

    if (
      value.type === 'show-overlay' &&
      typeof value.tabId === 'number' &&
      Number.isSafeInteger(value.tabId) &&
      value.tabId >= 0
    )
      return { ok: await showOverlay(value.tabId) };

    if (value.type === 'open-app') {
      await owner(true);

      return { ok: true };
    }

    if (value.type === 'overlay-access') {
      await registerOverlay();

      return { ok: true };
    }

    if (
      value.type === 'start' &&
      (value.returnTab === undefined ||
        (typeof value.returnTab === 'number' &&
          Number.isSafeInteger(value.returnTab) &&
          value.returnTab >= 0))
    ) {
      const current = await live(false);

      if (starting || current.phase !== 'idle')
        return { ok: false, error: 'A recording is already active.' };

      void start(value.returnTab as number | undefined).catch(() => undefined);

      return { ok: true };
    }

    return { ok: false };
  };

  void route().then(respond, (error) =>
    respond({
      ok: false,
      error: error instanceof Error ? error.message : 'The recorder is unavailable.',
    })
  );

  return true;
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.storage.session.get('phase').then((stored) => {
    if (stored.phase && stored.phase !== 'idle') void inject(tabId);
  });
});
chrome.tabs.onRemoved.addListener((id) => {
  void chrome.storage.session.get('recorderTab').then(async (stored) => {
    if (stored.recorderTab === id) {
      status('idle');
      await chrome.storage.session.remove('recorderTab');
    }
  });
});
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-recorder') void owner(true).catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => {
  status('idle');
  void registerOverlay().catch(() => undefined);
});
