import { expect, test } from "@playwright/test";
import { buildPackagef, folderFromPaths } from "./fixtures/packagef";
import { pickChannelIcons, stepSummary } from "./helpers/ui";

const SVG_A = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#ff0000" d="M1 1h14v14H1z"/></svg>`;
const SVG_B = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle fill="#0000ff" cx="8" cy="8" r="6"/></svg>`;
const SVG_C = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="#00ff00" x="2" y="2" width="12" height="12"/></svg>`;

function richSkin(): Uint8Array {
  return buildPackagef(
    folderFromPaths({
      "images/Other/Beard.svg": SVG_A,
      "images/Brass/Trumpet.svg": SVG_B,
      "images/Brass/Trombone.svg": SVG_C,
      "images/Drums/Kick.svg": SVG_A,
    }),
  );
}

async function loadAndOpenViewer(page: Parameters<typeof pickChannelIcons>[0]) {
  await page.goto("/");
  await pickChannelIcons(page, "channelicons.skin", richSkin());
  // Wait for validation to complete (step 1 summary appears).
  await expect(stepSummary(page, 1)).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Browse" }).first().click();
  await expect(page.locator(".modal")).toBeVisible();
}

test.describe("icon viewer", () => {
  test("'Browse' button appears after a valid skin is loaded", async ({ page }) => {
    await page.goto("/");
    // Should not exist before any file is picked.
    await expect(page.getByRole("button", { name: "Browse", exact: true })).toHaveCount(0);

    await pickChannelIcons(page, "channelicons.skin", richSkin());
    await expect(stepSummary(page, 1)).toBeVisible({ timeout: 5_000 });

    await expect(page.getByRole("button", { name: "Browse", exact: true })).toBeVisible();
  });

  test("modal opens and shows all icons grouped by folder", async ({ page }) => {
    await loadAndOpenViewer(page);

    // All four icons should be rendered.
    await expect(page.locator(".icon-tile")).toHaveCount(4);

    // Groups: Brass, Drums, Other (sorted).
    const groupLabels = page.locator(".icon-group-label");
    await expect(groupLabels).toHaveCount(3);
    await expect(groupLabels.nth(0)).toHaveText("Brass");
    await expect(groupLabels.nth(1)).toHaveText("Drums");
    await expect(groupLabels.nth(2)).toHaveText("Other");
  });

  test("icon names are shown without the .svg extension", async ({ page }) => {
    await loadAndOpenViewer(page);
    await expect(page.locator(".icon-name").filter({ hasText: "Trumpet" })).toBeVisible();
    await expect(page.locator(".icon-name").filter({ hasText: "Trombone" })).toBeVisible();
    // '.svg' suffix should be stripped.
    await expect(page.locator(".icon-name").filter({ hasText: /\.svg/i })).toHaveCount(0);
  });

  test("search filters icons by name", async ({ page }) => {
    await loadAndOpenViewer(page);
    await page.locator(".modal-search").fill("trump");
    await expect(page.locator(".icon-tile")).toHaveCount(1);
    await expect(page.locator(".icon-name")).toHaveText("Trumpet");
  });

  test("search filters icons by group name", async ({ page }) => {
    await loadAndOpenViewer(page);
    await page.locator(".modal-search").fill("brass");
    await expect(page.locator(".icon-tile")).toHaveCount(2);
  });

  test("search with no matches shows empty state", async ({ page }) => {
    await loadAndOpenViewer(page);
    await page.locator(".modal-search").fill("zzznomatch");
    await expect(page.locator(".icon-tile")).toHaveCount(0);
    await expect(page.locator(".modal-empty")).toBeVisible();
  });

  test("footer shows total icon count", async ({ page }) => {
    await loadAndOpenViewer(page);
    await expect(page.locator(".modal-footer")).toContainText("4 icons total");
  });

  test("footer shows match count when searching", async ({ page }) => {
    await loadAndOpenViewer(page);
    await page.locator(".modal-search").fill("brass");
    await expect(page.locator(".modal-footer")).toContainText("4 icons total");
    await expect(page.locator(".modal-footer")).toContainText("2 matches");
  });

  test("close button dismisses the modal", async ({ page }) => {
    await loadAndOpenViewer(page);
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".modal")).toHaveCount(0);
  });

  test("pressing Escape dismisses the modal", async ({ page }) => {
    await loadAndOpenViewer(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".modal")).toHaveCount(0);
  });

  test("clicking the backdrop dismisses the modal", async ({ page }) => {
    await loadAndOpenViewer(page);
    // Click the backdrop area outside the modal card.
    await page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".modal")).toHaveCount(0);
  });

  test("'Browse' is also available in step-1 done summary", async ({ page }) => {
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", richSkin());
    // Wait for step 1 to collapse (move to step 2).
    await expect(stepSummary(page, 1)).toBeVisible({ timeout: 5_000 });
    // The browse button next to the done summary should be visible.
    const browseBtn = page.locator("li:nth-child(1) button", { hasText: "Browse" });
    await expect(browseBtn).toBeVisible();
    await browseBtn.click();
    await expect(page.locator(".modal")).toBeVisible();
  });
});
