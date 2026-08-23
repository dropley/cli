import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSavedToken, resolveToken, saveToken, resolveBaseUrl } from '../src/config.js';
import { UsageError } from '../src/errors.js';

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'dropley-test-'));
  vi.stubEnv('DROPLEY_CONFIG_DIR', configDir);
  delete process.env.DROPLEY_TOKEN;
  delete process.env.DROPLEY_API;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(configDir, { recursive: true, force: true });
});

describe('token store', () => {
  it('saves and reads back tokens per short ID', () => {
    saveToken('aB3cD5eF', 'tok_one');
    expect(readSavedToken('aB3cD5eF')).toBe('tok_one');
    expect(readSavedToken('zzzzzzzz')).toBeUndefined();
  });

  it('writes the store with 0600 permissions', () => {
    saveToken('aB3cD5eF', 'tok_one');
    const mode = statSync(join(configDir, 'dropley', 'tokens.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns undefined for missing/corrupt stores', () => {
    mkdirSync(join(configDir, 'dropley'));
    writeFileSync(join(configDir, 'dropley', 'tokens.json'), '{not json');
    expect(readSavedToken('aB3cD5eF')).toBeUndefined();
    expect(readSavedToken('nope')).toBeUndefined();
  });
});

describe('resolveToken precedence: flag > env > saved', () => {
  it('uses the flag when provided', () => {
    saveToken('aB3cD5eF', 'saved_tok');
    vi.stubEnv('DROPLEY_TOKEN', 'env_tok');
    expect(resolveToken('flag_tok', 'aB3cD5eF')).toBe('flag_tok');
  });

  it('falls back to env when no flag', () => {
    saveToken('aB3cD5eF', 'saved_tok');
    vi.stubEnv('DROPLEY_TOKEN', 'env_tok');
    expect(resolveToken(undefined, 'aB3cD5eF')).toBe('env_tok');
  });

  it('falls back to the saved token last', () => {
    saveToken('aB3cD5eF', 'saved_tok');
    expect(resolveToken(undefined, 'aB3cD5eF')).toBe('saved_tok');
  });

  it('returns undefined when nothing is available', () => {
    expect(resolveToken(undefined, 'aB3cD5eF')).toBeUndefined();
  });
});

describe('resolveBaseUrl: flag > env > default', () => {
  it('defaults to the production API', () => {
    expect(resolveBaseUrl()).toBe('https://dropley.app');
  });

  it('prefers --api over DROPLEY_API', () => {
    vi.stubEnv('DROPLEY_API', 'https://env.example');
    expect(resolveBaseUrl('https://flag.example')).toBe('https://flag.example');
  });

  it('falls back to DROPLEY_API', () => {
    vi.stubEnv('DROPLEY_API', 'https://env.example');
    expect(resolveBaseUrl(undefined)).toBe('https://env.example');
  });

  it('strips trailing slashes and rejects non-http URLs', () => {
    expect(resolveBaseUrl('http://localhost:8788/')).toBe('http://localhost:8788');
    expect(() => resolveBaseUrl('ftp://x')).toThrow(UsageError);
  });
});