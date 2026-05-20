// Synthetic Windows DLL builder for the bakery's DLL-extraction tests.
//
// We need a tiny PE that:
//   1. parses with `pe-library`,
//   2. has a VS_VERSION_INFO resource (RT_VERSION = 16) whose
//      StringFileInfo includes a configurable `InternalName` entry —
//      this is what `extractChannelIconsFromDll` keys on to confirm
//      the DLL identity,
//   3. has an RCDATA resource (type 10) with a configurable string id
//      (default "CHANNELICONS.SKIN") holding configurable bytes (in
//      the happy path, a synthetic PACKAGEF).
//
// Approach: build the resource binaries by hand (the formats are
// small and well-specified), then drop them into an empty DLL via
// `pe-library`'s `NtExecutableResource`.

import { NtExecutable, NtExecutableResource } from "pe-library";

const RT_RCDATA = 10;
const RT_VERSION = 16;
/** US English / Unicode. */
const DEFAULT_LANG = 1033;
const DEFAULT_CODEPAGE = 1200;

/** Round up to 4-byte alignment. */
function pad4(b: Buffer): Buffer {
  const pad = (4 - (b.length % 4)) % 4;
  return pad ? Buffer.concat([b, Buffer.alloc(pad)]) : b;
}

/** Encode UTF-16LE with a trailing NUL. */
function wsz(s: string): Buffer {
  const buf = Buffer.alloc(s.length * 2 + 2);
  for (let i = 0; i < s.length; i++) buf.writeUInt16LE(s.charCodeAt(i), i * 2);
  return buf;
}

/**
 * Build one nested VS_VERSION_INFO block:
 *
 *   wLength u16, wValueLength u16, wType u16,
 *   szKey (UTF-16LE NUL-terminated),
 *   pad to 4-byte boundary measured from start of block,
 *   value,
 *   pad to 4-byte boundary,
 *   children (already 4-aligned by the caller).
 *
 * `wValueLength` is the size of `value` — in WORDs when `wType==1`
 * (text), in bytes when `wType==0` (binary). This matches the parser
 * in src/lib/dll.ts.
 */
function vsBlock(
  key: string,
  valueBin: Buffer,
  wType: 0 | 1,
  children: Buffer,
): Buffer {
  const header = Buffer.alloc(6);
  // wLength is patched once we know the final length.
  const wValueLength = wType === 1 ? Math.floor(valueBin.length / 2) : valueBin.length;
  header.writeUInt16LE(wValueLength, 2);
  header.writeUInt16LE(wType, 4);

  let block = Buffer.concat([header, wsz(key)]);
  // Align after key, before value.
  if (block.length % 4 !== 0) {
    block = Buffer.concat([block, Buffer.alloc(4 - (block.length % 4))]);
  }
  block = Buffer.concat([block, valueBin]);
  // Align after value, before children.
  if (block.length % 4 !== 0) {
    block = Buffer.concat([block, Buffer.alloc(4 - (block.length % 4))]);
  }
  block = Buffer.concat([block, children]);

  block.writeUInt16LE(block.length, 0);
  return block;
}

/** Build a single String entry inside a StringTable. */
function stringEntry(key: string, value: string): Buffer {
  const valueBuf = wsz(value);
  // wType=1 (text); wValueLength counts WORDs including the NUL.
  return vsBlock(key, valueBuf, 1, Buffer.alloc(0));
}

/** Build the StringTable for a single lang/codepage. */
function stringTable(
  lang: number,
  codepage: number,
  strings: Record<string, string>,
): Buffer {
  // Key is 8-char hex: 4 lang + 4 codepage, e.g. "040904B0".
  const key =
    lang.toString(16).padStart(4, "0").toUpperCase() +
    codepage.toString(16).padStart(4, "0").toUpperCase();
  const children = Buffer.concat(
    Object.entries(strings).map(([k, v]) => pad4(stringEntry(k, v))),
  );
  return vsBlock(key, Buffer.alloc(0), 1, children);
}

/**
 * Build a complete VS_VERSION_INFO blob with a single StringFileInfo
 * containing the given `strings` map.
 */
export function buildVersionInfo(opts: {
  strings: Record<string, string>;
  lang?: number;
  codepage?: number;
}): Buffer {
  const lang = opts.lang ?? DEFAULT_LANG;
  const codepage = opts.codepage ?? DEFAULT_CODEPAGE;
  // VS_FIXEDFILEINFO: 13 DWORDs = 52 bytes. Most of it is metadata
  // (file/product version etc) that we don't care about; just leave
  // dwSignature=0xFEEF04BD and the rest zero.
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xFEEF04BD, 0);
  fixed.writeUInt32LE(0x00010000, 4); // struct version 1.0

  const stringFileInfo = vsBlock(
    "StringFileInfo",
    Buffer.alloc(0),
    1,
    pad4(stringTable(lang, codepage, opts.strings)),
  );
  return vsBlock("VS_VERSION_INFO", fixed, 0, pad4(stringFileInfo));
}

export interface SyntheticDllOptions {
  internalName?: string;
  /** Resource id under RT_RCDATA. Set to null/undefined to omit. */
  channelIconsResourceId?: string | null;
  /** Bytes to store under the channel icons resource. */
  channelIconsBin?: Uint8Array;
  /** Omit VS_VERSION_INFO entirely (negative test). */
  omitVersionInfo?: boolean;
}

/**
 * Build a synthetic PreSonus-shaped DLL: empty 64-bit PE with a
 * resource section containing VS_VERSION_INFO + an RCDATA entry.
 */
export function buildSyntheticDll(opts: SyntheticDllOptions): Uint8Array {
  const exe = NtExecutable.createEmpty(false, true);
  const res = NtExecutableResource.from(exe);

  if (!opts.omitVersionInfo) {
    const versionBlob = buildVersionInfo({
      strings: {
        InternalName: opts.internalName ?? "com.presonus.studiolivepanel",
        FileDescription: "Synthetic test DLL",
        CompanyName: "PreSonus (synthetic)",
      },
    });
    res.entries.push({
      type: RT_VERSION,
      id: 1,
      lang: DEFAULT_LANG,
      codepage: DEFAULT_CODEPAGE,
      bin: toArrayBuffer(versionBlob),
    });
  }

  if (opts.channelIconsResourceId && opts.channelIconsBin) {
    res.entries.push({
      type: RT_RCDATA,
      id: opts.channelIconsResourceId,
      lang: DEFAULT_LANG,
      codepage: DEFAULT_CODEPAGE,
      bin: toArrayBuffer(opts.channelIconsBin),
    });
  }

  res.outputResource(exe);
  return new Uint8Array(exe.generate());
}

function toArrayBuffer(b: Uint8Array | Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
