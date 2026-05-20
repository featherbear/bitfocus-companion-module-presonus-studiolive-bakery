import { expect, test } from "@playwright/test";
import { buildPackagef, folderFromPaths } from "./fixtures/packagef";
import { buildModuleTgz } from "./fixtures/tgz";
import { buildSyntheticDll } from "./fixtures/dll";
import { unpackTgz } from "./fixtures/unpack";
import {
  bakeAndDownload,
  pickChannelIcons,
  pickModuleTgz,
  stepBody,
  stepSummary,
} from "./helpers/ui";

/**
 * Three source icons; one has whitespace in its name (exercises the
 * lowercase+strip-whitespace target-path normalization) and one uses
 * #0211FF in a couple of fill styles (exercises tokenization).
 */
const SVG_PLAIN = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#0211FF" d="M1 1h14v14H1z"/></svg>`;
const SVG_WITH_STYLE = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><style>.a { fill: #0211FF; }</style><path class="a" d="M1 1h14v14H1z"/></svg>`;
const SVG_WITH_INLINE = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path style="fill: #0211FF" d="M0 0h16v16H0z"/></svg>`;

function fixtureSkin(): Uint8Array {
  return buildPackagef(
    folderFromPaths({
      "images/Other/Beard.svg": SVG_PLAIN,
      "images/Brass/Brass Section.svg": SVG_WITH_STYLE,
      "images/Drums/Kick (Inside).svg": SVG_WITH_INLINE,
    }),
  );
}

test.describe("happy path", () => {
  test("bake a .skin into a tgz and inspect the output archive", async ({ page }) => {
    const skin = fixtureSkin();
    const tgz = buildModuleTgz();

    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", skin);
    // Step 1 transitions to a collapsed summary on success, or stays
    // active with an "Error" badge on failure. Wait for either.
    await Promise.race([
      page.locator(".steps > li:nth-child(1) .step-summary").waitFor(),
      page.locator(".steps > li:nth-child(1) .badge.err").waitFor(),
    ]);
    const errBadge1 = page.locator(".steps > li:nth-child(1) .badge.err");
    if (await errBadge1.count() > 0) {
      const msg = await page.locator(".steps > li:nth-child(1) .filebox-sub").innerText();
      throw new Error(`Channel-icons validation failed: ${msg}`);
    }
    await expect(stepSummary(page, 1)).toContainText(".skin");
    await expect(stepSummary(page, 1)).toContainText("3 icons");

    await pickModuleTgz(page, "module.tgz", tgz);
    await expect(stepSummary(page, 2)).toContainText("bitfocus-presonus-studiolive@1.2.3");

    const { filename, bytes } = await bakeAndDownload(page);

    // Filename: <input-base>-baked-<epoch>.tgz
    expect(filename).toMatch(/^module-baked-\d+\.tgz$/);
    const epoch = Number(filename.match(/-baked-(\d+)\.tgz$/)![1]);
    expect(epoch).toBeGreaterThan(1_700_000_000);

    const entries = unpackTgz(Buffer.from(bytes));
    const byName = new Map(entries.map(e => [e.name, e]));

    // Pre-existing entries pass through.
    expect(byName.has("pkg/companion/manifest.json")).toBe(true);
    expect(byName.has("pkg/main.js")).toBe(true);
    expect(byName.has("pkg/package.json")).toBe(true);

    // Icons land at the expected normalized paths (lowercase, no whitespace).
    expect(byName.has("pkg/companion/icons/studiolive/other/beard.svg")).toBe(true);
    expect(byName.has("pkg/companion/icons/studiolive/brass/brasssection.svg")).toBe(true);
    expect(byName.has("pkg/companion/icons/studiolive/drums/kick(inside).svg")).toBe(true);

    // Every icon has been tokenized: contains #deadbe, never #0211FF.
    for (const e of entries) {
      if (!e.name.startsWith("pkg/companion/icons/studiolive/")) continue;
      const text = e.data.toString("utf8");
      expect(text).toContain("#deadbe");
      expect(text.toLowerCase()).not.toContain("#0211ff");
    }

    // BAKED.txt notice.
    const notice = byName.get("pkg/BAKED.txt");
    expect(notice).toBeDefined();
    const txt = notice!.data.toString("utf8");
    expect(txt).toContain("DO NOT REDISTRIBUTE");
    expect(txt).toContain("bitfocus-presonus-studiolive@1.2.3");
    expect(txt).toContain(`unix epoch ${epoch}`);
    expect(txt).toContain("Icons embedded:     3");
    expect(txt).toContain("raw channelicons.skin");
  });

  test("bake a DLL-extracted skin into a tgz", async ({ page }) => {
    const skin = fixtureSkin();
    const dll = buildSyntheticDll({
      channelIconsResourceId: "CHANNELICONS.SKIN",
      channelIconsBin: skin,
    });
    const tgz = buildModuleTgz();

    await page.goto("/");
    await pickChannelIcons(page, "studiolivepanel.dll", dll);
    await expect(stepSummary(page, 1)).toContainText("DLL");
    await expect(stepSummary(page, 1)).toContainText("3 icons");

    await pickModuleTgz(page, "module.tgz", tgz);
    const { bytes } = await bakeAndDownload(page);

    const entries = unpackTgz(Buffer.from(bytes));
    const notice = entries.find(e => e.name === "pkg/BAKED.txt");
    expect(notice).toBeDefined();
    expect(notice!.data.toString("utf8")).toContain(
      "Windows DLL (channelicons.skin extracted from RCDATA)",
    );
    // Spot-check one tokenized icon.
    const beard = entries.find(
      e => e.name === "pkg/companion/icons/studiolive/other/beard.svg",
    );
    expect(beard).toBeDefined();
    expect(beard!.data.toString("utf8")).toContain("#deadbe");
  });

  // Sanity guard: step 1 panel should be the active one on first load.
  test("first load opens step 1", async ({ page }) => {
    await page.goto("/");
    await expect(stepBody(page, 1)).toBeVisible();
    await expect(stepBody(page, 2)).toHaveCount(0);
    await expect(stepBody(page, 3)).toHaveCount(0);
  });
});
