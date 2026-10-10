/** Small fetch wrapper for the account service. */
import { API_BASE } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The device is offline or the service can't be reached. */
export class OfflineError extends Error {
  constructor() {
    super(
      'You’re offline. Kinora keeps working — your account will catch up when you’re back online.',
    );
    this.name = 'OfflineError';
  }
}

export interface CallOptions {
  method?: string;
  token?: string | null;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Calls the API and returns the raw response (throws ApiError / OfflineError). */
export async function callRaw(path: string, o: CallOptions = {}): Promise<Response> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError();
  const headers: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.json !== undefined) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 30_000);
  const onAbort = () => ctrl.abort();
  o.signal?.addEventListener('abort', onAbort);
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: o.method ?? 'GET',
      headers,
      body: o.json !== undefined ? JSON.stringify(o.json) : o.body,
      signal: ctrl.signal,
    });
  } catch {
    if (o.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
  if (!res.ok) {
    let code = 'error';
    let message = `Something went wrong (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, code, message);
  }
  return res;
}

export async function call<T>(path: string, o: CallOptions = {}): Promise<T> {
  const res = await callRaw(path, o);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
