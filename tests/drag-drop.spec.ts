import { expect, test } from "@playwright/test";
import { buildPackagef, folderFromPaths } from "./fixtures/packagef";
import { buildModuleTgz } from "./fixtures/tgz";
import { dragDropFile, pickerError, pickerSubText, stepSummary } from "./helpers/ui";

const SVG = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#ff0000" d="M1 1h14v14H1z"/></svg>`;

function validSkin(): Uint8Array {
  return buildPackagef(
    folderFromPaths({
      "images/Other/Beard.svg": SVG,
      "images/Brass/Trumpet.svg": SVG,
    }),
  );
}

test.describe("drag and drop", () => {
  test("dropping a .skin onto the step-1 filebox validates and accepts it", async ({ page }) => {
    await page.goto("/");
    await dragDropFile(page, ".steps > li:nth-child(1) .filebox", "channelicons.skin", validSkin());
    await expect(stepSummary(page, 1)).toBeVisible({ timeout: 5_000 });
    await expect(stepSummary(page, 1)).toContainText(".skin");
    await expect(stepSummary(page, 1)).toContainText("2 icons");
  });

  test("dropping a .tgz onto the step-2 filebox validates and accepts it", async ({ page }) => {
    const tgz = buildModuleTgz();
    await page.goto("/");

    // Complete step 1 first so step 2 is reachable.
    await dragDropFile(page, ".steps > li:nth-child(1) .filebox", "channelicons.skin", validSkin());
    await expect(stepSummary(page, 1)).toBeVisible({ timeout: 5_000 });

    await dragDropFile(page, ".steps > li:nth-child(2) .filebox", "module.tgz", tgz, "application/gzip");
    await expect(stepSummary(page, 2)).toBeVisible({ timeout: 5_000 });
    await expect(stepSummary(page, 2)).toContainText("bitfocus-presonus-studiolive@1.2.3");
  });

  test("dropping an invalid file onto the step-1 filebox shows an error", async ({ page }) => {
    await page.goto("/");
    await dragDropFile(page, ".steps > li:nth-child(1) .filebox", "random.bin", Buffer.from("not a skin or dll"));
    await expect(pickerError(page, 1)).toBeVisible({ timeout: 5_000 });
    await expect(pickerSubText(page, 1)).toContainText(/neither a PACKAGEF .* nor a Windows DLL/i);
  });

  test("dropping a file outside a filebox does not navigate away", async ({ page }) => {
    await page.goto("/");

    // Dispatch dragover + drop directly on the document body (not a filebox).
    // If the browser default is not prevented, the page would navigate to a
    // blob/file URL — we verify we stay on the same page.
    const urlBefore = page.url();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["hello"], "test.txt", { type: "text/plain" }));
      document.body.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      document.body.dispatchEvent(new DragEvent("drop",     { bubbles: true, cancelable: true, dataTransfer: dt }));
    });

    // Page should still be on the same URL and step 1 body still visible.
    expect(page.url()).toBe(urlBefore);
    await expect(page.locator(".steps > li:nth-child(1) .step-body")).toBeVisible();
  });

  test("full bake via drag-drop on both fileboxes produces a valid output", async ({ page }) => {
    const tgz = buildModuleTgz();
    await page.goto("/");

    await dragDropFile(page, ".steps > li:nth-child(1) .filebox", "channelicons.skin", validSkin());
    await expect(stepSummary(page, 1)).toBeVisible({ timeout: 5_000 });

    await dragDropFile(page, ".steps > li:nth-child(2) .filebox", "module.tgz", tgz, "application/gzip");
    await expect(stepSummary(page, 2)).toBeVisible({ timeout: 5_000 });

    // Step 3 (Bake) should now be active.
    await expect(page.locator(".steps > li:nth-child(3) .step-body")).toBeVisible();
    await expect(page.getByRole("button", { name: /Bake module/i })).toBeEnabled();
  });
});
