import { deflateRawSync } from 'node:zlib';

/**
 * Minimal deterministic ZIP writer.
 *
 * Byte-for-byte reproducible output for identical inputs:
 * - entries sorted by name (code-unit order), duplicates rejected
 * - names normalized to POSIX, no leading slashes
 * - fixed DOS timestamp (1980-01-01 00:00:00), no extra fields, no real mtimes
 * - UTF-8 flag set; per-entry DEFLATE when smaller than STORE
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const FIXED_DOS_TIME = 0;
// 1980-01-01 → day=1 | month=1<<5 | (year-1980)<<9 = 0x21
const FIXED_DOS_DATE = 0x21;
const UTF8_FLAG = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

let CRC_TABLE: Int32Array | undefined;

function crcTable(): Int32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(data: Uint8Array): number {
  const table = crcTable();
  let crc = -1;
  for (const byte of data) {
    crc = (crc >>> 8) ^ (table[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ -1) >>> 0;
}

function normalizeName(name: string): string {
  const normalized = name.split('\\').join('/').replace(/^\.?\//, '').replace(/^\/+/, '');
  if (normalized.length === 0) throw new Error(`Invalid zip entry name: ${JSON.stringify(name)}`);
  return normalized;
}

class ByteWriter {
  private chunks: Buffer[] = [];
  private len = 0;

  u16(v: number): this {
    const b = Buffer.allocUnsafe(2);
    b.writeUInt16LE(v >>> 0, 0);
    return this.push(b);
  }

  u32(v: number): this {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32LE(v >>> 0, 0);
    return this.push(b);
  }

  bytes(b: Uint8Array): this {
    return this.push(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
  }

  push(b: Buffer): this {
    this.chunks.push(b);
    this.len += b.length;
    return this;
  }

  get length(): number {
    return this.len;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.len);
  }
}

export function createZip(inputEntries: readonly ZipEntry[]): Buffer {
  if (inputEntries.length > 65534) {
    throw new Error(`Too many zip entries (${inputEntries.length}); max 65534.`);
  }

  const seen = new Set<string>();
  const entries = inputEntries
    .map((e) => ({ ...e, name: normalizeName(e.name) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (seen.has(e.name)) throw new Error(`Duplicate zip entry name: ${e.name}`);
    seen.add(e.name);
    if (e.data.length > 0xffffffff) throw new Error(`Zip entry too large: ${e.name}`);
  }

  const out = new ByteWriter();
  const central = new ByteWriter();

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const stored = Buffer.from(
      e.data.buffer,
      e.data.byteOffset,
      e.data.byteLength,
    );
    const deflated = deflateRawSync(stored, { level: 6 });
    const useDeflate = deflated.length < stored.length;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const payload = useDeflate ? deflated : stored;
    const offset = out.length;

    out.u32(0x04034b50); // local file header signature
    out.u16(20); // version needed
    out.u16(UTF8_FLAG); // general purpose flags
    out.u16(method);
    out.u16(FIXED_DOS_TIME);
    out.u16(FIXED_DOS_DATE);
    out.u32(crc);
    out.u32(payload.length); // compressed size
    out.u32(stored.length); // uncompressed size
    out.u16(nameBuf.length);
    out.u16(0); // extra field length
    out.bytes(nameBuf);
    out.bytes(payload);

    central.u32(0x02014b50); // central directory header signature
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(UTF8_FLAG);
    central.u16(method);
    central.u16(FIXED_DOS_TIME);
    central.u16(FIXED_DOS_DATE);
    central.u32(crc);
    central.u32(payload.length);
    central.u32(stored.length);
    central.u16(nameBuf.length);
    central.u16(0); // extra length
    central.u16(0); // comment length
    central.u16(0); // disk number start
    central.u16(0); // internal attributes
    central.u32(0); // external attributes
    central.u32(offset); // relative offset of local header
    central.bytes(nameBuf);
  }

  const cdOffset = out.length;
  const cdSize = central.length;
  out.bytes(central.toBuffer());

  out.u32(0x06054b50); // end of central directory signature
  out.u16(0); // disk number
  out.u16(0); // disk with central directory
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(cdSize);
  out.u32(cdOffset);
  out.u16(0); // comment length

  return out.toBuffer();
}
