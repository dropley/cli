import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createZip } from '../src/zip.js';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

interface ParsedEntry {
  name: string;
  method: number;
  modTime: number;
  modDate: number;
  data: Buffer;
}

function parseZip(zip: Buffer): ParsedEntry[] {
  const eocdStart = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdStart < 0) throw new Error('EOCD not found');
  if (zip.readUInt32LE(eocdStart) !== EOCD_SIG) throw new Error('bad EOCD');
  const count = zip.readUInt16LE(eocdStart + 10);
  let ptr = zip.readUInt32LE(eocdStart + 16);
  const entries: ParsedEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(ptr) !== CENTRAL_SIG) throw new Error('bad central header');
    const nameLen = zip.readUInt16LE(ptr + 28);
    const extraLen = zip.readUInt16LE(ptr + 30);
    const commentLen = zip.readUInt16LE(ptr + 32);
    const name = zip.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');

    const localOff = zip.readUInt32LE(ptr + 42);
    if (zip.readUInt32LE(localOff) !== 0x04034b50) throw new Error('bad local header');
    const method = zip.readUInt16LE(localOff + 8);
    const modTime = zip.readUInt16LE(localOff + 10);
    const modDate = zip.readUInt16LE(localOff + 12);
    const compSize = zip.readUInt32LE(localOff + 18);
    const lNameLen = zip.readUInt16LE(localOff + 26);
    const lExtraLen = zip.readUInt16LE(localOff + 28);
    const comp = zip.subarray(
      localOff + 30 + lNameLen + lExtraLen,
      localOff + 30 + lNameLen + lExtraLen + compSize,
    );
    const data =
      method === 8 ? Buffer.from(inflateRawSync(comp)) : Buffer.from(comp);

    entries.push({ name, method, modTime, modDate, data });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function entry(name: string, content: string) {
  return { name, data: Buffer.from(content, 'utf8') };
}

describe('createZip', () => {
  it('produces byte-identical archives regardless of input order', () => {
    const entries = [
      entry('index.html', '<!doctype html>hi'),
      entry('assets/app.css', 'body{}'),
      entry('img/logo.svg', '<svg/>'),
    ];
    const a = createZip(entries);
    const b = createZip([...entries].reverse());
    expect(b.equals(a)).toBe(true);
    expect(createHash('sha256').update(a).digest('hex')).toBe(
      createHash('sha256').update(b).digest('hex'),
    );
  });

  it('is deterministic across repeated builds of the same tree', () => {
    const build = () =>
      createZip([entry('b/second.txt', 'x'.repeat(5000)), entry('a/first.txt', 'y')]);
    const hash = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
    expect(hash(build())).toBe(hash(build()));
  });

  it('sorts entries by name', () => {
    const zip = createZip([entry('z.txt', 'z'), entry('a.txt', 'a'), entry('m.txt', 'm')]);
    expect(parseZip(zip).map((e) => e.name)).toEqual(['a.txt', 'm.txt', 'z.txt']);
  });

  it('normalizes names to POSIX without leading slashes or ./', () => {
    const zip = createZip([entry('/abs/path.txt', 'x'), entry('./rel\\win.txt', 'y')]);
    expect(parseZip(zip).map((e) => e.name).sort()).toEqual(['abs/path.txt', 'rel/win.txt']);
  });

  it('rejects duplicate entry names', () => {
    expect(() => createZip([entry('a.txt', '1'), entry('a.txt', '2')])).toThrow(/Duplicate/);
  });

  it('round-trips contents through DEFLATE and STORE', () => {
    const big = 'lorem ipsum '.repeat(400); // compressible → deflate
    const tiny = 'q'; // deflate overhead → stored
    const zip = createZip([entry('big.txt', big), entry('tiny.txt', tiny)]);
    const parsed = Object.fromEntries(parseZip(zip).map((e) => [e.name, e]));
    expect(parsed['big.txt']?.data.toString('utf8')).toBe(big);
    expect(parsed['big.txt']?.method).toBe(8);
    expect(parsed['tiny.txt']?.data.toString('utf8')).toBe(tiny);
    expect(parsed['tiny.txt']?.method).toBe(0);
  });

  it('uses fixed timestamps so no wall-clock leaks into the archive', () => {
    const zip = createZip([entry('t.txt', 't')]);
    for (const e of parseZip(zip)) {
      expect(e.modTime).toBe(0);
      expect(e.modDate).toBe(0x21); // 1980-01-01
    }
  });
});
