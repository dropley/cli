import type { ParsedArgs } from '../args.js';
import { resolveBaseUrl, requireToken, resolveToken } from '../config.js';
import { UsageError } from '../errors.js';
import { parseTarget } from '../target.js';

export interface CommandContext {
  shortId: string;
  token?: string;
  baseUrl: string;
}

/** Variant where a token is guaranteed (update, delete). */
export interface AuthenticatedContext extends CommandContext {
  token: string;
}

function targetOf(parsed: ParsedArgs): string {
  const raw = parsed.positionals[0];
  if (raw === undefined) throw new UsageError('Missing <url-or-shortId> argument.');
  return parseTarget(raw);
}

/** Context for tokenless commands (status shows public metadata without one). */
export function commandContext(parsed: ParsedArgs): CommandContext {
  const shortId = targetOf(parsed);
  return {
    shortId,
    token: resolveToken(parsed.values.token, shortId),
    baseUrl: resolveBaseUrl(parsed.values.api),
  };
}

/** Context for commands that must authenticate (update, delete). */
export function commandContextWithToken(parsed: ParsedArgs): AuthenticatedContext {
  const shortId = targetOf(parsed);
  return {
    shortId,
    token: requireToken(parsed.values.token, shortId),
    baseUrl: resolveBaseUrl(parsed.values.api),
  };
}