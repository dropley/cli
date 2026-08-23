import type { ParsedArgs } from './args.js';
import type { RequestOptions } from './api.js';
import type { Io } from './output.js';

/** Builds retry options for API calls from parsed flags (default: retry on). */
export function retryOptions(parsed: ParsedArgs, io: Io): RequestOptions {
  return {
    retry: !parsed.flags.has('no-retry'),
    onRetry: ({ attempt, delayMs }) => {
      const seconds = Math.max(1, Math.round(delayMs / 1000));
      io.stderr(`Rate limited (429); retrying in ${seconds}s (attempt ${attempt})…`);
    },
  };
}
