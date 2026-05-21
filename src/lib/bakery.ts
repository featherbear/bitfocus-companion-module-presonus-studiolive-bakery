// Bakery orchestrator: combines a user-supplied channelicons.skin with a
// user-supplied Companion module .tgz, injecting tokenized SVG icons
// into the latter for runtime recoloring/rasterization by the module.

import {
  parseSkin,
  readFileBytes,
  walk,
  type FileEntry,
  type FolderEntry,
  type SkinPackage,
} from "./packagef";
import { tokenizeSvgFills } from "./svg-tokenize";
import { newFile, packTgz, unpackTgz, type TarFile } from "./tgz";
import { validateManifest, type Manifest } from "./manifest";
import {
  extractChannelIconsFromDll,
  looksLikePE,
  looksLikePackagef,
} from "./dll";

/** The .skin entry we use as a sanity check. */
const REQUIRED_SKIN_ENTRY = "images/Other/Beard.svg";

/**
 * Where, inside the unpacked tarball, the bakery deposits the icon SVGs.
 * The runtime side of the Companion module is expected to load from
 * the same prefix. Subject to change as the module side firms up.
 */
export const ICON_PREFIX_IN_TGZ = "pkg/companion/icons/studiolive/";

/**
 * Path of the disclaimer file we drop into the baked tarball alongside
 * the manifest. Records when the bake happened, what it was baked from,
 * and that the author claims no liability for the result.
 */
export const BAKED_NOTICE_PATH = "pkg/BAKED.txt";

export interface BakeResult {
  /** Re-packed .tgz, ready to be downloaded. */
  blob: Blob;
  /** Suggested filename based on the input + module version. */
  filename: string;
  /** Validated module manifest from the input tarball. */
  manifest: Manifest;
  /** Number of icons baked in. */
  iconCount: number;
}

export interface BakeInputs {
  /**
   * Either a `.skin` file or a Windows DLL that bundles
   * `channelicons.skin` as an RCDATA resource.
   */
  channelIconsFile: File;
  tgzFile: File;
  /** Optional progress callback. */
  onProgress?: (phase: string) => void;
}

/**
 * Where the PACKAGEF bytes came from.
 *
 * - `"skin"`: the user picked a raw `channelicons.skin` (macOS path).
 * - `"dll"`: the user picked a Windows DLL and we extracted the
 *   embedded RCDATA resource.
 */
export type ChannelIconsSource = "skin" | "dll";

/** Result of an early skin-file sanity check. */
export interface ChannelIconsPackagefCheck {
  pkg: SkinPackage;
  iconCount: number;
  source: ChannelIconsSource;
}

/** Result of an early tarball sanity check. */
export interface ModuleTgzCheck {
  files: TarFile[];
  manifest: Manifest;
}

/**
 * Validate a user-supplied file holding the channel-icons PACKAGEF
 * container, in either of two forms:
 *
 * - A raw `channelicons.skin` file (macOS).
 * - A PreSonus DLL (Windows) that bundles `channelicons.skin` as an
 *   RCDATA resource — we sniff for "MZ" and extract via pe-library.
 *
 * Throws with a user-actionable message if the file is neither, or if
 * the parsed PACKAGEF doesn't contain the expected sentinel entry.
 */
export async function validateChannelIconsPackagef(
  file: File,
): Promise<ChannelIconsPackagefCheck> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  let packagefBytes: Uint8Array;
  let source: ChannelIconsSource;
  if (looksLikePackagef(bytes)) {
    packagefBytes = bytes;
    source = "skin";
  } else if (looksLikePE(bytes)) {
    packagefBytes = extractChannelIconsFromDll(bytes);
    source = "dll";
  } else {
    throw new Error(
      `File is neither a PACKAGEF (.skin) container nor a Windows DLL`,
    );
  }

  // parseSkin wants an ArrayBuffer; pass an exact-sized one.
  const ab = packagefBytes.buffer.slice(
    packagefBytes.byteOffset,
    packagefBytes.byteOffset + packagefBytes.byteLength,
  ) as ArrayBuffer;
  const pkg = parseSkin(ab);
  assertHasSkinEntry(pkg.root, REQUIRED_SKIN_ENTRY);

  let iconCount = 0;
  for (const { path } of walk(pkg.root)) {
    if (path.startsWith("images/") && path.toLowerCase().endsWith(".svg")) {
      iconCount++;
    }
  }
  return { pkg, iconCount, source };
}

/**
 * Unpack the .tgz and validate the Companion module manifest. Throws
 * if the tarball isn't a `presonus-studiolive` module at version
 * `> 0.0.0`.
 */
export async function validateModuleTgz(tgzFile: File): Promise<ModuleTgzCheck> {
  const bytes = new Uint8Array(await tgzFile.arrayBuffer());
  const files = await unpackTgz(bytes);
  const manifest = validateManifest(files);
  return { files, manifest };
}

export async function bake(inputs: BakeInputs): Promise<BakeResult> {
  const { channelIconsFile, tgzFile, onProgress } = inputs;
  const progress = (s: string) => onProgress?.(s);

  // 1. Parse + sanity-check the channel-icons input (raw .skin or DLL).
  progress("Parsing channel icons…");
  const { pkg, source } = await validateChannelIconsPackagef(channelIconsFile);

  // 2. Unpack the user-supplied tarball + validate manifest.
  progress("Unpacking module .tgz…");
  const { files: tarFiles, manifest } = await validateModuleTgz(tgzFile);

  // 3. Walk every SVG in the .skin, tokenize, and add (or replace) it
  //    in the tar file list. Collisions on the target path throw.
  progress("Tokenizing icons…");
  const decoder = new TextDecoder("utf-8");
  const iconsAdded = new Map<string, TarFile>();

  for (const { path, entry } of walk(pkg.root)) {
    if (!path.startsWith("images/")) continue;
    if (!path.toLowerCase().endsWith(".svg")) continue;

    const target = iconTargetPath(path);

    if (iconsAdded.has(target)) {
      throw new Error(
        `Icon path collision: two source icons normalize to the same ` +
        `target "${target}". Conflicting source: "${path}".`,
      );
    }

    const svgText = decoder.decode(await readFileBytes(entry as FileEntry));
    const tokenized = tokenizeSvgFills(svgText);
    const tokenizedBytes = new TextEncoder().encode(tokenized);

    iconsAdded.set(target, newFile(target, tokenizedBytes));
  }

  // 4. Add the BAKED.txt notice. Same epoch as the output filename so
  //    the two timestamps agree.
  const epoch = Math.floor(Date.now() / 1000);
  const noticeText = bakedNoticeText({
    epoch,
    channelIconsFilename: channelIconsFile.name,
    channelIconsSource: source,
    moduleTgzFilename: tgzFile.name,
    manifest,
    iconCount: iconsAdded.size,
  });
  const noticeFile = newFile(
    BAKED_NOTICE_PATH,
    new TextEncoder().encode(noticeText),
  );

  // 5. Merge the new icons + notice into the tar file list. Pre-existing
  //    entries at any of these paths are silently overwritten — the
  //    bakery owns the icons directory and the notice file.
  const additions = new Map(iconsAdded);
  additions.set(BAKED_NOTICE_PATH, noticeFile);
  const merged = mergeFiles(tarFiles, additions);

  // 6. Repack and gzip.
  progress("Packing baked .tgz…");
  const out = await packTgz(merged);

  return {
    blob: new Blob([out as BlobPart], { type: "application/gzip" }),
    filename: bakedFilename(tgzFile.name, epoch),
    manifest,
    iconCount: iconsAdded.size,
  };
}

// ---------- helpers -------------------------------------------------------

/**
 * Translate a source path inside the .skin (e.g. `images/Brass/Brass Section.svg`)
 * to the destination path inside the tarball (e.g.
 * `pkg/companion/icons/studiolive/brass/brasssection.svg`).
 *
 * Convention: lowercase everything; strip whitespace. Other punctuation
 * (including dots and parentheses) is left as-is. Collisions are
 * rejected by the caller.
 */
export function iconTargetPath(skinPath: string): string {
  const stripped = skinPath.replace(/^images\//, "");
  const normalized = stripped
    .split("/")
    .map(seg => seg.toLowerCase().replace(/\s+/g, ""))
    .join("/");
  return ICON_PREFIX_IN_TGZ + normalized;
}

function assertHasSkinEntry(root: FolderEntry, required: string) {
  for (const { path } of walk(root)) {
    if (path === required) return;
  }
  throw new Error(
    `This file does not look like channelicons.skin (missing "${required}").`,
  );
}

/**
 * Combine the original tarball's files with the newly-tokenized icons.
 * If an icon path already exists in the input tarball, the new entry
 * replaces it (and is marked dirty so packTgz emits a fresh header).
 */
function mergeFiles(original: TarFile[], icons: Map<string, TarFile>): TarFile[] {
  const merged: TarFile[] = [];
  const replaced = new Set<string>();

  for (const f of original) {
    const replacement = icons.get(f.name);
    if (replacement) {
      merged.push(replacement);
      replaced.add(f.name);
    } else {
      merged.push(f);
    }
  }
  for (const [name, f] of icons) {
    if (!replaced.has(name)) merged.push(f);
  }
  return merged;
}

function bakedFilename(inputName: string, epoch: number): string {
  const base = inputName.replace(/\.tgz$/i, "").replace(/\.tar\.gz$/i, "");
  return `${base}-baked-${epoch}.tgz`;
}

interface BakedNoticeFields {
  epoch: number;
  channelIconsFilename: string;
  channelIconsSource: ChannelIconsSource;
  moduleTgzFilename: string;
  manifest: Manifest;
  iconCount: number;
}

function bakedNoticeText(f: BakedNoticeFields): string {
  const iso = new Date(f.epoch * 1000).toISOString();
  const sourceLabel =
    f.channelIconsSource === "dll"
      ? "Windows DLL (channelicons.skin extracted from RCDATA)"
      : "raw channelicons.skin";
  return [
    `This Bitfocus Companion module has been MODIFIED by an automated`,
    `bakery tool. It is no longer the upstream module as published; it`,
    `has had third-party vendor channel icons embedded into it.`,
    ``,
    `Baked at:           ${iso} (unix epoch ${f.epoch})`,
    `Module:             ${f.manifest.id}@${f.manifest.version}`,
    `Source module .tgz: ${f.moduleTgzFilename}`,
    `Icon source:        ${sourceLabel}`,
    `Icon source file:   ${f.channelIconsFilename}`,
    `Icons embedded:     ${f.iconCount}`,
    ``,
    `DO NOT REDISTRIBUTE THIS FILE. The embedded icons are vendor`,
    `assets that you supplied from your own licensed installation.`,
    ``,
    `NO WARRANTY. The author of this module provides this software`,
    `and its output as-is, with no warranties of any kind, and claims`,
    `no liability for any damages, license violations, or other`,
    `consequences arising from its use or distribution.`,
    ``,
  ].join("\n");
}
