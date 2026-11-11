export type Phase =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'paused'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';
export interface AppError {
  code: string;
  message: string;
}
export interface Status {
  phase: Phase;
  startedAt: number | null;
  error: AppError | null;
}
export interface Source {
  id: number;
  width: number;
  height: number;
}
export interface Recording {
  id: string;
  createdAt: number;
  bytes: number;
  path: string;
  missing: boolean;
}
export interface Commands {
  get_status: { args: undefined; result: Status };
  list_sources: { args: undefined; result: Source[] };
  start_recording: { args: { request: { displayId: number; fps: number } }; result: Status };
  stop_recording: { args: undefined; result: Status };
  list_recordings: { args: undefined; result: Recording[] };
}
declare global {
  interface Window {
    __TAURI__?: { core: { invoke: <T>(command: string, args?: unknown) => Promise<T> } };
  }
}
export const isDesktop = () => Boolean(window.__TAURI__);
export async function invoke<K extends keyof Commands>(
  command: K,
  ...parameters: Commands[K]['args'] extends undefined ? [] : [Commands[K]['args']]
): Promise<Commands[K]['result']> {
  const api = window.__TAURI__?.core;
  if (!api)
    throw new Error(
      'Open the desktop app to record. Browser preview cannot access native capture.'
    );
  return api.invoke<Commands[K]['result']>(command, parameters[0]);
}
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message;
  return 'Something went wrong. Please try again.';
}
export function elapsed(startedAt: number | null, now: number): string {
  const seconds = startedAt === null ? 0 : Math.max(0, Math.floor(now / 1000 - startedAt));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
export function canStart(phase: Phase): boolean {
  return ['idle', 'completed', 'failed', 'cancelled'].includes(phase);
}
