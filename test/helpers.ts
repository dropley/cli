import { vi } from 'vitest';

export type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Replaces global fetch with a handler; returns the mock for assertions. */
export function stubFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string | URL, init: RequestInit = {}) => handler(String(url), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function jsonResponse(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Reads a fetch RequestInit body (string, Buffer, stream, etc.) into bytes. */
export async function readBody(init: RequestInit): Promise<Uint8Array> {
  const body = init.body;
  if (body == null) return new Uint8Array();
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array || Buffer.isBuffer(body)) {
    return new Uint8Array(body as Uint8Array);
  }
  if (body instanceof ReadableStream) {
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  // Blob / FormData
  return new Uint8Array(await new Response(body as RequestInit['body']).arrayBuffer());
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  files: { name: string; filename: string; contentType: string; data: Uint8Array }[];
}

function splitBuffer(buf: Uint8Array, delim: string): Uint8Array[] {
  const d = new TextEncoder().encode(delim);
  const out: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i <= buf.length - d.length; i++) {
    let matches = true;
    for (let j = 0; j < d.length; j++) {
      if (buf[i + j] !== d[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      out.push(buf.subarray(start, i));
      start = i + d.length;
      i += d.length - 1;
    }
  }
  out.push(buf.subarray(start));
  return out;
}

function decodeAscii(v: Uint8Array): string {
  return new TextDecoder('latin1').decode(v);
}

function indexOf(buf: Uint8Array, needle: string, from = 0): number {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = from; i <= buf.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) {
      if (buf[i + j] !== n[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Parses a manually-built multipart/form-data body into fields and files. */
export function parseMultipart(body: Uint8Array, contentType: string): ParsedMultipart {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = m?.[1] ?? m?.[2];
  if (!boundary) throw new Error(`no boundary in ${contentType}`);
  const parts = splitBuffer(body, `--${boundary}`);

  const fields: Record<string, string> = {};
  const files: ParsedMultipart['files'] = [];

  for (const raw of parts) {
    let p = raw;
    if (p.length >= 2 && p[0] === 0x0d && p[1] === 0x0a) p = p.subarray(2);
    if (p.length === 0) continue;
    if (p[0] === 0x2d && p[1] === 0x2d) continue; // closing "--"

    const headerEnd = indexOf(p, '\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerBlock = decodeAscii(p.subarray(0, headerEnd));
    let content = p.subarray(headerEnd + 4);
    if (
      content.length >= 2 &&
      content[content.length - 2] === 0x0d &&
      content[content.length - 1] === 0x0a
    ) {
      content = content.subarray(0, content.length - 2);
    }

    const name = /name="([^"]*)"/.exec(headerBlock)?.[1] ?? '';
    const filename = /filename="([^"]*)"/.exec(headerBlock)?.[1];
    const contentTypeField = /content-type:\s*([^\r\n]+)/i.exec(headerBlock)?.[1];
    if (filename !== undefined) {
      files.push({
        name,
        filename,
        contentType: contentTypeField ?? '',
        data: content,
      });
    } else {
      fields[name] = decodeAscii(content);
    }
  }

  return { fields, files };
}

export interface CapturedStdio {
  stdout: string;
  stderr: string;
}

/** Captures process.stdout/stderr writes; call `capture()` in beforeEach. */
export function captureStdio(): { stream: CapturedStdio; restore: () => void } {
  const stream = { stdout: '', stderr: '' };
  const spies = [
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stream.stdout += String(chunk);
      return true;
    }),
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stream.stderr += String(chunk);
      return true;
    }),
  ];
  return { stream, restore: () => spies.forEach((s) => s.mockRestore()) };
}