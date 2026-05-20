# bitfocus-companion-module-presonus-studiolive-bakery

In-browser tool that bakes PreSonus channel icons into a Bitfocus
Companion module `.tgz`. Everything runs client-side.

## Usage

Pick two files:

1. Your channel-icons source — either `channelicons.skin` (macOS) or
   `studiolivepanel.dll` (Windows, which bundles the skin).
2. A `presonus-studiolive` Companion module `.tgz`.

Click Bake, download the result.

## Develop

```sh
pnpm install
pnpm gen-parser ../presonus_packagef.ksy   # only when the .ksy changes
pnpm dev
pnpm build
pnpm check
```

The Kaitai-generated parser (`src/lib/kaitai/PresonusPackagef.js`) is
committed, so `pnpm gen-parser` is only needed when the `.ksy` spec
changes. The `.ksy` lives in the sibling
[`presonus-packagef-format`](https://github.com/featherbear/presonus-packagef-format)
repo; `pnpm gen-parser` takes the path to it as a positional argument.

## Notes

- SVG fills are rewritten to the token `#deadbe`; the Companion module
  replaces it with the user's chosen color at runtime.
- Icons land at `pkg/companion/icons/studiolive/<lowercased-path>.svg`. Source
  paths that collide after normalization are a hard error.
