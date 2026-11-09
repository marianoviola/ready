import { chromium, expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("loads Ready and links a Favorite folder recursively", async () => {
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
    await expect
      .poll(() =>
        page.locator(".brand-mark").evaluate((image: HTMLImageElement) => image.naturalWidth)
      )
      .toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /Save page/ })).toBeVisible();
    await expect(page.getByText("Your library is ready")).toBeVisible();

    await page.evaluate(async () => {
      const folder = await chrome.bookmarks.create({ title: "Ready E2E" });
      const nested = await chrome.bookmarks.create({
        parentId: folder.id,
        title: "Nested"
      });
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: "First test article",
        url: "https://example.com/first"
      });
      await chrome.bookmarks.create({
        parentId: nested.id,
        title: "Second test article",
        url: "https://example.com/second"
      });
    });

    await page.getByRole("button", { name: "Link" }).click();
    await expect(page.getByRole("heading", { name: "Link Favorites" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Link selected" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Select Ready E2E" }).check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByRole("button", { name: "Link selected" }).click();

    await expect(page.getByRole("status")).toContainText("Linked 2 Favorites");
    await expect(page.getByRole("button", { name: "First test article" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Second test article" })).toBeVisible();

    const unreadGroup = page.getByRole("button", { name: /Unread\s*2/ });
    await unreadGroup.click();
    await expect(unreadGroup).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "First test article" })).toBeHidden();
    await unreadGroup.click();
    await expect(unreadGroup).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "First test article" })).toBeVisible();

    await page.getByRole("button", { name: /Sources/ }).click();
    await page.getByRole("button", { name: "Add source" }).click();
    const sourceDialog = page.getByRole("dialog", { name: "Add source" });
    await sourceDialog.getByLabel("Website URL").fill("example.com");
    await sourceDialog.getByLabel(/Name/).fill("Example Weekly");
    await sourceDialog.getByLabel(/Note/).fill("Browse every Friday");
    await sourceDialog.getByLabel("I have a subscription").check();
    await sourceDialog.getByRole("button", { name: "Add source" }).click();

    await expect(page.getByRole("heading", { name: "Example Weekly" })).toBeVisible();
    await expect(page.getByText("Subscribed", { exact: true })).toBeVisible();
    await expect(page.getByText("2 saved articles")).toBeVisible();
    await page.getByRole("button", { name: "View saved" }).click();
    await expect(page.getByRole("button", { name: "First test article" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Second test article" })).toBeVisible();

    await page.getByRole("button", { name: "Link" }).click();
    await page.getByLabel("Show").selectOption("linked");
    await expect(page.getByText("Linked", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Link selected" })).toBeDisabled();
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
