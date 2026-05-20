// Extracts the embedded `channelicons.skin` PACKAGEF container from a
// Windows PreSonus DLL.
//
// Verification (in order):
//   1. The file looks like a PE binary ("MZ" header).
//   2. pe-library can parse it.
//   3. The DLL's VS_VERSION_INFO has InternalName == EXPECTED_INTERNAL_NAME.
//   4. There's an RCDATA resource with id == "CHANNELICONS.SKIN"
//      (case-insensitive — PreSonus stores it uppercase, but we don't
//      want this check to be brittle if that changes).
//   5. That entry's payload starts with the 8-byte "PACKAGEF" magic.
//
// We do all checks ourselves rather than reaching for `resedit` to
// keep the dependency footprint minimal: we already pay for
// `pe-library` to read raw resources, and the VS_VERSION_INFO format
// is small and well-specified.

import { NtExecutable, NtExecutableResource } from "pe-library";

/** Resource type id for RT_RCDATA. */
const RT_RCDATA = 10;
/** Resource type id for RT_VERSION. */
const RT_VERSION = 16;

/** Exact string id (case-insensitive) we expect for channelicons.skin. */
const CHANNEL_ICONS_RESOURCE_ID = "CHANNELICONS.SKIN";

/** Required value for the StringFileInfo `InternalName` entry. */
const EXPECTED_INTERNAL_NAME = "com.presonus.studiolivepanel";

/** Magic bytes at the start of a PACKAGEF container — 8 ASCII chars. */
const PACKAGEF_MAGIC = new Uint8Array([
  0x50, 0x41, 0x43, 0x4b, 0x41, 0x47, 0x45, 0x46, // "PACKAGEF"
]);

/** Magic bytes at the start of a PE file — "MZ". */
export const MZ_MAGIC = new Uint8Array([0x4d, 0x5a]);

/** Cheap probe: does this byte slice look like a Windows PE binary? */
export function looksLikePE(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === MZ_MAGIC[0] && buf[1] === MZ_MAGIC[1];
}

/** Cheap probe: does this byte slice look like a raw PACKAGEF container? */
export function looksLikePackagef(buf: Uint8Array): boolean {
  if (buf.length < PACKAGEF_MAGIC.length) return false;
  for (let i = 0; i < PACKAGEF_MAGIC.length; i++) {
    if (buf[i] !== PACKAGEF_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Parse `dllBytes` as a PE binary, verify it's the PreSonus
 * studiolivepanel DLL, and pull out the embedded
 * `channelicons.skin` PACKAGEF bytes from its RCDATA resources.
 * Throws with a user-actionable message on any check failure.
 */
export function extractChannelIconsFromDll(dllBytes: Uint8Array): Uint8Array {
  if (!looksLikePE(dllBytes)) {
    throw new Error(
      `File does not look like a Windows DLL (missing "MZ" header).`,
    );
  }

  let exe: NtExecutable;
  try {
    const ab = dllBytes.buffer.slice(
      dllBytes.byteOffset,
      dllBytes.byteOffset + dllBytes.byteLength,
    ) as ArrayBuffer;
    // ignoreCert: signed PreSonus DLLs are common; we don't care
    // about the signature, we just want resource bytes.
    exe = NtExecutable.from(ab, { ignoreCert: true });
  } catch (err) {
    throw new Error(
      `Could not parse DLL as a PE binary: ${(err as Error).message}`,
    );
  }

  const res = NtExecutableResource.from(exe);

  // --- Identity check via VS_VERSION_INFO -------------------------------
  const versionEntry = res.entries.find(e => e.type === RT_VERSION);
  if (!versionEntry) {
    throw new Error(
      `DLL has no VS_VERSION_INFO resource; can't verify it's the ` +
      `PreSonus studiolivepanel DLL.`,
    );
  }
  const internalName = readInternalName(new Uint8Array(versionEntry.bin));
  if (internalName === null) {
    throw new Error(
      `Could not find InternalName in the DLL's version info.`,
    );
  }
  if (internalName !== EXPECTED_INTERNAL_NAME) {
    throw new Error(
      `Wrong DLL: expected InternalName "${EXPECTED_INTERNAL_NAME}", ` +
      `got "${internalName}". Make sure you picked studiolivepanel.dll.`,
    );
  }

  // --- Find the channelicons.skin RCDATA entry by id --------------------
  const target = res.entries.find(
    e =>
      e.type === RT_RCDATA &&
      typeof e.id === "string" &&
      e.id.toUpperCase() === CHANNEL_ICONS_RESOURCE_ID,
  );
  if (!target) {
    throw new Error(
      `DLL has no RCDATA resource named "${CHANNEL_ICONS_RESOURCE_ID}".`,
    );
  }

  const bin = new Uint8Array(target.bin);
  if (!looksLikePackagef(bin)) {
    throw new Error(
      `RCDATA resource "${CHANNEL_ICONS_RESOURCE_ID}" doesn't start ` +
      `with the "PACKAGEF" signature.`,
    );
  }

  // Return a freshly-allocated copy so subsequent kaitai parsing owns
  // a stable buffer independent of the DLL.
  return bin.slice();
}

// ---------------------------------------------------------------------------
// VS_VERSION_INFO parser
//
// Format (Microsoft docs: VERSIONINFO resource):
//
//   typedef struct {
//     WORD wLength;          // length of this whole structure incl. children
//     WORD wValueLength;     // length of the Value member, in bytes
//                            // (or in WORDs if wType == 1, ugh)
//     WORD wType;            // 0 = binary, 1 = text (UTF-16LE)
//     WCHAR szKey[];         // null-terminated UTF-16LE
//     // padding to DWORD boundary
//     BYTE Value[wValueLength];
//     // padding to DWORD boundary
//     ChildrenStruct[];
//   }
//
// We walk the tree shallowly:
//   VS_VERSION_INFO
//     └─ StringFileInfo
//          └─ <lang-codepage>            (e.g. "040004E4")
//               └─ String "InternalName" → value
//
// All offsets are aligned to 4 bytes after each variable-length field.

/** Decode a NUL-terminated UTF-16LE string starting at `off`. Returns the string and the byte offset just past the terminator. */
function readSzKey(view: DataView, off: number): { text: string; next: number } {
  let s = "";
  while (off + 1 < view.byteLength) {
    const c = view.getUint16(off, true);
    off += 2;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return { text: s, next: off };
}

/** Round `off` up to the next multiple of 4. */
function align4(off: number): number {
  return (off + 3) & ~3;
}

/**
 * Pull the `InternalName` value out of a VS_VERSION_INFO blob, or
 * `null` if the structure is malformed or the entry is missing.
 *
 * Defensive against malformed input: every container length is
 * clamped to its parent's bounds.
 */
function readInternalName(bin: Uint8Array): string | null {
  if (bin.byteLength < 6) return null;
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

  // Outer VS_VERSION_INFO
  const outerLen = view.getUint16(0, true);
  if (outerLen > bin.byteLength) return null;
  const outerEnd = outerLen;

  // skip wLength, wValueLength, wType
  let off = 6;
  const { text: outerKey, next: afterKey } = readSzKey(view, off);
  if (outerKey !== "VS_VERSION_INFO") return null;
  off = align4(afterKey);

  // skip the fixed VS_FIXEDFILEINFO value (wValueLength bytes)
  const fixedValueLen = view.getUint16(2, true);
  off = align4(off + fixedValueLen);

  // walk children: StringFileInfo / VarFileInfo
  while (off + 6 <= outerEnd) {
    const childLen = view.getUint16(off, true);
    if (childLen === 0 || childLen + off > outerEnd) return null;
    const childEnd = off + childLen;

    // childValueLen = view.getUint16(off + 2, true); // unused
    // childType = view.getUint16(off + 4, true);     // unused
    const { text: childKey, next: afterChildKey } = readSzKey(view, off + 6);
    let p = align4(afterChildKey);

    if (childKey === "StringFileInfo") {
      // children: one or more StringTable blocks
      while (p + 6 <= childEnd) {
        const stLen = view.getUint16(p, true);
        if (stLen === 0 || p + stLen > childEnd) return null;
        const stEnd = p + stLen;
        const { next: afterStKey } = readSzKey(view, p + 6);
        let q = align4(afterStKey);
        // children: String entries
        while (q + 6 <= stEnd) {
          const sLen = view.getUint16(q, true);
          const sValueLen = view.getUint16(q + 2, true);
          const sType = view.getUint16(q + 4, true);
          if (sLen === 0 || q + sLen > stEnd) return null;
          const { text: sKey, next: afterSKey } = readSzKey(view, q + 6);
          const valueOff = align4(afterSKey);
          // sValueLen is in WORDs when sType==1 (text), bytes when sType==0.
          const valueByteLen = sType === 1 ? sValueLen * 2 : sValueLen;
          if (sKey === "InternalName") {
            // Value is a UTF-16LE string, possibly NUL-terminated.
            const valueEnd = Math.min(valueOff + valueByteLen, q + sLen);
            let s = "";
            for (let v = valueOff; v + 1 < valueEnd; v += 2) {
              const c = view.getUint16(v, true);
              if (c === 0) break;
              s += String.fromCharCode(c);
            }
            return s;
          }
          // Advance by the entry's own declared length.
          q += sLen;
          q = align4(q);
        }
        p = stEnd;
      }
    }

    off = childEnd;
  }

  return null;
}
