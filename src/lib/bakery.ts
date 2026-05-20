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

/** The .skin entry we use as a sanity check. */
const REQUIRED_SKIN_ENTRY = "images/Other/Beard.svg";

/**
 * Where, inside the unpacked tarball, the bakery deposits the icon SVGs.
 * The runtime side of the Companion module is expected to load from
 * the same prefix. Subject to change as the module side firms up.
 */
export const ICON_PREFIX_IN_TGZ = "package/companion/icons/";

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
  skinFile: File;
  tgzFile: File;
  /** Optional progress callback. Phases: parse, validate, extract, repack. */
  onProgress?: (phase: string) => void;
}

/** Result of an early skin-file sanity check. */
export interface ChannelIconsPackagefCheck {
  pkg: SkinPackage;
  iconCount: number;
}

/** Result of an early tarball sanity check. */
export interface ModuleTgzCheck {
  files: TarFile[];
  manifest: Manifest;
}

/**
 * Parse the .skin and confirm it looks like channelicons.skin. Throws
 * with a user-actionable message if not. Cheap enough to run on every
 * file pick — no network, no big allocations beyond the file itself.
 */
export async function validateChannelIconsPackagef(
  skinFile: File,
): Promise<ChannelIconsPackagefCheck> {
  const pkg = parseSkin(await skinFile.arrayBuffer());
  assertHasSkinEntry(pkg.root, REQUIRED_SKIN_ENTRY);
  let iconCount = 0;
  for (const { path } of walk(pkg.root)) {
    if (path.startsWith("images/") && path.toLowerCase().endsWith(".svg")) {
      iconCount++;
    }
  }
  return { pkg, iconCount };
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
  const { skinFile, tgzFile, onProgress } = inputs;
  const progress = (s: string) => onProgress?.(s);

  // 1. Parse and sanity-check the .skin.
  progress("Parsing .skin container…");
  const { pkg } = await validateChannelIconsPackagef(skinFile);

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

  // 4. Merge the new icons into the tar file list. Pre-existing entries
  //    at any of the icon target paths are silently overwritten — the
  //    bakery is the source of truth for the icons directory.
  const merged = mergeFiles(tarFiles, iconsAdded);

  // 5. Repack and gzip.
  progress("Packing baked .tgz…");
  const out = await packTgz(merged);

  return {
    blob: new Blob([out as BlobPart], { type: "application/gzip" }),
    filename: bakedFilename(tgzFile.name),
    manifest,
    iconCount: iconsAdded.size,
  };
}

// ---------- helpers -------------------------------------------------------

/**
 * Translate a source path inside the .skin (e.g. `images/Brass/Brass Section.svg`)
 * to the destination path inside the tarball (e.g.
 * `package/companion/icons/brass/brass-section.svg`).
 *
 * Convention: lowercase everything; replace runs of whitespace with `-`.
 * Other punctuation (including dots) is left as-is. Collisions are
 * rejected by the caller.
 */
export function iconTargetPath(skinPath: string): string {
  const stripped = skinPath.replace(/^images\//, "");
  const normalized = stripped
    .split("/")
    .map(seg => seg.toLowerCase().replace(/\s+/g, "-"))
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

function bakedFilename(inputName: string): string {
  const base = inputName.replace(/\.tgz$/i, "").replace(/\.tar\.gz$/i, "");
  const epoch = Math.floor(Date.now() / 1000);
  return `${base}-baked-${epoch}.tgz`;
}
