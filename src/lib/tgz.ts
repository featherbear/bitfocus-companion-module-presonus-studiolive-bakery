// Minimal tar + gzip support for the Companion module bakery.
//
// Implements just enough of the USTAR format to read npm-packed
// tarballs, modify their contents, and write them back out. Gzip is
// handled by the browser's native CompressionStream / DecompressionStream.
//
// Intentional simplifications:
//   - Files with size > 8 GiB are not supported (we only read the
//     standard octal-encoded `size` field, not the GNU base-256
//     extension, since npm pack doesn't produce those).
//   - PAX extended headers (typeflag 'x' / 'g') are passed through
//     untouched as opaque blobs. We don't merge their key/value pairs
//     into the following file headers — for npm pack output (which is
//     plain ustar) this is fine. If long file names appear via PAX,
//     `name` will be the truncated ustar name; we don't use names from
//     the PAX records.
//   - On write, files we didn't touch keep their original 512-byte
//     header verbatim so we don't accidentally mutate mode/uid/gid/mtime.
//   - Synthesized headers for added files are minimal ustar with
//     mode=0644, uid=gid=0, mtime=0, uname=gname="".

const BLOCK_SIZE = 512;

export interface TarFile {
  /** Full path within the archive, e.g. "package/package.json". */
  name: string;
  /** Decompressed file payload. Empty for directories / non-file types. */
  data: Uint8Array;
  /** USTAR typeflag character (e.g. '0' for file, '5' for dir, 'x'/'g' for PAX). */
  typeflag: string;
  /**
   * Original 512-byte header for entries we read from disk. When set,
   * `packTgz` reuses these bytes verbatim if `data` is unchanged. For
   * synthesized entries this is `null`.
   */
  header: Uint8Array | null;
  /** Tracks whether `data` was modified (or the entry is brand new). */
  dirty: boolean;
}

// ---------- gzip ----------------------------------------------------------

async function gunzip(buf: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([buf as BlobPart]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gzip(buf: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([buf as BlobPart]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- tar reading ---------------------------------------------------

function readCString(bytes: Uint8Array, off: number, len: number): string {
  let end = off;
  const limit = off + len;
  while (end < limit && bytes[end] !== 0) end++;
  return new TextDecoder("utf-8").decode(bytes.subarray(off, end));
}

function readOctal(bytes: Uint8Array, off: number, len: number): number {
  // Octal numeric fields are space- and NUL-padded ASCII. Empty/all-NUL is 0.
  const s = readCString(bytes, off, len).trim();
  if (!s) return 0;
  return parseInt(s, 8);
}

function unpackTar(tar: Uint8Array): TarFile[] {
  const out: TarFile[] = [];
  let off = 0;

  while (off + BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(off, off + BLOCK_SIZE);

    // End-of-archive: two consecutive zero blocks. We exit on the first
    // all-zero block; the second is just padding.
    if (header.every(b => b === 0)) break;

    const nameField = readCString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] || 0x30); // default '0'
    const magic = readCString(header, 257, 6);
    const prefix = magic === "ustar" ? readCString(header, 345, 155) : "";

    const fullName = prefix ? `${prefix}/${nameField}` : nameField;

    const dataStart = off + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) {
      throw new Error(`Tar entry "${fullName}" extends past end of archive`);
    }

    out.push({
      name: fullName,
      data: tar.slice(dataStart, dataEnd),
      typeflag,
      header: header.slice(),
      dirty: false,
    });

    // Advance: header + size, padded up to next 512 boundary.
    const padded = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    off = dataStart + padded;
  }

  return out;
}

// ---------- tar writing ---------------------------------------------------

function writeAscii(into: Uint8Array, off: number, len: number, str: string) {
  const enc = new TextEncoder().encode(str);
  if (enc.length > len) throw new Error(`Field overflow at offset ${off}: "${str}"`);
  into.set(enc, off);
  // Remainder of the slot is left as zero.
}

function writeOctal(into: Uint8Array, off: number, len: number, value: number) {
  // Tar octal fields are zero-padded ASCII octal followed by a NUL (or
  // a space for the checksum). `len` includes the terminator.
  const oct = value.toString(8);
  const padLen = len - 1 - oct.length;
  if (padLen < 0) throw new Error(`Octal value ${value} too large for ${len}-byte field`);
  writeAscii(into, off, len - 1, "0".repeat(padLen) + oct);
  into[off + len - 1] = 0;
}

function computeChecksum(header: Uint8Array): number {
  // Per the tar spec: sum of all bytes of the header treating the
  // checksum field (bytes 148..156) as 8 ASCII spaces.
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : header[i];
  }
  return sum;
}

function writeChecksum(header: Uint8Array) {
  const sum = computeChecksum(header);
  // Format: 6 octal digits, NUL, space.
  const oct = sum.toString(8).padStart(6, "0");
  writeAscii(header, 148, 6, oct);
  header[154] = 0;
  header[155] = 0x20;
}

/**
 * Synthesize a 512-byte ustar header for a new regular-file entry.
 * Splits long names across the prefix/name fields automatically.
 */
function makeHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(BLOCK_SIZE);

  // Split name across prefix (155) + name (100) if needed. The split must
  // fall on a `/` boundary. For npm-style paths this is straightforward.
  let prefix = "";
  let nameField = name;
  if (nameField.length > 100) {
    const slash = nameField.lastIndexOf("/", nameField.length - 100 - 1);
    if (slash <= 0 || slash > 155) {
      throw new Error(`Path too long for ustar header: "${name}"`);
    }
    prefix = nameField.slice(0, slash);
    nameField = nameField.slice(slash + 1);
    if (nameField.length > 100 || prefix.length > 155) {
      throw new Error(`Path components too long for ustar header: "${name}"`);
    }
  }

  writeAscii(header, 0, 100, nameField);
  writeOctal(header, 100, 8, 0o644);    // mode
  writeOctal(header, 108, 8, 0);        // uid
  writeOctal(header, 116, 8, 0);        // gid
  writeOctal(header, 124, 12, size);    // size
  writeOctal(header, 136, 12, 0);       // mtime (epoch)
  // checksum filled in last
  header[156] = 0x30;                   // typeflag '0' = regular file
  // linkname (157, 100) zero
  writeAscii(header, 257, 6, "ustar");  // magic
  header[263] = 0x30; header[264] = 0x30; // version "00"
  // uname/gname/devmajor/devminor left zero
  if (prefix) writeAscii(header, 345, 155, prefix);

  writeChecksum(header);
  return header;
}

function packTar(files: TarFile[]): Uint8Array {
  // Compute total size: each entry is 512 (header) + roundUp(size, 512),
  // plus 1024 bytes of trailing zero blocks.
  let total = 0;
  for (const f of files) {
    total += BLOCK_SIZE + Math.ceil(f.data.length / BLOCK_SIZE) * BLOCK_SIZE;
  }
  total += BLOCK_SIZE * 2;

  const out = new Uint8Array(total);
  let off = 0;
  for (const f of files) {
    let header: Uint8Array;
    if (f.dirty || !f.header) {
      header = makeHeader(f.name, f.data.length);
    } else {
      // Reuse original header verbatim; this preserves all metadata for
      // entries we didn't touch.
      header = f.header;
    }
    out.set(header, off);
    off += BLOCK_SIZE;
    out.set(f.data, off);
    off += Math.ceil(f.data.length / BLOCK_SIZE) * BLOCK_SIZE;
  }
  // Two trailing zero blocks: implicit (already zero-initialized).
  return out;
}

// ---------- public API ----------------------------------------------------

export async function unpackTgz(buf: Uint8Array): Promise<TarFile[]> {
  let tar: Uint8Array;
  try {
    tar = await gunzip(buf);
  } catch {
    // DecompressionStream throws a generic "The operation was aborted" DOMException
    // for invalid gzip data. Emit something actionable instead.
    if (buf.length < 2 || buf[0] !== 0x1f || buf[1] !== 0x8b) {
      throw new Error("File does not appear to be a .tgz file");
    }
    throw new Error("File is a gzip archive but its contents are corrupt or truncated");
  }
  return unpackTar(tar);
}

export async function packTgz(files: TarFile[]): Promise<Uint8Array> {
  const tar = packTar(files);
  return gzip(tar);
}

/** Build a brand-new in-memory file entry to insert into a tar list. */
export function newFile(name: string, data: Uint8Array): TarFile {
  return { name, data, typeflag: "0", header: null, dirty: true };
}
