import { deleteArtifact } from '../api.js';
import type { ParsedArgs } from '../args.js';
import { commandContextWithToken } from './context.js';
import type { Io } from '../output.js';
import { retryOptions } from '../retry.js';

export async function del(parsed: ParsedArgs, io: Io): Promise<number> {
  const { shortId, token, baseUrl } = commandContextWithToken(parsed);
  const result = await deleteArtifact(baseUrl, shortId, token, retryOptions(parsed, io));

  if (io.json) {
    io.printJson(result);
  } else {
    io.stdout(`deleted: ${shortId}`);
  }
  return 0;
}