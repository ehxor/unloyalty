import type { AccountUser } from '../db/meta';
import type { WireCard } from '../db/schema';

/** The server answered with an error (code is the server's stable error code). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The server couldn't be reached (offline, DNS, tailnet down, …). */
export class NetworkError extends Error {}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string;
}

/** Same-origin JSON call to /api. Never cached by the service worker. */
export async function apiFetch<T>(path: string, { method = 'GET', body, token }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : String(err));
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = json && typeof json === 'object' && 'error' in json && json.error && typeof json.error === 'object' ? json.error : {};
    const code = 'code' in error && typeof error.code === 'string' ? error.code : 'http_error';
    const message = 'message' in error && typeof error.message === 'string' ? error.message : `Server error (${res.status})`;
    throw new ApiError(res.status, code, message);
  }
  return json as T;
}

export interface SessionResponse {
  token: string;
  user: AccountUser;
}

export interface ServerConfig {
  registrationOpen: boolean;
  version: string;
}

export interface SyncRequest {
  dbId?: string;
  cursor: number;
  changes: WireCard[];
}

export interface SyncResponse {
  dbId: string;
  cursor: number;
  /** Untrusted until validated with parseWireCard. */
  changes: unknown[];
}
