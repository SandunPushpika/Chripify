// Classic isolated-world content script. No page scripts, DOM data, camera devices or network APIs are used.
(() => {
  const global = globalThis as typeof globalThis & { __chripifyOverlay?: boolean };

  if (global.__chripifyOverlay) return;

  global.__chripifyOverlay = true;
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    `:host{all:initial!important;position:fixed!important;z-index:2147483647!important;left:var(--chripify-x,auto)!important;top:var(--chripify-y,auto)!important;right:var(--chripify-right,24px)!important;bottom:var(--chripify-bottom,24px)!important;width:220px!important;color:#f5efff!important;font:12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif!important;display:block!important}*{box-sizing:border-box}section{background:#201b29;border:1px solid #75618e;border-radius:15px;box-shadow:0 8px 35px #0005;padding:10px}button{font:inherit;cursor:pointer;background:#393044;color:#f5efff;border:1px solid #63516f;border-radius:7px;padding:8px}button:focus-visible{outline:2px solid #dbc0ff;outline-offset:2px}button:disabled{opacity:.4;cursor:default}.bar{display:flex;align-items:center;justify-content:space-between;gap:7px}.drag{border:0;background:none;cursor:move;touch-action:none;padding:6px;font-weight:600}.close{border:0;background:none;padding:5px}img{display:block;width:176px;height:176px;object-fit:cover;border-radius:50%;border:3px solid #b498e0;margin:9px auto 12px}.controls{display:flex;gap:6px}.controls button{flex:1;font-size:11px}.stop{background:#773548}.time{font-size:10px;color:#d3bedf;font-variant-numeric:tabular-nums}small{font-size:9px;color:#d3bedf;display:block;line-height:1.5;margin-top:8px}.camera-toggle{font-size:9px;width:100%;padding:5px;margin:7px 0 0}[hidden]{display:none!important}`
  );
  shadow.adoptedStyleSheets = [sheet];
  const box = document.createElement('section');
  box.setAttribute('aria-label', 'Chripify recording controls');
  const bar = document.createElement('div');
  bar.className = 'bar';
  const drag = document.createElement('button');
  drag.className = 'drag';
  drag.textContent = '✥ Chripify';
  drag.setAttribute('aria-label', 'Move recorder overlay. Drag or use arrow keys.');
  const time = document.createElement('span');
  time.className = 'time';
  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = '✕';
  close.setAttribute(
    'aria-label',
    'Hide overlay. Recording continues; use the extension popup for controls.'
  );
  bar.append(drag, time, close);
  const image = document.createElement('img');
  image.alt = 'Live camera preview';
  image.hidden = true;
  const countdown = document.createElement('div');
  countdown.setAttribute('role', 'status');
  countdown.style.cssText = 'font-size:64px;text-align:center;font-weight:700;padding:16px';
  countdown.hidden = true;
  const controls = document.createElement('div');
  controls.className = 'controls';
  const pause = document.createElement('button');
  pause.textContent = 'Pause';
  const stop = document.createElement('button');
  stop.textContent = '■ Stop';
  stop.className = 'stop';
  const toggle = document.createElement('button');
  toggle.className = 'camera-toggle';
  toggle.textContent = 'Hide camera preview';
  const note = document.createElement('small');
  note.textContent = 'Browser overlay may appear in shared video. Hide it with ✕ when needed.';
  controls.append(pause, stop);
  box.append(bar, countdown, image, controls, toggle, note);
  shadow.append(box);
  let phase = 'idle';
  let dismissed = false;
  let cameraHidden = false;
  let polling = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hide(): void {
    host.remove();
    image.removeAttribute('src');
  }

  async function refresh(): Promise<void> {
    if (polling) return;

    clearTimeout(timer);
    polling = true;
    const epoch = generation;

    try {
      const value = await chrome.runtime.sendMessage({
        version: 1,
        type: 'get-state',
        frame: !dismissed && !cameraHidden && !document.hidden,
      });

      if (epoch !== generation) return;

      if (typeof value !== 'object' || value === null || !('phase' in value)) {
        phase = 'idle';
        hide();

        return;
      }

      const state = value as {
        phase: string;
        elapsed?: number;
        camera?: boolean;
        frame?: string;
        warning?: string;
        stage?: string;
      };
      phase = state.phase;
      const remaining =
        phase === 'preparing'
          ? /^Recording starts in ([321])/.exec(state.stage ?? '')?.[1]
          : undefined;
      countdown.hidden = !remaining;
      countdown.textContent = remaining ?? '';
      countdown.setAttribute('aria-label', remaining ? `Recording starts in ${remaining}` : '');

      if (!['recording', 'paused', 'preparing'].includes(phase)) {
        dismissed = false;
        hide();

        return;
      }

      if (dismissed || document.hidden) {
        hide();

        return;
      }

      if (!host.isConnected) document.documentElement.append(host);

      const seconds = Math.max(0, Math.floor((state.elapsed ?? 0) / 1000));
      time.textContent = `${Math.floor(seconds / 60)
        .toString()
        .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
      pause.textContent =
        phase === 'paused' ? 'Resume' : phase === 'preparing' ? 'Preparing…' : 'Pause';
      pause.disabled = phase === 'preparing';
      stop.disabled = false;
      stop.textContent = phase === 'preparing' ? 'Cancel' : '■ Stop';
      toggle.hidden = !state.camera;
      note.textContent =
        phase === 'preparing' && typeof state.stage === 'string'
          ? state.stage.slice(0, 120)
          : typeof state.warning === 'string' && state.warning
          ? state.warning.slice(0, 400)
          : 'Browser overlay may appear in shared video. Hide it with ✕ when needed.';
      image.hidden = !state.camera || cameraHidden;

      if (image.hidden) image.removeAttribute('src');
      else if (
        typeof state.frame === 'string' &&
        state.frame.startsWith('data:image/jpeg;base64,') &&
        state.frame.length <= 100_000
      )
        image.src = state.frame;
    } catch {
      phase = 'idle';
      hide();
    } finally {
      polling = false;

      if (['recording', 'paused', 'preparing'].includes(phase) && !dismissed && !document.hidden)
        timer = setTimeout(() => {
          void refresh();
        }, 200);
    }
  }

  pause.onclick = (event) => {
    if (event.isTrusted)
      void chrome.runtime
        .sendMessage({
          version: 1,
          type: 'control',
          action: phase === 'paused' ? 'resume' : 'pause',
        })
        .then(refresh)
        .catch(hide);
  };
  stop.onclick = (event) => {
    if (event.isTrusted) {
      stop.disabled = true;
      void chrome.runtime
        .sendMessage({ version: 1, type: 'control', action: 'stop' })
        .then(refresh)
        .catch(hide);
    }
  };
  close.onclick = (event) => {
    if (event.isTrusted) {
      dismissed = true;
      clearTimeout(timer);
      hide();
    }
  };
  toggle.onclick = (event) => {
    if (event.isTrusted) {
      cameraHidden = !cameraHidden;
      toggle.textContent = cameraHidden ? 'Show camera preview' : 'Hide camera preview';
      void refresh();
    }
  };
  let offsetX = 0;
  let offsetY = 0;

  function move(x: number, y: number): void {
    const rectangle = host.getBoundingClientRect();
    host.style.setProperty(
      '--chripify-x',
      `${Math.max(0, Math.min(innerWidth - rectangle.width, x))}px`
    );
    host.style.setProperty(
      '--chripify-y',
      `${Math.max(0, Math.min(innerHeight - rectangle.height, y))}px`
    );
    host.style.setProperty('--chripify-right', 'auto');
    host.style.setProperty('--chripify-bottom', 'auto');
  }

  drag.onpointerdown = (event) => {
    const r = host.getBoundingClientRect();
    offsetX = event.clientX - r.left;
    offsetY = event.clientY - r.top;
    drag.setPointerCapture(event.pointerId);
  };
  drag.onpointermove = (event) => {
    if (drag.hasPointerCapture(event.pointerId))
      move(event.clientX - offsetX, event.clientY - offsetY);
  };
  drag.onkeydown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;

    event.preventDefault();
    const r = host.getBoundingClientRect();
    const step = event.shiftKey ? 30 : 10;
    move(
      r.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
      r.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)
    );
  };
  chrome.runtime.onMessage.addListener((value, sender) => {
    if (
      sender.id !== chrome.runtime.id ||
      typeof value !== 'object' ||
      value === null ||
      !('type' in value)
    )
      return;

    if (value.type === 'overlay-disabled') {
      generation++;
      phase = 'idle';
      clearTimeout(timer);
      hide();

      return;
    }

    if (value.type === 'overlay-show') {
      dismissed = false;
      generation++;
      clearTimeout(timer);

      if ('phase' in value && typeof value.phase === 'string') phase = value.phase;

      void refresh();

      return;
    }

    if (value.type !== 'overlay-status') return;

    generation++;
    clearTimeout(timer);

    if ('phase' in value && (value.phase === 'idle' || value.phase === 'stopping')) {
      phase = 'idle';
      dismissed = false;
      hide();
    } else {
      if ('phase' in value && typeof value.phase === 'string') phase = value.phase;

      void refresh();
    }
  });
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);

    if (document.hidden) hide();
    else void refresh();
  });
  window.addEventListener('pagehide', () => {
    generation++;
    phase = 'idle';
    clearTimeout(timer);
    hide();
  });
  void refresh();
})();
