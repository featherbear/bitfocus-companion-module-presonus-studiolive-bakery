import { expect, test } from "@playwright/test";
import { buildPackagef, folderFromPaths } from "./fixtures/packagef";
import { buildModuleTgz } from "./fixtures/tgz";
import {
  pickChannelIcons,
  pickModuleTgz,
  stepBody,
  stepLi,
  stepSummary,
} from "./helpers/ui";

const SVG = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#0211FF" d="M1 1h14v14H1z"/></svg>`;

function skin(): Uint8Array {
  return buildPackagef(
    folderFromPaths({
      "images/Other/Beard.svg": SVG,
      "images/Brass/Trumpet.svg": SVG,
    }),
  );
}

test.describe("stepper UI", () => {
  test("step 1 is active, others locked on first load", async ({ page }) => {
    await page.goto("/");
    await expect(stepLi(page, 1)).toHaveClass(/state-active/);
    await expect(stepLi(page, 2)).toHaveClass(/state-locked/);
    await expect(stepLi(page, 3)).toHaveClass(/state-locked/);
    await expect(stepLi(page, 4)).toHaveClass(/state-locked/);

    // Locked step summary buttons are disabled.
    await expect(stepSummary(page, 2)).toBeDisabled();
    await expect(stepSummary(page, 3)).toBeDisabled();
  });

  test("step 1 done → step 2 active; only one step body visible at a time", async ({ page }) => {
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", skin());
    await expect(stepLi(page, 1)).toHaveClass(/state-done/);
    await expect(stepLi(page, 2)).toHaveClass(/state-active/);
    // Accordion exclusivity: only the active step has a body.
    await expect(page.locator(".step-body")).toHaveCount(1);
  });

  test("step 1 + 2 done → step 3 active with Bake button", async ({ page }) => {
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", skin());
    await pickModuleTgz(page, "module.tgz", buildModuleTgz());
    await expect(stepLi(page, 3)).toHaveClass(/state-active/);
    await expect(stepBody(page, 3).getByRole("button", { name: "Bake module" })).toBeEnabled();
  });

  test("reopening a completed step shows the Done/keep-current pill", async ({ page }) => {
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", skin());
    await pickModuleTgz(page, "module.tgz", buildModuleTgz());

    // Step 3 is now active; click step 1's summary to reopen it.
    await stepSummary(page, 1).click();
    await expect(stepLi(page, 1)).toHaveClass(/state-active/);
    const keep = stepBody(page, 1).getByRole("button", { name: /Done.*keep current file/i });
    await expect(keep).toBeVisible();

    // Clicking it collapses step 1 back to done.
    await keep.click();
    await expect(stepLi(page, 1)).toHaveClass(/state-done/);
    await expect(stepLi(page, 3)).toHaveClass(/state-active/);
  });

  test("fresh file pick clears the manualStep override (no snap-back)", async ({ page }) => {
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", skin());
    await pickModuleTgz(page, "module.tgz", buildModuleTgz());

    // Reopen step 1 manually.
    await stepSummary(page, 1).click();
    await expect(stepLi(page, 1)).toHaveClass(/state-active/);

    // Pick a fresh channel-icons file. The stepper should advance
    // naturally to step 3 again (manualStep cleared by onChannelIconsPicked).
    await pickChannelIcons(page, "channelicons.skin", skin());
    await expect(stepLi(page, 3)).toHaveClass(/state-active/);
  });

  test("platform toggle swaps the hint text", async ({ page }) => {
    await page.goto("/");

    const hint = stepBody(page, 1).locator(".step-hint");
    const initialText = await hint.innerText();
    // The hint always mentions one OS — find the toggle button and click it.
    const toggle = stepBody(page, 1).getByRole("button", { name: /Show .* path instead/i });
    if (await toggle.count() === 0) {
      // "other" platform: no toggle shown. Test is trivially satisfied.
      test.skip();
      return;
    }
    await toggle.click();
    const swapped = await hint.innerText();
    expect(swapped).not.toEqual(initialText);
    // Toggling again should restore something containing the original
    // path. (Either string mentions either DLL or .skin/macOS path.)
    await stepBody(page, 1).getByRole("button", { name: /Show .* path instead/i }).click();
    expect(await hint.innerText()).toEqual(initialText);
  });
});

test.describe("bake step UI", () => {
  test("Bake button shows 'Bake again' after a successful bake", async ({ page }) => {
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", skin());
    await pickModuleTgz(page, "module.tgz", buildModuleTgz());

    const dlPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Bake module" }).click();
    // Step 4 surfaces a download link.
    const dl = page.getByRole("link", { name: /Download .+\.tgz/ });
    await expect(dl).toBeVisible();
    await dl.click();
    await dlPromise;

    // Reopen step 3 — the button should now say "Bake again".
    await stepSummary(page, 3).click();
    await expect(stepBody(page, 3).getByRole("button", { name: "Bake again" })).toBeVisible();
  });

  test("the do-not-redistribute warning is shown in step 4", async ({ page }) => {
    await page.goto("/");
    await pickChannelIcons(page, "channelicons.skin", skin());
    await pickModuleTgz(page, "module.tgz", buildModuleTgz());
    await page.getByRole("button", { name: "Bake module" }).click();

    const warn = stepBody(page, 4).locator(".alert.warn");
    await expect(warn).toBeVisible();
    await expect(warn).toContainText(/Do not redistribute/i);
  });
});
