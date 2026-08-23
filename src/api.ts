export const DEFAULT_BASE_URL = 'https://dropley.app';

// ---------------------------------------------------------------------------
// Values mirrored from https://dropley.app/api/v1/openapi.json
// ---------------------------------------------------------------------------

export const SOURCE_VALUES = [
  'claude-code',
  'chatgpt',
  'cursor',
  'lovable',
  'bolt',
  'storybook',
  'figma',
  'other',
] as const;

export type SourceValue = (typeof SOURCE_VALUES)[number];

export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 50;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly hint?: string;
  readonly retryAfter?: number;
  readonly requestId?: string;

  constructor(
    message: string,
    opts: {
      status: number;
      code?: string;
      hint?: string;
      retryAfter?: number;
      requestId?: string;
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.hint = opts.hint;
    this.retryAfter = opts.retryAfter;
    this.requestId = opts.requestId;
  }
}

interface ErrorBody {
  error?: unknown;
  code?: unknown;
  message?: unknown;
  hint?: unknown;
  requestId?: unknown;
}

function parseErrorBody(status: number, text: string, retryAfterHeader?: string | null): ApiError {
  let body: ErrorBody | undefined;
  try {
    body = JSON.parse(text) as ErrorBody;
  } catch {
    // non-JSON body (e.g. HTML error page)
  }

  if (body && typeof body === 'object') {
    // Nested rate-limit shape: { error: { code, message } }
    if (body.error && typeof body.error === 'object') {
      const nested = body.error as Record<string, unknown>;
      return new ApiError(String(nested.message ?? 'Request failed'), {
        status,
        code: nested.code !== undefined ? String(nested.code) : undefined,
        hint: nested.hint !== undefined ? String(nested.hint) : undefined,
        retryAfter: parseRetryAfter(retryAfterHeader),
      });
    }
    // Flat shape: { error?, code?, message?, hint? }
    const flatMessage =
      firstString(body.message) ??
      firstString(body.error) ??
      (body.requestId !== undefined ? `Server error (${String(body.requestId)})` : undefined) ??
      'Request failed';
    return new ApiError(flatMessage, {
      status,
      code: firstString(body.code),
      hint: firstString(body.hint),
      retryAfter: parseRetryAfter(retryAfterHeader),
      requestId: body.requestId !== undefined ? String(body.requestId) : undefined,
    });
  }

  return new ApiError(text.slice(0, 200) || 'Request failed', {
    status,
    retryAfter: parseRetryAfter(retryAfterHeader),
  });
}

function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  const n = Number.parseFloat(header);
  return Number.isNaN(n) || n < 0 ? undefined : n;
}

function firstString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// ---------------------------------------------------------------------------
// Retry (HTTP 429)
// ---------------------------------------------------------------------------

export interface RetryInfo {
  /** 1-based retry number (1 = first retry). */
  attempt: number;
  /** How long the client waits before retrying, in milliseconds. */
  delayMs: number;
}

export interface RequestOptions {
  timeoutMs?: number;
  /** Whether to retry on 429. Defaults to true; pass false to disable. */
  retry?: boolean;
  /** Number of retries after the initial attempt. Defaults to 2 (3 total). */
  maxRetries?: number;
  /** Injectable delay, for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry. */
  onRetry?: (info: RetryInfo) => void;
}

const MAX_RETRY_DELAY_MS = 30_000;
const BASE_BACKOFF_MS = 1000;
const DEFAULT_MAX_RETRIES = 2;

export function computeRetryDelay(retryAfterSeconds: number | undefined, attempt: number): number {
  if (retryAfterSeconds !== undefined) {
    return Math.min(Math.round(retryAfterSeconds * 1000), MAX_RETRY_DELAY_MS);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(
  baseUrl: string,
  path: string,
  makeInit: () => RequestInit,
  opts: RequestOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryEnabled = opts.retry !== false;
  const sleep = opts.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    const init = makeInit();
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
        throw new ApiError(`Request timed out after ${timeoutMs / 1000}s`, {
          status: 0,
          hint: 'Check your network connection, or point --api at a reachable server.',
        });
      }
      throw new ApiError(`Network error: ${(err as Error).message}`, {
        status: 0,
        hint: 'Check your network connection, or point --api at a reachable server.',
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const apiErr = parseErrorBody(res.status, text, res.headers.get('retry-after'));
      if (apiErr.status === 429 && retryEnabled && attempt < maxRetries) {
        const delayMs = computeRetryDelay(apiErr.retryAfter, attempt);
        opts.onRetry?.({ attempt: attempt + 1, delayMs });
        await sleep(delayMs);
        continue;
      }
      throw apiErr;
    }
    return res;
  }
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  makeInit: () => RequestInit,
  opts: RequestOptions = {},
): Promise<T> {
  const res = await request(baseUrl, path, makeInit, opts);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Types mirroring https://dropley.app/api/v1/openapi.json (operationIds:
// createArtifact, getArtifact, updateArtifact, deleteArtifact)
// ---------------------------------------------------------------------------

export interface CreateResult {
  shortId: string;
  url: string;
  expiresAt: string | null;
  artifactToken: string;
}

export interface ArtifactInfo {
  shortId: string;
  status: string;
  url?: string;
  expiresAt?: string | null;
  source?: string;
  tags?: string[];
  createdAt?: string;
  error?: string;
  [key: string]: unknown;
}

export interface UpdateResult {
  success: boolean;
  expiresAt?: string | null;
  source?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface UploadPart {
  /** Path used as the multipart filename and manifest entry (POSIX style). */
  path: string;
  contentType: string;
  data: Uint8Array;
}

export interface CreateOptions extends RequestOptions {
  expiry?: string;
  source?: string;
  tags?: string[];
  entry?: string;
  /** Receives cumulative bytes sent vs. total, as the body streams out. */
  onProgress?: (sent: number, total: number) => void;
}

function buildManifest(parts: readonly UploadPart[], entry: string): string {
  return JSON.stringify({
    manifestVersion: 1,
    entry,
    files: parts.map((p) => ({
      path: p.path,
      size: p.data.length,
      contentType: p.contentType,
    })),
  });
}

function escapeFilename(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildMultipartBody(
  manifest: string,
  parts: readonly UploadPart[],
  opts: { expiry?: string; source?: string; tags?: string[] },
): { body: Uint8Array; contentType: string } {
  const boundary = `----dropley-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const enc = new TextEncoder();
  const segments: Uint8Array[] = [];
  const push = (s: string) => segments.push(enc.encode(s));

  push(`--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n`);
  push(manifest);
  push('\r\n');
  if (opts.expiry !== undefined) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="expiry"\r\n\r\n${opts.expiry}\r\n`);
  }
  if (opts.source !== undefined) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\n${opts.source}\r\n`);
  }
  if (opts.tags !== undefined && opts.tags.length > 0) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\n${opts.tags.join(',')}\r\n`);
  }
  for (const part of parts) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${escapeFilename(part.path)}"\r\nContent-Type: ${part.contentType}\r\n\r\n`,
    );
    segments.push(part.data);
    push('\r\n');
  }
  push(`--${boundary}--\r\n`);

  const total = segments.reduce((n, s) => n + s.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const s of segments) {
    body.set(s, offset);
    offset += s.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function bytesToStream(
  body: Uint8Array,
  onProgress?: (sent: number, total: number) => void,
): ReadableStream<Uint8Array> {
  const total = body.length;
  const CHUNK = 256 * 1024;
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      await Promise.resolve();
      const end = Math.min(sent + CHUNK, total);
      controller.enqueue(body.subarray(sent, end));
      sent = end;
      onProgress?.(sent, total);
    },
  });
}

export function createArtifact(
  baseUrl: string,
  parts: readonly UploadPart[],
  opts: CreateOptions = {},
): Promise<CreateResult> {
  const manifest = buildManifest(parts, opts.entry ?? 'index.html');
  const { body, contentType } = buildMultipartBody(manifest, parts, opts);

  const makeInit = (): RequestInit => {
    let sent = 0;
    const stream = bytesToStream(body, (n) => {
      sent = n;
      opts.onProgress?.(sent, body.length);
    });
    return {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: stream,
      duplex: 'half',
    };
  };

  return requestJson<CreateResult>(baseUrl, '/api/artifacts', makeInit, {
    timeoutMs: opts.timeoutMs ?? 300_000,
    retry: opts.retry,
    maxRetries: opts.maxRetries,
    sleep: opts.sleep,
    onRetry: opts.onRetry,
  });
}

export function getArtifact(
  baseUrl: string,
  shortId: string,
  token?: string,
  opts: RequestOptions = {},
): Promise<ArtifactInfo> {
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return requestJson<ArtifactInfo>(
    baseUrl,
    `/api/artifacts/${encodeURIComponent(shortId)}${query}`,
    () => ({ method: 'GET' }),
    opts,
  );
}

export function updateArtifact(
  baseUrl: string,
  shortId: string,
  token: string,
  patch: Record<string, unknown>,
  opts: RequestOptions = {},
): Promise<UpdateResult> {
  return requestJson<UpdateResult>(
    baseUrl,
    `/api/artifacts/${encodeURIComponent(shortId)}`,
    () => ({
      method: 'PATCH',
      headers: { 'X-Artifact-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    opts,
  );
}

export function deleteArtifact(
  baseUrl: string,
  shortId: string,
  token: string,
  opts: RequestOptions = {},
): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>(
    baseUrl,
    `/api/artifacts/${encodeURIComponent(shortId)}`,
    () => ({ method: 'DELETE', headers: { 'X-Artifact-Token': token } }),
    opts,
  );
}
