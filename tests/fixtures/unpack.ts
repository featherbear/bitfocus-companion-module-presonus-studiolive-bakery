// Read-side helpers: gunzip+untar a baked tgz so tests can assert on
// its contents.

import { gunzipSync } from "node:zlib";

const BLOCK = 512;

export interface ReadEntry {
  name: string;
  data: Buffer;
  typeflag: string;
  header: Buffer;
}

function readString(buf: Buffer, off: number, len: number): string {
  let end = off;
  while (end < off + len && buf[end] !== 0) end++;
  return buf.subarray(off, end).toString("utf8");
}

function readOctal(buf: Buffer, off: number, len: number): number {
  const s = readString(buf, off, len).trim();
  return s ? parseInt(s, 8) : 0;
}

export function unpackTar(tar: Buffer): ReadEntry[] {
  const out: ReadEntry[] = [];
  let off = 0;
  while (off + BLOCK <= tar.length) {
    const header = tar.subarray(off, off + BLOCK);
    if (header.every(b => b === 0)) break;
    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] || 0x30);
    const magic = readString(header, 257, 6);
    const prefix = magic.startsWith("ustar") ? readString(header, 345, 155) : "";
    const full = prefix ? `${prefix}/${name}` : name;
    const dataStart = off + BLOCK;
    out.push({
      name: full,
      data: Buffer.from(tar.subarray(dataStart, dataStart + size)),
      typeflag,
      header: Buffer.from(header),
    });
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

export function unpackTgz(tgz: Buffer): ReadEntry[] {
  return unpackTar(gunzipSync(tgz));
}
