import { ApiError } from './api.js';

export interface Io {
  stdout(message: string): void;
  stderr(message: string): void;
  /** Writes to stderr verbatim (no newline appended) — for progress lines. */
  stderrRaw(message: string): void;
  printJson(value: unknown): void;
  readonly json: boolean;
}

export function createIo(jsonMode: boolean): Io {
  return {
    stdout: (m) => process.stdout.write(m.endsWith('\n') ? m : `${m}\n`),
    stderr: (m) => process.stderr.write(m.endsWith('\n') ? m : `${m}\n`),
    stderrRaw: (m) => process.stderr.write(m),
    printJson: (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`),
    json: jsonMode,
  };
}

export function formatApiError(err: ApiError): string {
  const lines = [`error: ${err.message}`];
  if (err.code) lines.push(`code: ${err.code}`);
  if (err.status > 0) lines.push(`http: ${err.status}`);
  if (err.retryAfter !== undefined) lines.push(`retry-after: ${err.retryAfter}s`);
  if (err.hint) lines.push(`hint: ${err.hint}`);
  if (err.requestId) lines.push(`request-id: ${err.requestId}`);
  return lines.join('\n');
}
