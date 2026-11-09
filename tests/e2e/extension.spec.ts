import { chromium, expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("loads the built Ready sidebar in a Chromium extension context", async () => {
  const extensionPath = path.resolve("dist");
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "ready-playwright-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const page = await context.newPage();
    const extensionId = unpackedExtensionId(extensionPath);
    await page.goto(`chrome-extension://${extensionId}/sidebar.html`);
    await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Save page/ })).toBeVisible();
    await expect(page.getByText("Your library is ready")).toBeVisible();
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

function unpackedExtensionId(extensionPath: string): string {
  const digest = createHash("sha256").update(extensionPath).digest("hex").slice(0, 32);
  return [...digest]
    .map((character) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(character, 16)))
    .join("");
}
