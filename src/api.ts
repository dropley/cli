export const DEFAULT_BASE_URL = 'https://dropley.app';

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
  const n = Number.parseInt(header, 10);
  return Number.isNaN(n) ? undefined : n;
}

function firstString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

async function request(
  baseUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
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
    throw parseErrorBody(res.status, text, res.headers.get('retry-after'));
  }
  return res;
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs = 30_000,
): Promise<T> {
  const res = await request(baseUrl, path, init, timeoutMs);
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

export function createArtifact(
  baseUrl: string,
  parts: readonly UploadPart[],
  opts: { expiry?: string; entry?: string; timeoutMs?: number },
): Promise<CreateResult> {
  const form = new FormData();
  form.set('manifest', buildManifest(parts, opts.entry ?? 'index.html'));
  if (opts.expiry !== undefined) form.set('expiry', opts.expiry);
  for (const part of parts) {
    form.append('file', new File([part.data], part.path, { type: part.contentType }));
  }
  return requestJson<CreateResult>(
    baseUrl,
    '/api/artifacts',
    { method: 'POST', body: form },
    opts.timeoutMs ?? 300_000,
  );
}

export function getArtifact(
  baseUrl: string,
  shortId: string,
  token?: string,
): Promise<ArtifactInfo> {
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return requestJson<ArtifactInfo>(
    baseUrl,
    `/api/artifacts/${encodeURIComponent(shortId)}${query}`,
    { method: 'GET' },
  );
}

export function updateArtifact(
  baseUrl: string,
  shortId: string,
  token: string,
  patch: Record<string, unknown>,
): Promise<UpdateResult> {
  return requestJson<UpdateResult>(
    baseUrl,
    `/api/artifacts/${encodeURIComponent(shortId)}`,
    {
      method: 'PATCH',
      headers: { 'X-Artifact-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
}

export function deleteArtifact(
  baseUrl: string,
  shortId: string,
  token: string,
): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>(
    baseUrl,
    `/api/artifacts/${encodeURIComponent(shortId)}`,
    { method: 'DELETE', headers: { 'X-Artifact-Token': token } },
  );
}
