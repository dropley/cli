import { updateArtifact } from '../api.js';
import type { ParsedArgs } from '../args.js';
import { commandContextWithToken } from './context.js';
import { UsageError } from '../errors.js';
import type { Io } from '../output.js';
import { validateExpiry, validateSource, parseTags } from './publish.js';
import { retryOptions } from '../retry.js';

export async function update(parsed: ParsedArgs, io: Io): Promise<number> {
  const patch: Record<string, unknown> = {};

  const expiry = parsed.values.expiry;
  if (expiry !== undefined) {
    validateExpiry(expiry);
    patch.expiry = expiry;
  }
  const source = parsed.values.source;
  if (source !== undefined) {
    validateSource(source);
    patch.source = source;
  }
  const tags = parsed.values.tags;
  if (tags !== undefined) {
    patch.tags = parseTags(tags);
  }

  if (Object.keys(patch).length === 0) {
    throw new UsageError('Nothing to update. Pass --expiry <value>, --source <value>, or --tags <a,b,c>.');
  }

  const { shortId, token, baseUrl } = commandContextWithToken(parsed);
  const result = await updateArtifact(baseUrl, shortId, token, patch, retryOptions(parsed, io));

  if (io.json) {
    io.printJson(result);
  } else {
    io.stdout(`updated: ${shortId}`);
    if (result.expiresAt) io.stdout(`expires: ${result.expiresAt}`);
  }
  return 0;
}
