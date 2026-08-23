import { statSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { contentTypeForPath } from '../mime.js';
import { collectFiles, MAX_TOTAL_BYTES, type CollectedFile } from '../collect.js';
import { createArtifact, type UploadPart } from '../api.js';
import { resolveBaseUrl, saveToken } from '../config.js';
import { UsageError } from '../errors.js';
import type { ParsedArgs } from '../args.js';
import type { Io } from '../output.js';

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

function loadParts(files: readonly CollectedFile[]): UploadPart[] {
  return files.map((f) => ({
    path: f.path,
    contentType: contentTypeForPath(f.absPath),
    data: readFileSync(f.absPath),
  }));
}

export function validateExpiry(value: string): void {
  if (!/^\d+[hd]$/.test(value)) {
    throw new UsageError(`Invalid expiry "${value}". Use a value like 1d, 3d, 7d, 15d, 30d or 12h.`);
  }
}

export async function publish(parsed: ParsedArgs, io: Io): Promise<number> {
  const inputPath = parsed.positionals[0];
  if (!inputPath) throw new UsageError('Missing <path> argument.');
  const expiry = parsed.values.expiry;
  if (expiry !== undefined) validateExpiry(expiry);

  const abs = resolve(inputPath);
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new UsageError(`No such file or directory: ${inputPath}`);
  }

  let files: CollectedFile[];
  let renamedFrom: string | undefined;

  if (st.isDirectory()) {
    files = await collectFiles(abs);
    if (!files.some((f) => f.path === 'index.html')) {
      throw new UsageError(
        `No index.html found at the root of ${inputPath}. Dropley requires an entry file named index.html.`,
      );
    }
    io.stderr(
      `Packing ${files.length} file${files.length === 1 ? '' : 's'} (${formatBytes(
        files.reduce((n, f) => n + f.size, 0),
      )})…`,
    );
  } else if (st.isFile()) {
    const size = st.size;
    if (size > MAX_TOTAL_BYTES) {
      throw new UsageError(`File is ${formatBytes(size)}; the limit is ${MAX_TOTAL_BYTES / 1024 / 1024}MB.`);
    }
    const name = basename(abs);
    if (name !== 'index.html') renamedFrom = name;
    files = [{ absPath: abs, path: name, size }];
  } else {
    throw new UsageError(`Not a regular file or directory: ${inputPath}`);
  }

  // Single-file publishes are always served as the site entry (index.html).
  const parts =
    st.isFile() && !files.some((f) => f.path === 'index.html')
      ? [
          {
            path: 'index.html',
            contentType: contentTypeForPath(abs),
            data: readFileSync(abs),
          },
        ]
      : loadParts(files);

  io.stderr('Uploading…');
  const baseUrl = resolveBaseUrl(parsed.values.api);
  const result = await createArtifact(baseUrl, parts, { expiry });

  try {
    saveToken(result.shortId, result.artifactToken);
    io.stderr(`Token saved for ${result.shortId} (used automatically by status/update/delete).`);
  } catch {
    io.stderr('Warning: could not save token locally — keep it to update or delete this artifact.');
  }
  if (renamedFrom) {
    io.stderr(`Entry uploaded as index.html (from ${renamedFrom}).`);
  }

  if (io.json) {
    io.printJson(result);
  } else {
    io.stdout(`url: ${result.url}`);
    io.stdout(`token: ${result.artifactToken}`);
    if (result.expiresAt) io.stdout(`expires: ${result.expiresAt}`);
  }
  return 0;
}