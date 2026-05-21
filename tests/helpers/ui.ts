// Page-driving helpers used across the test suite.

import type { Locator, Page } from "@playwright/test";

/**
 * Simulate a file drag-drop onto a CSS selector by dispatching real
 * dragover + drop DragEvents in the browser context.
 *
 * Playwright cannot set DataTransfer.files directly (it's read-only), so we
 * inject the bytes as a base64-encoded string, reconstruct a File inside the
 * page, and attach it to the DataTransfer before dispatching the events.
 */
export async function dragDropFile(
  page: Page,
  selector: string,
  name: string,
  bytes: Uint8Array | Buffer,
  mimeType = "application/octet-stream",
): Promise<void> {
  const base64 = Buffer.isBuffer(bytes)
    ? bytes.toString("base64")
    : Buffer.from(bytes).toString("base64");

  await page.evaluate(
    ({ selector, name, base64, mimeType }) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`dragDropFile: no element matches "${selector}"`);

      // Decode base64 → Uint8Array → File
      const bin = atob(base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const file = new File([arr], name, { type: mimeType });

      const dt = new DataTransfer();
      dt.items.add(file);

      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent("drop",     { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { selector, name, base64, mimeType },
  );
}

/**
 * Set the channel-icons file input via the file picker. Accepts raw
 * bytes + a filename so callers can drive both .skin and .dll cases.
 */
export async function pickChannelIcons(
  page: Page,
  name: string,
  bytes: Uint8Array | Buffer,
): Promise<void> {
  await page.setInputFiles('input[type="file"][accept*=".skin"]', {
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
  });
}

export async function pickModuleTgz(
  page: Page,
  name: string,
  bytes: Uint8Array | Buffer,
): Promise<void> {
  await page.setInputFiles('input[type="file"][accept*=".tgz"]', {
    name,
    mimeType: "application/gzip",
    buffer: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
  });
}

/** True when the step is currently expanded (showing its body). */
export function stepBody(page: Page, n: number): Locator {
  return page.locator(`.steps > li:nth-child(${n}) .step-body`);
}

export function stepSummary(page: Page, n: number): Locator {
  return page.locator(`.steps > li:nth-child(${n}) .step-summary`);
}

export function stepLi(page: Page, n: number): Locator {
  return page.locator(`.steps > li:nth-child(${n})`);
}

/** Locator for the inline error text under a file picker (Step 1 or 2). */
export function pickerError(page: Page, n: 1 | 2): Locator {
  return page.locator(`.steps > li:nth-child(${n}) .filebox-sub .badge.err`);
}

/** Full sub-text under the file picker (badge + message). */
export function pickerSubText(page: Page, n: 1 | 2): Locator {
  return page.locator(`.steps > li:nth-child(${n}) .filebox-sub`);
}

/**
 * Click the Bake button, wait for the download event, and return both
 * the download object and its body as a Buffer.
 */
export async function bakeAndDownload(
  page: Page,
): Promise<{ filename: string; bytes: Buffer }> {
  const dlPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Bake module|Bake again/i }).click();
  const dlLink = page.getByRole("link", { name: /Download .+\.tgz/i });
  await dlLink.waitFor({ state: "visible", timeout: 15_000 });
  await dlLink.click();
  const dl = await dlPromise;
  const path = await dl.path();
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path);
  return { filename: dl.suggestedFilename(), bytes };
}
