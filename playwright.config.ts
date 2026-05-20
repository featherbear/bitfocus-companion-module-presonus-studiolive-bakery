import { defineConfig, devices } from "@playwright/test";

/**
 * Plays against the production-built bundle (`vite preview`) so tests
 * exercise the same code that ships, including the `base: "./"` /
 * `<base href="./">` plumbing.
 *
 * Single Chromium project for now; the bakery only requires
 * DecompressionStream("gzip"|"deflate") + Svelte 5 runes, both of which
 * are evergreen-browser-only. Add WebKit/Firefox projects if a real
 * cross-browser regression surfaces.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
