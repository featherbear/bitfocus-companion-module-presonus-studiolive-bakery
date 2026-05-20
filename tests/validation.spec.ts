import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { buildPackagef, folderFromPaths } from "./fixtures/packagef";
import { buildModuleTgz, buildTgz } from "./fixtures/tgz";
import { buildSyntheticDll } from "./fixtures/dll";
import {
  pickChannelIcons,
  pickerError,
  pickerSubText,
  pickModuleTgz,
  stepBody,
} from "./helpers/ui";

const SVG = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#0211FF" d="M1 1h14v14H1z"/></svg>`;

function validSkin(): Uint8Array {
  return buildPackagef(
    folderFromPaths({
      "images/Other/Beard.svg": SVG,
      "images/Brass/Trumpet.svg": SVG,
    }),
  );
}

test.describe("channel-icons validation", () => {
  test("non-PACKAGEF, non-MZ file is rejected", async ({ page }) => {
    await page.goto("/");
    await pickChannelIcons(page, "random.bin", Buffer.from("hello world"));
    await expect(pickerError(page, 1)).toBeVisible();
    await expect(pickerSubText(page, 1)).toContainText(
      /neither a PACKAGEF .* nor a Windows DLL/i,
    );
  });

  test(".skin missing the Beard.svg sentinel is rejected", async ({ page }) => {
    const skin = buildPackagef(
      folderFromPaths({
        // Note: no Beard.svg. The sanity check should fire.
        "images/Brass/Trumpet.svg": SVG,
      }),
    );
    await page.goto("/");
    await pickChannelIcons(page, "wrong.skin", skin);
    await expect(pickerError(page, 1)).toBeVisible();
    await expect(pickerSubText(page, 1)).toContainText(/Beard\.svg/);
  });

  test("DLL with wrong InternalName is rejected", async ({ page }) => {
    const dll = buildSyntheticDll({
      internalName: "com.example.someotherdll",
      channelIconsResourceId: "CHANNELICONS.SKIN",
      channelIconsBin: validSkin(),
    });
    await page.goto("/");
    await pickChannelIcons(page, "wrong.dll", dll);
    await expect(pickerError(page, 1)).toBeVisible();
    await expect(pickerSubText(page, 1)).toContainText(/Wrong DLL.*InternalName/);
  });

  test("DLL missing the channelicons RCDATA entry is rejected", async ({ page }) => {
    const dll = buildSyntheticDll({
      // No channelIconsResourceId / channelIconsBin.
    });
    await page.goto("/");
    await pickChannelIcons(page, "no-rcdata.dll", dll);
    await expect(pickerError(page, 1)).toBeVisible();
    await expect(pickerSubText(page, 1)).toContainText(/CHANNELICONS\.SKIN/);
  });
});

test.describe("module .tgz validation", () => {
  test("missing manifest.json", async ({ page }) => {
    const tgz = buildModuleTgz({ omitManifest: true });
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", validSkin());
    await pickModuleTgz(page, "no-manifest.tgz", tgz);
    await expect(pickerError(page, 2)).toBeVisible();
    await expect(pickerSubText(page, 2)).toContainText(/missing pkg\/companion\/manifest\.json/);
  });

  test("wrong manifest id", async ({ page }) => {
    const tgz = buildModuleTgz({ id: "some-other-module" });
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", validSkin());
    await pickModuleTgz(page, "wrong-id.tgz", tgz);
    await expect(pickerError(page, 2)).toBeVisible();
    await expect(pickerSubText(page, 2)).toContainText(/Wrong module.*expected id/);
  });

  test("manifest version is 0.0.0", async ({ page }) => {
    const tgz = buildModuleTgz({ version: "0.0.0" });
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", validSkin());
    await pickModuleTgz(page, "zero-version.tgz", tgz);
    await expect(pickerError(page, 2)).toBeVisible();
    await expect(pickerSubText(page, 2)).toContainText(/version must be a valid semver/);
  });

  test("non-semver version is rejected", async ({ page }) => {
    const tgz = buildModuleTgz({ version: "v1.2" });
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", validSkin());
    await pickModuleTgz(page, "bad-semver.tgz", tgz);
    await expect(pickerError(page, 2)).toBeVisible();
  });

  test("corrupt gzip is rejected gracefully", async ({ page }) => {
    // Random bytes that don't form a valid gzip stream.
    const bogus = Buffer.from([0x1f, 0x8b, 0xff, 0xff, 0xde, 0xad, 0xbe, 0xef]);
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", validSkin());
    await pickModuleTgz(page, "broken.tgz", bogus);
    await expect(pickerError(page, 2)).toBeVisible();
  });

  test("non-gzip payload is rejected", async ({ page }) => {
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", validSkin());
    await pickModuleTgz(page, "not-gzip.tgz", Buffer.from("definitely not gzip"));
    await expect(pickerError(page, 2)).toBeVisible();
  });

  test("manifest is not JSON", async ({ page }) => {
    const tgz = buildTgz([
      { name: "pkg/companion/manifest.json", data: "not json {{{" },
    ]);
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", validSkin());
    await pickModuleTgz(page, "bad-json.tgz", tgz);
    await expect(pickerError(page, 2)).toBeVisible();
    await expect(pickerSubText(page, 2)).toContainText(/Could not parse/);
  });

  test("Bake button is disabled until both steps validate", async ({ page }) => {
    await page.goto("/");
    // Step 1 OK only.
    await pickChannelIcons(page, "channelicons.skin", validSkin());
    // Step 2 fails — should keep us in step 2 with Bake unreachable.
    await pickModuleTgz(page, "broken.tgz", Buffer.from([1, 2, 3]));
    await expect(pickerError(page, 2)).toBeVisible();
    await expect(stepBody(page, 3)).toHaveCount(0);
  });
});

// Suppress unused-import warning for gzipSync — kept available for
// future tests that build PAX-extended or non-conforming archives.
void gzipSync;
