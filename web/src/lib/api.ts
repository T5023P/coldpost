import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

// In production the frontend is served by Cloudflare Pages and the API lives on
// https://api.coldpost.delivery, so every request needs an absolute base URL.
// Empty value keeps the same-origin behaviour used by local development.
const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<
  string,
  string | undefined
>;

export const API_BASE = (env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

/** Absolute URL for an API or upload path; leaves absolute URLs untouched. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
};

export async function api<T = any>(path: string, options: Options = {}): Promise<T> {
  const init: RequestInit = { method: options.method ?? 'GET', credentials: API_BASE ? 'include' : 'same-origin' };
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.formData) {
    init.body = options.formData;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  // Production auth: send the Supabase access token so the API can verify it.
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.authorization = `Bearer ${token}`;
    } catch {
      /* signed out or storage unavailable */
    }
  }
  init.headers = headers;
  let response: Response;
  try {
    response = await fetch(apiUrl(path.startsWith('/api') || path.startsWith('/uploads') ? path : `/api${path}`), init);
  } catch {
    throw new ApiError(0, 'Cannot reach the Cold Post server. Is it running?');
  }
  if (response.status === 401 && !path.includes('/auth/login')) {
    window.dispatchEvent(new Event('cp:unauthorized'));
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (!response.ok) throw new ApiError(response.status, data.error ?? 'Request failed', data.details);
    return data as T;
  }
  if (!response.ok) throw new ApiError(response.status, `Request failed (${response.status})`);
  return (await response.text()) as unknown as T;
}

export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export async function uploadFile(file: File, extra: Record<string, string>) {
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return api<{ attachment: any; url: string }>('/uploads', { method: 'POST', formData: form });
}

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    if (!path) {
      setLoading(false);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (id === requestId.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === requestId.current) setError((err as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}

export function downloadCsv(path: string, filename: string) {
  const link = document.createElement('a');
  link.href = apiUrl(path);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
