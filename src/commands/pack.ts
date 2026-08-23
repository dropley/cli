import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { collectFiles } from '../collect.js';
import { createZip, type ZipEntry } from '../zip.js';
import { UsageError } from '../errors.js';
import type { ParsedArgs } from '../args.js';
import type { Io } from '../output.js';

/**
 * Creates a byte-for-byte reproducible zip archive of a directory
 * (stable ordering, fixed timestamps, OS junk files excluded).
 *
 * Note: Dropley serves uploads as-is and does not expand archives — publish a
 * directory directly for hosting; `pack` is for archiving and reproducible builds.
 */
export async function pack(parsed: ParsedArgs, io: Io): Promise<number> {
  const inputPath = parsed.positionals[0];
  if (!inputPath) throw new UsageError('Missing <dir> argument.');
  const outFlag = parsed.values.out;
  if (outFlag !== undefined && !outFlag.endsWith('.zip')) {
    throw new UsageError(`Output must end with .zip: ${outFlag}`);
  }

  const abs = resolve(inputPath);
  const files = await collectFiles(abs);

  const entries: ZipEntry[] = files.map((f) => ({
    name: f.path,
    data: readFileSync(f.absPath),
  }));
  const archive = createZip(entries);

  // Default output sits BESIDE the source directory so repeated packs never
  // include a previous archive as input.
  const outPath = resolve(outFlag ?? join(dirname(abs), `${basename(abs)}.zip`));
  writeFileSync(outPath, archive);
  const sha256 = createHash('sha256').update(archive).digest('hex');

  if (io.json) {
    io.printJson({ out: outPath, sha256, bytes: archive.length, files: entries.length });
  } else {
    io.stdout(`out: ${outPath}`);
    io.stdout(`sha256: ${sha256}`);
    io.stdout(`bytes: ${archive.length}`);
    io.stdout(`files: ${entries.length}`);
  }
  return 0;
}