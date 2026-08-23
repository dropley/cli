import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { captureStdio, jsonResponse, parseMultipart, readBody, stubFetch } from './helpers.js';

let stdout: () => string;
let stderr: () => string;
let configDir: string;
let io: ReturnType<typeof captureStdio>;

const PUBLISH_201 = {
  shortId: 'aB3cD5eF',
  url: 'https://preview.dropley.app/p/aB3cD5eF',
  expiresAt: '2026-08-24T12:00:00.000Z',
  artifactToken: 'tok_a1b2c3',
};

function makeSite(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dropley-site-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>s</title>');
  writeFileSync(join(dir, 'assets', 'app.css'), 'body{}');
  writeFileSync(join(dir, '.DS_Store'), 'junk');
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.git', 'config'), 'junk');
  return dir;
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'dropley-cli-'));
  vi.stubEnv('DROPLEY_CONFIG_DIR', configDir);
  delete process.env.DROPLEY_TOKEN;
  delete process.env.DROPLEY_API;
  io = captureStdio();
  stdout = () => io.stream.stdout;
  stderr = () => io.stream.stderr;
});

afterEach(() => {
  io.restore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(configDir, { recursive: true, force: true });
});

describe('publish', () => {
  it('publishes a directory with junk excluded and prints url + token', async () => {
    const site = makeSite();
    const fetchMock = stubFetch(async (_url, init) => {
      const contentType = (init.headers as Record<string, string>)['Content-Type'] ?? '';
      const parsed = parseMultipart(await readBody(init), contentType);
      const manifest = JSON.parse(parsed.fields.manifest!);
      expect(manifest.entry).toBe('index.html');
      expect(parsed.files.map((f) => f.filename).sort()).toEqual(['assets/app.css', 'index.html']);
      return jsonResponse(PUBLISH_201, 201);
    });

    const code = await main(['publish', site, '--expiry', '7d']);
    expect(code).toBe(0);
    expect(stdout()).toContain('url: https://preview.dropley.app/p/aB3cD5eF');
    expect(stdout()).toContain('token: tok_a1b2c3');
    expect(stdout()).toContain('expires: 2026-08-24T12:00:00.000Z');
    // junk (.DS_Store, .git) excluded → only 2 file parts
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stderr()).toContain('Token saved');
  });

  it('publishes a single file, renaming the entry to index.html', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dropley-file-'));
    const file = join(dir, 'page.html');
    writeFileSync(file, '<h1>renamed</h1>');
    stubFetch(async (_url, init) => {
      const contentType = (init.headers as Record<string, string>)['Content-Type'] ?? '';
      const parsed = parseMultipart(await readBody(init), contentType);
      const manifest = JSON.parse(parsed.fields.manifest!);
      expect(manifest.entry).toBe('index.html');
      expect(manifest.files).toHaveLength(1);
      expect(manifest.files[0].path).toBe('index.html');
      expect(parsed.files[0]?.filename).toBe('index.html');
      return jsonResponse(PUBLISH_201, 201);
    });
    const code = await main(['publish', file]);
    expect(code).toBe(0);
    expect(stderr()).toContain('uploaded as index.html');
  });

  it('passes --source and --tags through to the request', async () => {
    const site = makeSite();
    stubFetch(async (_url, init) => {
      const contentType = (init.headers as Record<string, string>)['Content-Type'] ?? '';
      const parsed = parseMultipart(await readBody(init), contentType);
      expect(parsed.fields.source).toBe('claude-code');
      expect(parsed.fields.tags).toBe('prod,team-a');
      return jsonResponse(PUBLISH_201, 201);
    });
    const code = await main([
      'publish',
      site,
      '--source',
      'claude-code',
      '--tags',
      'prod, team-a',
    ]);
    expect(code).toBe(0);
  });

  it('rejects an invalid source (exit 2)', async () => {
    const site = makeSite();
    const code = await main(['publish', site, '--source', 'nope']);
    expect(code).toBe(2);
    expect(stderr()).toContain('Invalid source');
  });

  it('rejects too many tags (exit 2)', async () => {
    const site = makeSite();
    const tags = Array.from({ length: 11 }, (_, i) => `t${i}`).join(',');
    const code = await main(['publish', site, '--tags', tags]);
    expect(code).toBe(2);
    expect(stderr()).toContain('Too many tags');
  });

  it('rejects a tag longer than 50 chars (exit 2)', async () => {
    const site = makeSite();
    const code = await main(['publish', site, '--tags', 'a'.repeat(51)]);
    expect(code).toBe(2);
    expect(stderr()).toContain('Tag too long');
  });

  it('requires index.html at the root of a directory (exit 2)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dropley-noindex-'));
    writeFileSync(join(dir, 'readme.txt'), 'no index here');
    const code = await main(['publish', dir]);
    expect(code).toBe(2);
    expect(stderr()).toContain('index.html');
  });

  it('rejects an invalid expiry (exit 2)', async () => {
    const site = makeSite();
    const code = await main(['publish', site, '--expiry', 'fortnight']);
    expect(code).toBe(2);
    expect(stderr()).toContain('Invalid expiry');
  });

  it('--json prints the raw API object', async () => {
    const site = makeSite();
    stubFetch(() => jsonResponse(PUBLISH_201, 201));
    const code = await main(['publish', site, '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout())).toEqual(PUBLISH_201);
  });

  it('shows upload progress on stderr, but stays quiet in --json mode', async () => {
    const site = makeSite();
    stubFetch(() => jsonResponse(PUBLISH_201, 201));
    expect(await main(['publish', site])).toBe(0);
    expect(stderr()).toContain('Uploading');
    expect(stdout()).toContain('url:');

    io.stream.stderr = '';
    expect(await main(['publish', site, '--json'])).toBe(0);
    expect(io.stream.stderr).not.toContain('Uploading');
  });

  it('publish retries a 429 by default and succeeds', async () => {
    const site = makeSite();
    let calls = 0;
    const fetchMock = stubFetch(() => {
      calls++;
      if (calls === 1) {
        return jsonResponse({ error: { code: 'RATE_LIMITED', message: 'slow down' } }, 429, {
          'retry-after': '0',
        });
      }
      return jsonResponse(PUBLISH_201, 201);
    });
    expect(await main(['publish', site])).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stderr()).toContain('Rate limited (429)');
  });

  it('publish --no-retry surfaces the 429 without retrying', async () => {
    const site = makeSite();
    const fetchMock = stubFetch(() =>
      jsonResponse({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429, {
        'retry-after': '30',
      }),
    );
    expect(await main(['publish', site, '--no-retry'])).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stderr()).toContain('RATE_LIMITED');
  });
});

describe('status', () => {
  it('shows public metadata without a token', async () => {
    stubFetch((url) => {
      expect(url).toBe('https://dropley.app/api/artifacts/aB3cD5eF');
      return jsonResponse(
        { shortId: 'aB3cD5eF', status: 'published', url: 'https://preview.dropley.app/p/aB3cD5eF', tags: [] },
        200,
      );
    });
    const code = await main(['status', 'aB3cD5eF']);
    expect(code).toBe(0);
    expect(stdout()).toContain('shortId: aB3cD5eF');
    expect(stdout()).toContain('status: published');
    expect(stderr()).toContain('public metadata only');
  });

  it('surfaces a 404 flat error to stderr with exit 1', async () => {
    stubFetch(() => jsonResponse({ error: 'Artifact not found: zzzzzzzz' }, 404));
    const code = await main(['status', 'zzzzzzzz']);
    expect(code).toBe(1);
    expect(stderr()).toContain('Artifact not found: zzzzzzzz');
    expect(stderr()).toContain('404');
  });

  it('surfaces a 429 nested error with Retry-After (exit 1) with --no-retry', async () => {
    stubFetch(() =>
      jsonResponse({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429, {
        'retry-after': '30',
      }),
    );
    const code = await main(['status', 'aB3cD5eF', '--no-retry']);
    expect(code).toBe(1);
    expect(stderr()).toContain('RATE_LIMITED');
    expect(stderr()).toContain('retry-after: 30');
    expect(stderr()).toContain('Too many requests');
  });

  it('retries a 429 by default and succeeds', async () => {
    let calls = 0;
    const fetchMock = stubFetch(() => {
      calls++;
      if (calls === 1) {
        return jsonResponse({ error: { code: 'RATE_LIMITED', message: 'slow down' } }, 429, {
          'retry-after': '0',
        });
      }
      return jsonResponse({ shortId: 'aB3cD5eF', status: 'published' }, 200);
    });
    const code = await main(['status', 'aB3cD5eF']);
    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stderr()).toContain('Rate limited (429)');
  });
});

describe('update & delete auth flow', () => {
  it('uses the saved token from a previous publish', async () => {
    const site = makeSite();
    stubFetch((url, init) => {
      if (url.endsWith('/api/artifacts') && init.method === 'POST') {
        return jsonResponse(PUBLISH_201, 201);
      }
      expect(init.headers).toMatchObject({ 'X-Artifact-Token': 'tok_a1b2c3' });
      if (init.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ expiry: '7d' });
        return jsonResponse({ success: true, expiresAt: '2026-08-30T12:00:00.000Z' }, 200);
      }
      return jsonResponse({ success: true }, 200);
    });

    expect(await main(['publish', site])).toBe(0);
    // wipe env: only the saved store can authorize now
    const code = await main(['update', 'aB3cD5eF', '--expiry', '7d']);
    expect(code).toBe(0);
    expect(stdout()).toContain('updated: aB3cD5eF');
    expect(await main(['delete', 'https://preview.dropley.app/p/aB3cD5eF'])).toBe(0);
    expect(stdout()).toContain('deleted: aB3cD5eF');
  });

  it('refuses update/delete without any token (exit 1)', async () => {
    expect(await main(['update', 'aB3cD5eF', '--expiry', '7d'])).toBe(1);
    expect(stderr()).toContain('No artifact token found');
    expect(await main(['delete', 'aB3cD5eF'])).toBe(1);
  });

  it('--token flag overrides the saved token', async () => {
    const site = makeSite();
    const seen: string[] = [];
    stubFetch((url, init) => {
      if (url.endsWith('/api/artifacts') && init.method === 'POST') {
        return jsonResponse(PUBLISH_201, 201);
      }
      const header = (init.headers as Record<string, string>)['X-Artifact-Token'];
      if (header) seen.push(header);
      return jsonResponse({ success: true }, 200);
    });
    await main(['publish', site]);
    await main(['update', 'aB3cD5eF', '--expiry', '1d', '--token', 'tok_flag']);
    expect(seen[0]).toBe('tok_flag');
  });

  it('updates source and tags without expiry', async () => {
    stubFetch((url, init) => {
      if (url.endsWith('/api/artifacts') && init.method === 'POST') {
        return jsonResponse(PUBLISH_201, 201);
      }
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(String(init.body))).toEqual({
        source: 'claude-code',
        tags: ['v1', 'stable'],
      });
      return jsonResponse({ success: true, source: 'claude-code', tags: ['v1', 'stable'] }, 200);
    });
    const site = makeSite();
    await main(['publish', site]);
    const code = await main([
      'update',
      'aB3cD5eF',
      '--source',
      'claude-code',
      '--tags',
      'v1, stable',
    ]);
    expect(code).toBe(0);
    expect(stdout()).toContain('updated: aB3cD5eF');
  });

  it('requires at least one of expiry/source/tags (exit 2)', async () => {
    const code = await main(['update', 'aB3cD5eF']);
    expect(code).toBe(2);
    expect(stderr()).toContain('Nothing to update');
  });

  it('rejects an invalid source on update (exit 2)', async () => {
    const code = await main(['update', 'aB3cD5eF', '--source', 'wat']);
    expect(code).toBe(2);
    expect(stderr()).toContain('Invalid source');
  });
});