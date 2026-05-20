// Tar+gzip builder used by Playwright tests.
//
// We build USTAR archives by hand instead of importing src/lib/tgz.ts
// because that module uses browser-native CompressionStream which is
// awkward to drive synchronously from Node. node:zlib is the obvious
// equivalent, and the tar layout is small enough to repeat here.
//
// Output is byte-compatible with what `unpackTgz` in src/lib/tgz.ts
// expects.

import { gzipSync } from "node:zlib";

const BLOCK = 512;

export interface TarEntry {
  /** Full path; will be split across name(100)/prefix(155) if needed. */
  name: string;
  data: Buffer | Uint8Array | string;
}

function asBuffer(v: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === "string") return Buffer.from(v, "utf8");
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function writeString(buf: Buffer, off: number, len: number, s: string) {
  const b = Buffer.from(s, "utf8");
  if (b.length > len) throw new Error(`String too long for ${len}-byte field: ${s}`);
  b.copy(buf, off);
}

function writeOctal(buf: Buffer, off: number, len: number, val: number) {
  const oct = val.toString(8);
  const pad = len - 1 - oct.length;
  if (pad < 0) throw new Error(`Octal value too large: ${val}`);
  writeString(buf, off, len - 1, "0".repeat(pad) + oct);
  buf[off + len - 1] = 0;
}

function makeHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(BLOCK);
  let prefix = "";
  let nm = name;
  if (nm.length > 100) {
    const slash = nm.lastIndexOf("/", nm.length - 100 - 1);
    if (slash <= 0 || slash > 155) throw new Error(`Path too long: ${name}`);
    prefix = nm.slice(0, slash);
    nm = nm.slice(slash + 1);
  }
  writeString(h, 0, 100, nm);
  writeOctal(h, 100, 8, 0o644);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, 0);
  // checksum field 148..156 filled below
  h[156] = 0x30; // typeflag '0'
  writeString(h, 257, 6, "ustar");
  h[263] = 0x30; h[264] = 0x30; // version "00"
  if (prefix) writeString(h, 345, 155, prefix);

  // Compute checksum with bytes 148..156 treated as spaces.
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  writeString(h, 148, 6, sum.toString(8).padStart(6, "0"));
  h[154] = 0;
  h[155] = 0x20;
  return h;
}

export function buildTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = asBuffer(e.data);
    parts.push(makeHeader(e.name, data.length));
    parts.push(data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // two trailing zero blocks
  return Buffer.concat(parts);
}

export function buildTgz(entries: TarEntry[]): Buffer {
  return gzipSync(buildTar(entries));
}

/**
 * Convenience: build a minimal valid Companion module tarball that
 * passes `validateModuleTgz` (correct id, semver > 0.0.0, manifest at
 * the expected path).
 *
 * Caller can override `id` or `version` to produce intentionally-bad
 * fixtures for validation tests.
 */
export function buildModuleTgz(opts?: {
  id?: string;
  version?: string;
  extraFiles?: TarEntry[];
  omitManifest?: boolean;
}): Buffer {
  const id = opts?.id ?? "bitfocus-presonus-studiolive";
  const version = opts?.version ?? "1.2.3";
  const entries: TarEntry[] = [];
  if (!opts?.omitManifest) {
    entries.push({
      name: "pkg/companion/manifest.json",
      data: JSON.stringify({ id, version, name: "Test", manufacturer: "Test" }, null, 2),
    });
  }
  // A few "existing" files so the bakery has something to round-trip.
  entries.push({ name: "pkg/main.js", data: "// stub\n" });
  entries.push({ name: "pkg/package.json", data: JSON.stringify({ name: id, version }) });
  if (opts?.extraFiles) entries.push(...opts.extraFiles);
  return buildTgz(entries);
}
