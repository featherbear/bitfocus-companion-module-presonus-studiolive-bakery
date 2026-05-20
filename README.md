# bitfocus-companion-module-presonus-studiolive-bakery

In-browser tool that bakes PreSonus channel icons (extracted from your
own copy of `channelicons.skin`) into a Bitfocus Companion module
`.tgz`. Produces a personal copy of the module with the icons embedded
as tokenized SVGs, ready for runtime recoloring/rasterization by the
module itself.

Everything runs client-side. No files leave your machine.

## What it does

1. You pick `channelicons.skin` and a `presonus-studiolive` Companion
   module `.tgz`.
2. The PACKAGEF container is parsed in the browser via the
   Kaitai-generated parser.
3. Each SVG under `images/` is tokenized — every `fill:` declaration
   (in `<style>`, inline `style=`, and `fill=` attributes) is rewritten
   to the placeholder `#deadbe` so the Companion module can search/
   replace it at runtime with the user's chosen color.
4. The module `.tgz` is unpacked (USTAR over native gzip streams), the
   manifest is validated (`shortname === "presonus-studiolive"`,
   semver `> 0.0.0`), tokenized icons are deposited under
   `package/companion/icons/`, and the archive is repacked.
5. You download the baked `.tgz`.

## Why "tokenize" instead of rasterizing?

Earlier prototypes rasterized SVGs to PNG in the browser via
`@resvg/resvg-wasm`. That moved a 2.5MB wasm blob to every user and
locked the icon color in at bake time. Tokenization keeps the icons as
SVG, defers color choice to module configuration, and lets the
Companion module do a trivial `replaceAll("#deadbe", userColor)` at
runtime — no wasm, no rasterizer in the browser.

## Develop

```sh
pnpm install
pnpm gen-parser   # one-time, requires kaitai-struct-compiler on PATH
pnpm dev          # http://localhost:5173
pnpm build
pnpm preview
pnpm check
```

## Regenerating the Kaitai parser

The format spec lives at `../presonus_packagef.ksy`. After edits:

```sh
pnpm gen-parser
```

Requires `kaitai-struct-compiler` (install from <https://kaitai.io/>).

## Naming convention

Source path → target path inside the tarball:

- Strip the leading `images/`.
- Lowercase every path segment.
- Replace runs of whitespace with `-`.
- Leave dots and other punctuation alone.
- Prefix with `package/companion/icons/`.

Example: `images/Brass/Brass Section.svg` →
`package/companion/icons/brass/brass-section.svg`. Two source icons
that normalize to the same target are a hard error.
