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
pnpm gen-parser   # one-time; needs kaitai-struct-compiler on PATH
pnpm dev
pnpm build
pnpm check
```

The Kaitai spec is `../presonus_packagef.ksy`. Re-run `pnpm gen-parser`
after edits. Install `kaitai-struct-compiler` from <https://kaitai.io/>.

## Notes

- SVG fills are rewritten to the token `#deadbe`; the Companion module
  replaces it with the user's chosen color at runtime.
- Icons land at `package/companion/icons/<lowercased-path>.svg`. Source
  paths that collide after normalization are a hard error.
