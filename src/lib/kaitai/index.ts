// ESM wrapper for the Kaitai-generated UMD parser.
//
// The generated PresonusPackagef.js is a UMD module. Different bundlers
// route it through different branches of the UMD wrapper:
//
//   - Vite dev: serves the file raw as ESM. Neither `define`, `exports`,
//     nor `require` exist, so the UMD takes its **global** branch and
//     reads `self.KaitaiStream` - which must be set first. That's what
//     `./install-global` does; importing it first guarantees the global
//     is populated before the parser IIFE runs.
//   - Vite/Rolldown prod: wraps the parser file with a CommonJS shim, so
//     the UMD takes its **CJS** branch and installs the class on the
//     local `exports` object instead of on `globalThis`.
//
// We read the parser class from whichever location the UMD chose: the
// ES import namespace (prod) or `globalThis` (dev).

import "./install-global";
import KaitaiStream from "kaitai-struct/KaitaiStream.js";
import * as PresonusPackagefMod from "./PresonusPackagef.js";

const fromImport: any = (PresonusPackagefMod as any).PresonusPackagef
  ?? (PresonusPackagefMod as any).default?.PresonusPackagef;
const fromGlobal: any = (globalThis as any).PresonusPackagef?.PresonusPackagef
  ?? (globalThis as any).PresonusPackagef;

const cls = fromImport ?? fromGlobal;
if (!cls) {
  throw new Error("Kaitai-generated PresonusPackagef class not found in module or globalThis");
}

export const PresonusPackagef = cls;
export { KaitaiStream };
