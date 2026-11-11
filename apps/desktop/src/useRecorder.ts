import { useEffect, useState } from 'react';
import {
  canStart,
  errorMessage,
  invoke,
  isDesktop,
  type Recording,
  type Source,
  type Status,
} from './contracts';

const initial: Status = { phase: 'idle', startedAt: null, error: null };
export function useRecorder() {
  const [status, setStatus] = useState(initial);
  const [sources, setSources] = useState<Source[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await invoke('get_status');
        if (!cancelled) setStatus(next);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void poll();
        }, 750);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;
    void invoke('list_recordings').then(
      (result) => {
        if (!cancelled) setRecordings(result);
      },
      (reason) => {
        if (!cancelled) setError(errorMessage(reason));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [status.phase]);
  const action = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return {
    status,
    sources,
    recordings,
    error: error ?? status.error?.message,
    busy,
    refreshSources: () =>
      action(async () => {
        setSources(await invoke('list_sources'));
      }),
    start: (displayId: number, fps: number) =>
      action(async () => {
        if (!canStart(status.phase)) return;
        setStatus(await invoke('start_recording', { request: { displayId, fps } }));
      }),
    stop: () =>
      action(async () => {
        setStatus(await invoke('stop_recording'));
      }),
  };
}
