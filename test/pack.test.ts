import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import { captureStdio } from './helpers.js';

let io: ReturnType<typeof captureStdio>;

beforeEach(() => {
  io = captureStdio();
});

afterEach(() => {
  io.restore();
  vi.restoreAllMocks();
});

describe('pack', () => {
  it('creates a reproducible archive and prints sha256', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dropley-pack-'));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>pack');
    writeFileSync(join(dir, 'sub', 'a.txt'), 'hello');
    writeFileSync(join(dir, '.DS_Store'), 'junk');
    const out = join(tmpdir(), 'pack-out.zip');

    expect(await main(['pack', dir, '--out', out])).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(io.stream.stdout).toContain(`out: ${out}`);
    expect(io.stream.stdout).toMatch(/sha256: [0-9a-f]{64}/);

    const firstHash = io.stream.stdout.match(/sha256: ([0-9a-f]{64})/)?.[1];
    io.stream.stdout = '';
    expect(await main(['pack', dir, '--out', out])).toBe(0);
    const secondHash = io.stream.stdout.match(/sha256: ([0-9a-f]{64})/)?.[1];
    expect(secondHash).toBe(firstHash);
    rmSync(out, { force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults output next to the source dir (never inside it)', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'dropley-packp-'));
    const dir = join(parent, 'site');
    mkdirSync(dir);
    writeFileSync(join(dir, 'index.html'), 'x');
    expect(await main(['pack', dir])).toBe(0);
    expect(io.stream.stdout).toContain(`out: ${join(parent, 'site.zip')}`);
    expect(existsSync(join(parent, 'site.zip'))).toBe(true);
    rmSync(parent, { recursive: true, force: true });
  });

  it('requires a directory argument (exit 2)', async () => {
    expect(await main(['pack'])).toBe(2);
  });
});