import { UsageError } from './errors.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * Accepts a bare short ID or a full artifact URL
 * (e.g. https://preview.dropley.app/p/aB3cD5eF) and returns the short ID.
 */
export function parseTarget(raw: string): string {
  const input = raw.trim();
  if (/^https?:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new UsageError(`Invalid URL: ${input}`);
    }
    const segments = url.pathname.split('/').filter((s) => s.length > 0);
    const last = segments.at(-1);
    if (!last || !ID_PATTERN.test(last)) {
      throw new UsageError(`Could not find a short ID in ${input}`);
    }
    return last;
  }
  if (!ID_PATTERN.test(input)) {
    throw new UsageError(
      `Invalid short ID: ${input}. Pass a short ID or an artifact URL like https://preview.dropley.app/p/<shortId>.`,
    );
  }
  return input;
}
