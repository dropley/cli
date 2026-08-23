import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_BASE_URL } from './api.js';
import { AuthError, UsageError } from './errors.js';

export function resolveBaseUrl(flagValue?: string): string {
  const raw = flagValue ?? process.env.DROPLEY_API ?? DEFAULT_BASE_URL;
  if (!/^https?:\/\//i.test(raw)) {
    throw new UsageError(`Invalid API base URL: ${raw} (must start with http:// or https://)`);
  }
  return raw.replace(/\/+$/, '');
}

function tokenStorePath(): string {
  const configHome = process.env.DROPLEY_CONFIG_DIR ?? (process.env.XDG_CONFIG_HOME || join(homedir(), '.config'));
  return join(configHome, 'dropley', 'tokens.json');
}

export function readSavedToken(shortId: string): string | undefined {
  try {
    const path = tokenStorePath();
    if (!existsSync(path)) return undefined;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && 'tokens' in parsed) {
      const tokens = (parsed as { tokens?: Record<string, unknown> }).tokens;
      const value = tokens?.[shortId];
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function saveToken(shortId: string, token: string): void {
  const path = tokenStorePath();
  let tokens: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed && typeof parsed === 'object' && 'tokens' in parsed) {
      tokens = (parsed as { tokens?: Record<string, unknown> }).tokens ?? {};
    }
  } catch {
    // missing/corrupt store → start fresh
  }
  tokens[shortId] = token;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, tokens }, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Token precedence: --token flag > DROPLEY_TOKEN env > saved publish token.
 */
export function resolveToken(flagValue: string | undefined, shortId: string): string | undefined {
  if (flagValue) return flagValue;
  const env = process.env.DROPLEY_TOKEN;
  if (env) return env;
  return readSavedToken(shortId);
}

export function requireToken(flagValue: string | undefined, shortId: string): string {
  const token = resolveToken(flagValue, shortId);
  if (!token) {
    throw new AuthError(
      'No artifact token found. Pass --token <token>, set DROPLEY_TOKEN, or publish this artifact from this machine first.',
    );
  }
  return token;
}
