// Validation of the user-supplied Companion module tarball.

import type { TarFile } from "./tgz";

/** Path within the tarball where Companion modules declare themselves. */
export const MANIFEST_PATH = "pkg/companion/manifest.json";

/** Required `id` value. Anything else means the user uploaded the wrong module. */
export const REQUIRED_ID = "bitfocus-presonus-studiolive";

export interface Manifest {
  id: string;
  version: string;
}

/**
 * Find and validate the module manifest in the unpacked tarball. Throws
 * with a user-actionable message if the tarball isn't the expected
 * module or has a placeholder version.
 */
export function validateManifest(files: TarFile[]): Manifest {
  const entry = files.find(f => f.name === MANIFEST_PATH);
  if (!entry) {
    throw new Error(
      `Tarball is missing ${MANIFEST_PATH}. ` +
      `Make sure you uploaded a Companion module .tgz, not something else.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8").decode(entry.data));
  } catch (err) {
    throw new Error(`Could not parse ${MANIFEST_PATH}: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${MANIFEST_PATH} is not a JSON object.`);
  }
  const m = parsed as Record<string, unknown>;

  if (m.id !== REQUIRED_ID) {
    throw new Error(
      `Wrong module: expected id "${REQUIRED_ID}", ` +
      `got "${String(m.id)}".`,
    );
  }

  if (typeof m.version !== "string" || !isSemverGreaterThanZero(m.version)) {
    throw new Error(
      `Module version must be a valid semver greater than 0.0.0; ` +
      `got "${String(m.version)}".`,
    );
  }

  return { id: m.id, version: m.version };
}

/**
 * Check that `version` is a valid semver and strictly greater than
 * `0.0.0`. Accepts pre-release versions like `1.2.3-alpha.1`.
 *
 * We compare component-by-component rather than via a third-party
 * package to keep dependencies minimal — the only comparison we ever
 * need is "greater than 0.0.0", which boils down to "any of major,
 * minor, patch is non-zero (or there is a pre-release tag on a 0.0.0
 * core, which counts as <0.0.0 so that's a no)".
 */
export function isSemverGreaterThanZero(version: string): boolean {
  // Match: <major>.<minor>.<patch>(-prerelease)?(+build)?
  // Major/minor/patch must be non-negative integers without leading zeros
  // (except the literal "0"), per the semver spec.
  const re = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  const m = re.exec(version);
  if (!m) return false;
  const [, maj, min, pat] = m;
  // 0.0.0 (with or without a prerelease tag) is not "greater than 0.0.0".
  // 0.0.0-alpha < 0.0.0 per semver, so still not greater. Anything else qualifies.
  return !(maj === "0" && min === "0" && pat === "0");
}
