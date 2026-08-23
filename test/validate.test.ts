import { describe, expect, it } from 'vitest';
import { parseTags, validateExpiry, validateSource } from '../src/commands/publish.js';
import { UsageError } from '../src/errors.js';

describe('validateExpiry', () => {
  it('accepts digit + h/d unit forms', () => {
    expect(() => validateExpiry('1d')).not.toThrow();
    expect(() => validateExpiry('3d')).not.toThrow();
    expect(() => validateExpiry('30d')).not.toThrow();
    expect(() => validateExpiry('12h')).not.toThrow();
  });

  it('rejects malformed values', () => {
    expect(() => validateExpiry('7')).toThrow(UsageError);
    expect(() => validateExpiry('1w')).toThrow(UsageError);
    expect(() => validateExpiry('')).toThrow(UsageError);
    expect(() => validateExpiry('d')).toThrow(UsageError);
  });
});

describe('validateSource', () => {
  it('accepts the documented source enum', () => {
    for (const s of [
      'claude-code',
      'chatgpt',
      'cursor',
      'lovable',
      'bolt',
      'storybook',
      'figma',
      'other',
    ]) {
      expect(() => validateSource(s)).not.toThrow();
    }
  });

  it('rejects unknown values', () => {
    expect(() => validateSource('claude_code')).toThrow(UsageError);
    expect(() => validateSource('')).toThrow(UsageError);
    expect(() => validateSource('nope')).toThrow(/Invalid source/);
  });
});

describe('parseTags', () => {
  it('splits on commas and trims whitespace', () => {
    expect(parseTags('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(parseTags(' prod , team-a ')).toEqual(['prod', 'team-a']);
  });

  it('drops empty entries but errors when all are empty', () => {
    expect(parseTags('a,,b')).toEqual(['a', 'b']);
    expect(() => parseTags(',,')).toThrow(UsageError);
    expect(() => parseTags('')).toThrow(UsageError);
  });

  it('enforces the 10-tag and 50-char limits', () => {
    expect(parseTags(Array.from({ length: 10 }, (_, i) => `t${i}`).join(','))).toHaveLength(10);
    expect(() =>
      parseTags(Array.from({ length: 11 }, (_, i) => `t${i}`).join(',')),
    ).toThrow(/Too many tags/);
    expect(() => parseTags('a'.repeat(51))).toThrow(/Tag too long/);
    expect(parseTags('a'.repeat(50))).toEqual(['a'.repeat(50)]);
  });
});
