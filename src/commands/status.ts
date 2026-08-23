import { getArtifact } from '../api.js';
import type { ParsedArgs } from '../args.js';
import { commandContext } from './context.js';
import type { Io } from '../output.js';

function humanValue(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (Array.isArray(v)) return v.length > 0 ? v.map(String).join(', ') : '-';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 0 ? s : '-';
}

export async function status(parsed: ParsedArgs, io: Io): Promise<number> {
  const { shortId, token, baseUrl } = commandContext(parsed);
  if (!token) io.stderr('No artifact token found — showing public metadata only.');

  const info = await getArtifact(baseUrl, shortId, token);

  if (io.json) {
    io.printJson(info);
    return 0;
  }
  for (const [key, value] of Object.entries(info)) {
    io.stdout(`${key}: ${humanValue(value)}`);
  }
  return 0;
}