import { PresonusPackagef, KaitaiStream } from "./kaitai";

// ---- Public types ---------------------------------------------------------

export interface FileEntry {
  kind: "file";
  name: string;
  flags: number;
  offset: number;
  csize: number;
  dsize: number;
  timestamp: string;
  // Reference back to the raw .skin bytes so we can decompress on demand.
  pkg: SkinPackage;
}

export interface FolderEntry {
  kind: "dir";
  name: string;
  flags: number;
  children: Entry[];
}

export type Entry = FileEntry | FolderEntry;

export interface SkinPackage {
  root: FolderEntry;
  version: number;
  trailerSize: number;
  indexOffset: number;
  indexSize: number;
  signature: string;
  fileSize: number;
  /** Raw bytes of the .skin file (kept so we can extract files on demand). */
  raw: Uint8Array;
}

// ---- Utilities ------------------------------------------------------------

function u16ArrayToString(units: ArrayLike<number>): string {
  // Drop the trailing 0 terminator.
  const n = units.length > 0 && units[units.length - 1] === 0 ? units.length - 1 : units.length;
  const bytes = new Uint8Array(n * 2);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) dv.setUint16(i * 2, units[i], true);
  return new TextDecoder("utf-16le").decode(bytes);
}

function fmtTimestamp(t: any): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${String(t.year).padStart(4, "0")}-${pad(t.month)}-${pad(t.day)} ` +
    `${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`
  );
}

// ---- Parser ---------------------------------------------------------------

export function parseSkin(buf: ArrayBuffer): SkinPackage {
  const u8 = new Uint8Array(buf);
  const stream = new KaitaiStream(buf);
  const parsed: any = new PresonusPackagef(stream);

  const raw: SkinPackage = {
    root: { kind: "dir", name: "", flags: 0, children: [] },
    version: parsed.trailer.version,
    trailerSize: parsed.trailer.trailerSize,
    indexOffset: parsed.trailer.indexOffset,
    indexSize: parsed.trailer.indexSize,
    signature: Array.from(parsed.trailer.misc as Uint8Array)
      .map(b => b.toString(16).padStart(2, "0"))
      .join(""),
    fileSize: u8.byteLength,
    raw: u8,
  };

  function convert(node: any): Entry[] {
    return node.children.map((child: any): Entry => {
      const name = u16ArrayToString(child.body.name.codeUnits);
      if (child.tag === "File") {
        const body = child.body;
        return {
          kind: "file",
          name,
          flags: body.flags,
          offset: body.offset,
          csize: body.compressedSize,
          dsize: body.decompressedSize,
          timestamp: fmtTimestamp(body.timestamp),
          pkg: raw,
        };
      }
      return {
        kind: "dir",
        name,
        flags: child.body.flags,
        children: convert(child.body),
      };
    });
  }

  raw.root = {
    kind: "dir",
    name: "",
    flags: parsed.index.root.flags,
    children: convert(parsed.index.root),
  };
  return raw;
}

// ---- Helpers --------------------------------------------------------------

export function* walk(node: FolderEntry, prefix = ""): Generator<{ path: string; entry: FileEntry }> {
  for (const c of node.children) {
    if (c.kind === "file") yield { path: prefix + c.name, entry: c };
    else yield* walk(c, prefix + c.name + "/");
  }
}

export async function readFileBytes(entry: FileEntry): Promise<Uint8Array> {
  const slice = entry.pkg.raw.subarray(entry.offset, entry.offset + entry.csize);
  const cs = new DecompressionStream("deflate");
  const stream = new Blob([slice as BlobPart]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  const out = new Uint8Array(buf);
  if (out.length !== entry.dsize) {
    console.warn(
      `${entry.name}: decompressed ${out.length} bytes, expected ${entry.dsize}`,
    );
  }
  return out;
}
