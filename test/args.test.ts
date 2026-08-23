import { describe, expect, it } from 'vitest';
import { parseArgv, type CommandSpec } from '../src/args.js';
import { UsageError } from '../src/errors.js';
import { parseTarget } from '../src/target.js';

const SPECS: Record<string, CommandSpec> = {
  publish: {
    summary: 'p',
    flags: { expiry: 'value' },
    positionals: [{ name: '<path>', required: true }],
  },
  status: {
    summary: 's',
    flags: {},
    positionals: [{ name: '<url-or-shortId>', required: true }],
  },
};

describe('parseArgv', () => {
  it('parses command, positionals and boolean/global flags', () => {
    const r = parseArgv(['status', 'aB3cD5eF', '--json'], SPECS);
    expect(r.command).toBe('status');
    expect(r.positionals).toEqual(['aB3cD5eF']);
    expect(r.flags.has('json')).toBe(true);
  });

  it('supports --flag=value and separate-value forms', () => {
    const eq = parseArgv(['publish', 'dist', '--expiry=7d'], SPECS);
    expect(eq.values.expiry).toBe('7d');
    const sep = parseArgv(['publish', 'dist', '--expiry', '3d'], SPECS);
    expect(sep.values.expiry).toBe('3d');
  });

  it('applies flag>env ordering concerns to caller (values are collected)', () => {
    const r = parseArgv(['publish', 'dist', '--token', 't1', '--api', 'http://x'], SPECS);
    expect(r.values.token).toBe('t1');
    expect(r.values.api).toBe('http://x');
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgv(['status', 'x', '--nope'], SPECS)).toThrow(UsageError);
    expect(() => parseArgv(['status', 'x', '--nope'], SPECS)).toThrow(/Unknown option/);
  });

  it('rejects unknown commands', () => {
    expect(() => parseArgv(['frobnicate'], SPECS)).toThrow(/Unknown command/);
  });

  it('rejects missing required positional', () => {
    expect(() => parseArgv(['publish'], SPECS)).toThrow(/Missing argument/);
  });

  it('rejects too many positionals', () => {
    expect(() => parseArgv(['status', 'a', 'b'], SPECS)).toThrow(/Too many arguments/);
  });

  it('rejects value flag without value', () => {
    expect(() => parseArgv(['publish', 'dist', '--expiry'], SPECS)).toThrow(/requires a value/);
  });

  it('rejects --flag=false for boolean with inline false', () => {
    const r = parseArgv(['status', 'x', '--json=false'], SPECS);
    expect(r.flags.has('json')).toBe(false);
  });

  it('treats -- as end-of-flags', () => {
    const r = parseArgv(['publish', '--', '--weird-dir'], SPECS);
    expect(r.positionals).toEqual(['--weird-dir']);
  });
});

describe('parseTarget', () => {
  it('accepts bare short IDs', () => {
    expect(parseTarget('aB3cD5eF')).toBe('aB3cD5eF');
  });
  it('extracts the short ID from full artifact URLs', () => {
    expect(parseTarget('https://preview.dropley.app/p/aB3cD5eF')).toBe('aB3cD5eF');
    expect(parseTarget('https://dropley.app/p/aB3cD5eF/')).toBe('aB3cD5eF');
    expect(parseTarget('https://dropley.app/artifacts/abc123XYZ')).toBe('abc123XYZ');
  });
  it('rejects garbage', () => {
    expect(() => parseTarget('https://dropley.app/')).toThrow(UsageError);
    expect(() => parseTarget('https://dropley.app/p/%20%20')).toThrow(UsageError);
    expect(() => parseTarget('!!')).toThrow(UsageError);
  });
});