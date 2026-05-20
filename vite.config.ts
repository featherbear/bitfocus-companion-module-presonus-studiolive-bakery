import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vite.dev/config/
export default defineConfig({
  // Emit relative asset URLs (./assets/...) so the same build works whether
  // the site is hosted at the domain root or under a subpath (e.g. GitHub
  // Pages at https://<user>.github.io/<repo>/). Paired with <base href="./">
  // in index.html to anchor those relative URLs to the document location.
  base: "./",
  plugins: [
    svelte(),
    // KaitaiStream.js has `require('iconv-lite')` and `require('zlib')`
    // calls behind Node-only feature flags that the browser never hits.
    // Stub them out so Rollup/Rolldown can finish bundling.
    {
      name: "stub-kaitai-node-deps",
      enforce: "pre",
      resolveId(source) {
        if (source === "iconv-lite" || source === "zlib") {
          return { id: "\0empty-module", moduleSideEffects: false };
        }
        return null;
      },
      load(id) {
        if (id === "\0empty-module") return "export default {};";
        return null;
      },
    },
  ],
});
