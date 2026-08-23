import { updateArtifact } from '../api.js';
import type { ParsedArgs } from '../args.js';
import { commandContextWithToken } from './context.js';
import { UsageError } from '../errors.js';
import type { Io } from '../output.js';
import { validateExpiry } from './publish.js';

export async function update(parsed: ParsedArgs, io: Io): Promise<number> {
  const expiry = parsed.values.expiry;
  if (expiry === undefined) {
    throw new UsageError('Nothing to update. Pass --expiry <value> (e.g. --expiry 7d).');
  }
  validateExpiry(expiry);

  const { shortId, token, baseUrl } = commandContextWithToken(parsed);
  const result = await updateArtifact(baseUrl, shortId, token, { expiry });

  if (io.json) {
    io.printJson(result);
  } else {
    io.stdout(`updated: ${shortId}`);
    if (result.expiresAt) io.stdout(`expires: ${result.expiresAt}`);
  }
  return 0;
}