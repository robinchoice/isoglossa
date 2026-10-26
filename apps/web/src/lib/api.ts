import { errorSchema } from '@app/shared';
import { page } from '$app/state';
import { toastError } from './toast.svelte';

// The last failed calls, newest first. Feedback sends them along.
export const recentErrors: string[] = [];

function noteError(method: string, path: string, status: number | string) {
  recentErrors.unshift(`${method} /api/v1${path} → ${status}`);
  recentErrors.length = Math.min(recentErrors.length, 5);
}

type RequestOptions = { silent?: boolean; signal?: AbortSignal | undefined };

// The API answers errors as { error: string } in the current language; they
// show up as a toast unless silent.
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  { silent = false, signal }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { 'accept-language': page.data.locale };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
    signal: signal ?? null,
  }).catch((err) => {
    noteError(method, path, 'offline');
    throw err;
  });

  if (!res.ok) {
    noteError(method, path, res.status);
    const answer = errorSchema.safeParse(await res.json().catch(() => null));
    const { error } = answer.data ?? { error: res.statusText };
    if (!silent) toastError(error);
    throw new Error(error);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
