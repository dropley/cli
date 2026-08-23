import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { UsageError } from './errors.js';

export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_FILE_COUNT = 1000;

const JUNK_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const JUNK_DIRS = new Set(['.git', '.hg', '.svn']);

function isJunkName(name: string): boolean {
  return JUNK_FILES.has(name) || name.startsWith('._');
}

export interface CollectedFile {
  /** Absolute path on disk. */
  absPath: string;
  /** Relative POSIX path used as the manifest path and multipart filename. */
  path: string;
  size: number;
}

/**
 * Walks a directory recursively and returns every non-junk file, sorted by
 * relative POSIX path (byte-stable ordering). Junk = OS metadata (.DS_Store,
 * Thumbs.db, desktop.ini, AppleDouble ._*), VCS internals, and node_modules.
 */
export async function collectFiles(rootDir: string): Promise<CollectedFile[]> {
  const out: CollectedFile[] = [];
  let totalBytes = 0;

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' && entry.isDirectory()) continue;
      if (entry.isDirectory()) {
        if (!JUNK_DIRS.has(entry.name)) await walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (isJunkName(entry.name)) continue;
      const absPath = join(dir, entry.name);
      const relPath = absPath.slice(rootDir.length + 1).split('\\').join('/');
      const size = (await stat(absPath)).size;
      totalBytes += size;
      out.push({ absPath, path: relPath, size });
    }
  };

  try {
    await walk(rootDir);
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError(`Cannot read directory ${rootDir}: ${(err as Error).message}`);
  }

  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (out.length === 0) throw new UsageError(`No files found in ${rootDir}.`);
  if (out.length > MAX_FILE_COUNT) {
    throw new UsageError(
      `Too many files: ${out.length} (max ${MAX_FILE_COUNT}). Publish a build output directory instead.`,
    );
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new UsageError(
      `Total size ${(totalBytes / 1024 / 1024).toFixed(1)}MB exceeds the ${MAX_TOTAL_BYTES / 1024 / 1024}MB limit.`,
    );
  }
  return out;
}
