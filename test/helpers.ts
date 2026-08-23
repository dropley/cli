import { vi } from 'vitest';

export type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Replaces global fetch with a handler; returns the mock for assertions. */
export function stubFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string | URL, init: RequestInit = {}) => handler(String(url), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function jsonResponse(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export interface CapturedStdio {
  stdout: string;
  stderr: string;
}

/** Captures process.stdout/stderr writes; call `capture()` in beforeEach. */
export function captureStdio(): { stream: CapturedStdio; restore: () => void } {
  const stream = { stdout: '', stderr: '' };
  const spies = [
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stream.stdout += String(chunk);
      return true;
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stream.stderr += String(chunk);
      return true;
    }),
  ];
  return { stream, restore: () => spies.forEach((s) => s.mockRestore()) };
}