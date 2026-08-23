import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createArtifact,
  deleteArtifact,
  getArtifact,
  updateArtifact,
  type UploadPart,
} from '../src/api.js';
import { jsonResponse, stubFetch } from './helpers.js';

const PARTS: UploadPart[] = [
  { path: 'index.html', contentType: 'text/html', data: Buffer.from('<h1>hi</h1>') },
  { path: 'assets/app.css', contentType: 'text/css', data: Buffer.from('body{}') },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createArtifact', () => {
  it('sends manifest + ordered file parts and parses the 201 body', async () => {
    const fetchMock = stubFetch((url, init) => {
      expect(url).toBe('https://dropley.app/api/artifacts');
      expect(init.method).toBe('POST');
      const form = init.body as FormData;
      const manifest = JSON.parse(form.get('manifest') as string);
      expect(manifest).toEqual({
        manifestVersion: 1,
        entry: 'index.html',
        files: [
          { path: 'index.html', size: 11, contentType: 'text/html' },
          { path: 'assets/app.css', size: 6, contentType: 'text/css' },
        ],
      });
      const files = form.getAll('file') as File[];
      expect(files.map((f) => f.name)).toEqual(['index.html', 'assets/app.css']);
      expect(files[0]?.type).toBe('text/html');
      expect(files[1]?.type).toBe('text/css');
      return jsonResponse(
        {
          shortId: 'aB3cD5eF',
          url: 'https://preview.dropley.app/p/aB3cD5eF',
          expiresAt: null,
          artifactToken: 'tok_123',
        },
        201,
      );
    });

    const result = await createArtifact('https://dropley.app', PARTS, { expiry: '7d' });
    expect(result.shortId).toBe('aB3cD5eF');
    expect(result.artifactToken).toBe('tok_123');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('omits expiry when not provided', async () => {
    stubFetch((_url, init) => {
      const form = init.body as FormData;
      expect(form.get('expiry')).toBeNull();
      return jsonResponse({ shortId: 'x', url: 'u', expiresAt: null, artifactToken: 't' }, 201);
    });
    await createArtifact('https://dropley.app', PARTS, {});
  });
});

describe('error shapes', () => {
  it('404 flat shape → message from error string', async () => {
    stubFetch(() => jsonResponse({ error: 'Artifact not found: aB3cD5eF' }, 404));
    const err = await getArtifact('https://dropley.app', 'aB3cD5eF').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Artifact not found: aB3cD5eF');
  });

  it('405 flat shape is handled like 404', async () => {
    stubFetch(() => jsonResponse({ error: 'Method not allowed' }, 405));
    const err = await getArtifact('https://dropley.app', 'aB3cD5eF').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(405);
    expect(err.message).toBe('Method not allowed');
  });

  it('flat shape with code/hint fields is surfaced verbatim', async () => {
    stubFetch(
      () =>
        jsonResponse(
          { error: 'Not found', code: 'NOT_FOUND', message: 'No such artifact', hint: 'Check the ID' },
          404,
        ),
    );
    const err = await getArtifact('https://dropley.app', 'zzzzzzzz').catch((e) => e);
    expect(err.message).toBe('No such artifact');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.hint).toBe('Check the ID');
  });

  it('429 nested shape + Retry-After header are surfaced', async () => {
    stubFetch(
      () =>
        jsonResponse(
          { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
          429,
          { 'retry-after': '30' },
        ),
    );
    const err = await getArtifact('https://dropley.app', 'aB3cD5eF').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.message).toBe('Too many requests.');
    expect(err.retryAfter).toBe(30);
  });

  it('422 validation message passes through verbatim', async () => {
    stubFetch(
      () => jsonResponse({ error: "Validation failed: 'size' must be a positive integer" }, 422),
    );
    const err = await createArtifact('https://dropley.app', PARTS, {}).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toBe("Validation failed: 'size' must be a positive integer");
  });

  it('500 keeps the requestId', async () => {
    stubFetch(() =>
      jsonResponse({ error: 'Internal server error', requestId: '550e8400-e29b-41d4-a716' }, 500),
    );
    const err = await getArtifact('https://dropley.app', 'aB3cD5eF').catch((e) => e);
    expect(err.status).toBe(500);
    expect(err.requestId).toBe('550e8400-e29b-41d4-a716');
  });

  it('non-JSON error bodies do not crash parsing', async () => {
    stubFetch(() => new Response('<html>boom</html>', { status: 502 }));
    const err = await getArtifact('https://dropley.app', 'aB3cD5eF').catch((e) => e);
    expect(err.status).toBe(502);
    expect(String(err.message)).toContain('boom');
  });

  it('network failures become status-0 ApiErrors with a hint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    const err = await getArtifact('https://dropley.app', 'aB3cD5eF').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.hint).toMatch(/--api/);
  });
});

describe('getArtifact / update / delete auth', () => {
  it('GET appends ?token= when a token is given', async () => {
    const fetchMock = stubFetch((url) => {
      expect(url).toBe('https://dropley.app/api/artifacts/aB3cD5eF?token=tok_abc');
      return jsonResponse({ shortId: 'aB3cD5eF', status: 'published' }, 200);
    });
    const info = await getArtifact('https://dropley.app', 'aB3cD5eF', 'tok_abc');
    expect(info.status).toBe('published');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('PATCH sends X-Artifact-Token header with JSON patch body', async () => {
    const fetchMock = stubFetch((_url, init) => {
      expect(init.method).toBe('PATCH');
      expect((init.headers as Record<string, string>)['X-Artifact-Token']).toBe('tok_abc');
      expect(init.body).toBe('{"expiry":"7d"}');
      return jsonResponse({ success: true, expiresAt: '2026-08-30T00:00:00.000Z' }, 200);
    });
    const result = await updateArtifact('https://dropley.app', 'aB3cD5eF', 'tok_abc', {
      expiry: '7d',
    });
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('DELETE sends X-Artifact-Token header', async () => {
    const fetchMock = stubFetch((_url, init) => {
      expect(init.method).toBe('DELETE');
      expect((init.headers as Record<string, string>)['X-Artifact-Token']).toBe('tok_abc');
      return jsonResponse({ success: true }, 200);
    });
    await deleteArtifact('https://dropley.app', 'aB3cD5eF', 'tok_abc');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
