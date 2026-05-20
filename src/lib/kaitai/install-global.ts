// Side-effect-only module: publishes KaitaiStream on globalThis.
//
// In Vite dev mode the parser module (PresonusPackagef.js) is served raw,
// and its UMD wrapper falls through to the **global** branch, reading
// `self.KaitaiStream`. KaitaiStream itself is pre-bundled as CJS by Vite,
// so it is only available as an ES default import - never on the global.
// We bridge that gap here.
//
// This file must be imported *before* the parser module so that the
// assignment happens before the UMD IIFE runs. ESM evaluates imports in
// source order; keeping this as a separate module guarantees ordering.

import KaitaiStream from "kaitai-struct/KaitaiStream.js";

(globalThis as any).KaitaiStream = KaitaiStream;
