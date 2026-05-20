// PACKAGEF (.skin) encoder used by Playwright tests. Mirror image of
// the parser in src/lib/packagef.ts + the format defined in
// presonus_packagef.ksy.
//
// We only encode the subset the bakery actually exercises:
//   - a Root index with arbitrarily-nested Folder/File entries,
//   - every File is a regular zlib stream of its decompressed bytes,
//   - the trailer is the 64-byte form described in the .ksy with
//     version=1, trailer_size=0x40, misc=zeros, padding=zeros.
//
// Anything fancier (flags != 0, real timestamps, etc.) is unused by
// the bakery so we keep them zero / fixed.

import { deflateSync } from "node:zlib";

const MAGIC = Buffer.from("PACKAGEF", "ascii");

export interface FileEntry {
  /** Raw decompressed bytes; the encoder zlib-deflates these. */
  data: Buffer;
}

export interface FolderEntry {
  /** Map of child-name -> child. Insertion order is preserved. */
  children: Map<string, FileEntry | FolderEntry>;
}

function isFolder(e: FileEntry | FolderEntry): e is FolderEntry {
  return "children" in e;
}

/**
 * Build a folder tree from a flat `{ path: bytes }` mapping. Paths use
 * forward slashes (the bakery expects e.g. `images/Other/Beard.svg`).
 */
export function folderFromPaths(
  entries: Record<string, Buffer | string>,
): FolderEntry {
  const root: FolderEntry = { children: new Map() };
  for (const [path, content] of Object.entries(entries)) {
    const parts = path.split("/");
    let cur: FolderEntry = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = cur.children.get(seg);
      if (!next) {
        next = { children: new Map() };
        cur.children.set(seg, next);
      } else if (!isFolder(next)) {
        throw new Error(`Path conflict at "${parts.slice(0, i + 1).join("/")}"`);
      }
      cur = next;
    }
    const leaf = parts[parts.length - 1];
    if (cur.children.has(leaf)) {
      throw new Error(`Duplicate path: ${path}`);
    }
    cur.children.set(
      leaf,
      { data: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8") },
    );
  }
  return root;
}

/** Encode a UTF-16LE null-terminated string ("utf16z" in the .ksy). */
function utf16z(s: string): Buffer {
  const buf = Buffer.alloc(s.length * 2 + 2);
  for (let i = 0; i < s.length; i++) {
    buf.writeUInt16LE(s.charCodeAt(i), i * 2);
  }
  // Final two bytes already zero from Buffer.alloc.
  return buf;
}

interface PendingFile {
  name: string;
  compressed: Buffer;
  decompressedSize: number;
  /** Filled in once we lay out the payload. */
  offset: number;
}

function collectFiles(root: FolderEntry): PendingFile[] {
  const out: PendingFile[] = [];
  function recurse(node: FolderEntry) {
    for (const [name, child] of node.children) {
      if (isFolder(child)) recurse(child);
      else {
        out.push({
          name,
          compressed: deflateSync(child.data),
          decompressedSize: child.data.length,
          offset: 0,
        });
      }
    }
  }
  recurse(root);
  return out;
}

/**
 * Walk the tree in the same order as `collectFiles`, emitting index
 * entries that reference the corresponding `PendingFile.offset`.
 */
function encodeIndex(root: FolderEntry, files: PendingFile[]): Buffer {
  const chunks: Buffer[] = [];
  let fileIdx = 0;

  function pushU32(v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v, 0);
    chunks.push(b);
  }
  function pushU64(v: number) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v), 0);
    chunks.push(b);
  }

  // Root: tag "Root", flags u32, num_children u32, then children.
  chunks.push(Buffer.from("Root", "ascii"));
  pushU32(0);
  pushU32(root.children.size);
  emitChildren(root);

  function emitChildren(folder: FolderEntry) {
    for (const [name, child] of folder.children) {
      if (isFolder(child)) {
        chunks.push(Buffer.from("Fold", "ascii"));
        pushU32(0); // flags
        chunks.push(utf16z(name));
        pushU32(child.children.size);
        emitChildren(child);
      } else {
        const f = files[fileIdx++];
        chunks.push(Buffer.from("File", "ascii"));
        pushU32(0); // flags
        chunks.push(utf16z(name));
        // timestamp: year u2, month/day/hour/minute/second u1, extra u1 = 8 bytes
        chunks.push(Buffer.alloc(8));
        chunks.push(Buffer.from([0])); // reserved u1
        pushU64(f.offset);
        pushU64(f.compressed.length);
        pushU64(f.decompressedSize);
      }
    }
  }

  return Buffer.concat(chunks);
}

/** Build a complete PACKAGEF (.skin) binary from a folder tree. */
export function buildPackagef(root: FolderEntry): Uint8Array {
  const files = collectFiles(root);

  // Lay out the payload: 8-byte "PACKAGEF" header, then each compressed
  // stream back-to-back. File offsets are absolute byte offsets into
  // the final file.
  let payloadOff = MAGIC.length;
  for (const f of files) {
    f.offset = payloadOff;
    payloadOff += f.compressed.length;
  }
  const payload = Buffer.concat(files.map(f => f.compressed));
  const indexBytes = encodeIndex(root, files);

  // Trailer is fixed 64 bytes per the .ksy:
  //   0..7    index_offset (u8)
  //   8..15   index_size (u8)
  //   16..31  padding (16 bytes, zero)
  //   32..47  misc (16 bytes, zero — real files have a fingerprint here)
  //   48..51  version (u4)
  //   52..55  trailer_size (u4)
  //   56..63  trailing_magic "PACKAGEF"
  const trailer = Buffer.alloc(64);
  const indexOffset = MAGIC.length + payload.length;
  trailer.writeBigUInt64LE(BigInt(indexOffset), 0);
  trailer.writeBigUInt64LE(BigInt(indexBytes.length), 8);
  trailer.writeUInt32LE(1, 48); // version
  trailer.writeUInt32LE(0x40, 52); // trailer_size
  MAGIC.copy(trailer, 56);

  return Buffer.concat([MAGIC, payload, indexBytes, trailer]);
}
