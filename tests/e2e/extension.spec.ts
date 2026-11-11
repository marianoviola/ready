import { chromium, expect, test, type Dialog } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("links Favorites and manages tags, layouts, bulk actions, and sources", async () => {
  test.setTimeout(60_000);
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
    await expect(page.getByRole("heading", { name: "Ready", exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.locator(".brand-mark").evaluate((image: HTMLImageElement) => image.naturalWidth)
      )
      .toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /Save page/ })).toBeVisible();
    await expect(page.getByText("Your library is ready")).toBeVisible();

    await page.setViewportSize({ width: 320, height: 800 });
    const filterControls = page.locator(".filters select, .filters .check-filter");
    const filterBoxes = await filterControls.evaluateAll((controls) =>
      controls.map((control) => {
        const bounds = control.getBoundingClientRect();
        return { top: bounds.top, height: bounds.height };
      })
    );
    expect(filterBoxes).toHaveLength(3);
    expect(new Set(filterBoxes.map(({ top }) => top)).size).toBe(1);
    expect(new Set(filterBoxes.map(({ height }) => height))).toEqual(new Set([32]));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    ).toBe(true);

    const groupBounds = await page.getByLabel("Group by").boundingBox();
    const sortBounds = await page.getByLabel("Sort by").boundingBox();
    expect(groupBounds?.y).toBe(sortBounds?.y);
    await expect(page.getByLabel("Group by").locator('option[value="tag"]')).toHaveCount(0);

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
    await page.clock.install();
    await page.getByRole("button", { name: "Link selected" }).click();

    await expect(page.getByRole("status")).toContainText("Linked 2 Favorites");
    await page.clock.fastForward(5000);
    await expect(page.getByRole("status")).toBeVisible();
    await page.clock.fastForward(1100);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "First test article" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Second test article" })).toBeVisible();
    await expect(page.locator(".article-tags").getByText("Ready E2E", { exact: true })).toHaveCount(2);
    await expect(page.locator(".article-tags").getByText("Nested", { exact: true })).toHaveCount(1);
    await expect(page.getByLabel("Tag", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Group by").locator('option[value="tag"]')).toHaveCount(1);

    const unreadGroup = page.getByRole("button", { name: /Unread\s*2/ });
    await unreadGroup.click();
    await expect(unreadGroup).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "First test article" })).toBeHidden();
    await unreadGroup.click();
    await expect(unreadGroup).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "First test article" })).toBeVisible();

    const firstArticleCard = page.locator(".article-card").filter({
      has: page.getByRole("button", { name: "First test article" })
    });
    await context.route("https://example.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Test article</title><p>Reading page</p>" })
    );
    const readingPage = await context.newPage();
    await readingPage.goto("https://example.com/first?utm_source=test#reading");
    await readingPage.bringToFront();
    await expect(firstArticleCard.getByText("Current page", { exact: true })).toBeVisible();
    await expect(firstArticleCard).toHaveClass(/current-page/);
    await readingPage.goto("https://example.com/second");
    await expect(firstArticleCard.getByText("Current page", { exact: true })).toHaveCount(0);
    await expect(page.locator(".article-card.current-page")).toContainText("Second test article");
    await readingPage.goto("https://example.com/second?chapter=2");
    await expect(page.locator(".current-page-badge")).toHaveCount(0);
    await readingPage.goto("https://example.com/first");
    await expect(firstArticleCard.getByText("Current page", { exact: true })).toBeVisible();
    await page.bringToFront();
    await expect(page.locator(".current-page-badge")).toHaveCount(0);
    await readingPage.bringToFront();
    await expect(firstArticleCard.getByText("Current page", { exact: true })).toBeVisible();
    const otherWindowId = await page.evaluate(async () => {
      const other = await chrome.windows.create({ url: "about:blank", focused: true });
      if (other?.id === undefined) throw new Error("Test window was not created.");
      return other.id;
    });
    await expect(firstArticleCard.getByText("Current page", { exact: true })).toBeVisible();
    await page.evaluate((id) => chrome.windows.remove(id), otherWindowId);
    await readingPage.goto("about:blank");
    await expect(page.locator(".current-page-badge")).toHaveCount(0);
    await readingPage.goto("https://example.com/first");
    await expect(firstArticleCard.getByText("Current page", { exact: true })).toBeVisible();
    await readingPage.close();
    await page.bringToFront();
    await expect(page.locator(".current-page-badge")).toHaveCount(0);
    await firstArticleCard.getByRole("button", { name: "Edit tags" }).click();
    const tagDialog = page.getByRole("dialog", { name: "Edit tags", exact: true });
    await tagDialog.getByRole("button", { name: "Nested", exact: true }).click();
    await tagDialog.getByRole("button", { name: "Remove tag Nested", exact: true }).click();
    await tagDialog.getByRole("button", { name: "Nested", exact: true }).click();
    await tagDialog.getByLabel("Find or create tag").fill("Manual");
    await tagDialog.getByLabel("Find or create tag").press("Enter");
    await tagDialog.getByRole("button", { name: "Save tags" }).click();
    await expect(firstArticleCard.getByText("Manual", { exact: true })).toBeVisible();
    await firstArticleCard.getByRole("button", { name: "Edit tags" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove tag Manual" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(firstArticleCard.getByText("Manual", { exact: true })).toBeVisible();

    await firstArticleCard.getByRole("button", { name: "Add source" }).click();
    const sourceDialog = page.getByRole("dialog", { name: "Add source" });
    await expect(sourceDialog.getByLabel("Website URL")).toHaveValue("https://example.com");
    await expect(sourceDialog.getByLabel(/Name/)).toHaveValue("example.com");
    await sourceDialog.getByLabel(/Name/).fill("Example Weekly");
    await sourceDialog.getByLabel(/Note/).fill("Browse every Friday");
    await sourceDialog.getByLabel("I have a subscription").check();
    await sourceDialog.getByRole("button", { name: "Add source" }).click();

    await expect(page.getByRole("status")).toContainText("Source added");
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(page.getByRole("status")).toHaveCount(0);
    await firstArticleCard.getByRole("button", { name: "View source" }).click();
    await expect(page.getByRole("heading", { name: "Example Weekly" })).toBeVisible();
    await expect(page.getByText("Subscribed", { exact: true })).toBeVisible();
    await expect(page.getByText("2 saved articles")).toBeVisible();
    const sourceIcon = page.locator(".source-icon img").first();
    await expect(sourceIcon).toHaveAttribute("src", /\/_favicon\/\?pageUrl=/);
    await expect.poll(() => sourceIcon.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await sourceIcon.dispatchEvent("error");
    await expect(page.locator(".source-icon svg")).toHaveCount(1);
    await expect(page.locator(".source-monogram")).toHaveCount(0);

    await page.getByRole("button", { name: "Add source" }).click();
    const manualSourceDialog = page.getByRole("dialog", { name: "Add source" });
    await manualSourceDialog.getByLabel("Website URL").fill("example.org");
    await manualSourceDialog.getByLabel(/Name/).fill("Manual source");
    await manualSourceDialog.getByRole("button", { name: "Add source" }).click();
    await expect(page.getByRole("heading", { name: "Manual source" })).toBeVisible();

    const importedSourceCard = page.locator(".source-card").filter({
      has: page.getByRole("heading", { name: "Example Weekly" })
    });
    await importedSourceCard.getByRole("button", { name: "View saved" }).click();
    await expect(page.getByRole("button", { name: "First test article" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Second test article" })).toBeVisible();

    await page.getByRole("button", { name: "Link" }).click();
    await page.getByLabel("Show").selectOption("linked");
    await expect(page.getByText("Linked", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Link selected" })).toBeDisabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await expect(page.locator(".tag-directory-item")).toHaveCount(3);
    await expect(page.locator(".tag-directory-item").filter({ hasText: "Ready E2E" })).toContainText("2 articles");
    await page.getByLabel("Search tags").fill("Manual");
    await expect(page.locator(".tag-directory-item")).toHaveCount(1);
    await page.locator(".tag-directory-item").click();
    await expect(page.locator(".article-card")).toHaveCount(1);
    await expect(page.getByLabel("Tag", { exact: true })).toHaveValue("Manual");
    await page.getByLabel("Select all visible articles").check();
    await expect(page.getByRole("group", { name: "Bulk actions" })).toContainText("1 selected");
    await page.getByLabel("Tag", { exact: true }).selectOption("");
    await expect(page.getByRole("group", { name: "Bulk actions" })).toContainText("1 selected");
    await page.getByLabel("Select all visible articles").check();
    const bulk = page.getByRole("group", { name: "Bulk actions" });
    await expect(bulk).toContainText("2 selected");
    await bulk.getByRole("button", { name: "Add tags", exact: true }).click();
    const bulkTagDialog = page.getByRole("dialog", { name: "Add tags to selection" });
    await bulkTagDialog.getByLabel("Find or create tag").fill("all");
    await bulkTagDialog.getByRole("button", { name: "Save tags" }).click();
    await expect(page.locator(".article-tags").getByText("all", { exact: true })).toHaveCount(2);
    await expect(firstArticleCard.getByText("Manual", { exact: true })).toBeVisible();
    await expect(page.locator(".article-tags").getByText("Nested", { exact: true })).toHaveCount(2);
    await page.getByLabel("Tag", { exact: true }).selectOption("all");
    await expect(page.locator(".article-card")).toHaveCount(2);
    await bulk.getByLabel("Set selected status").selectOption("read");
    await expect(page.getByRole("status")).toContainText("2 articles updated");
    await expect(bulk).toHaveCount(0);
    await expect(page.getByLabel("Status for First test article")).toHaveValue("read");
    await expect(page.getByLabel("Status for Second test article")).toHaveValue("read");

    await page.getByLabel("Group by").selectOption("tag");
    const originalOrder = await page.locator(".group-heading h2").allTextContents();
    await expect(page.getByRole("button", { name: `Move ${originalOrder[0]} earlier`, exact: true })).toBeDisabled();
    await page.getByRole("button", { name: `Move ${originalOrder[1]} earlier`, exact: true }).click();
    const customOrder = [originalOrder[1], originalOrder[0], ...originalOrder.slice(2)];
    await expect(page.locator(".group-heading h2")).toHaveText(customOrder);
    await page.getByRole("button", { name: "Kanban", exact: true }).click();
    await expect(page.getByRole("button", { name: "Kanban", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: `Move ${customOrder[0]} later`, exact: true }).click();
    await expect(page.locator(".group-heading h2")).toHaveText(originalOrder);
    await page.getByRole("button", { name: `Move ${originalOrder[1]} earlier`, exact: true }).click();
    await expect(page.locator(".group-heading h2")).toHaveText(customOrder);
    const columns = await page.locator(".article-group").evaluateAll((groups) => groups.map((group) => {
      const { x, y } = group.getBoundingClientRect();
      return { x, y };
    }));
    expect(columns.length).toBeGreaterThan(1);
    expect(new Set(columns.map(({ y }) => y)).size).toBe(1);
    expect(columns[1].x).toBeGreaterThan(columns[0].x);
    expect(await page.locator(".article-groups").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const headingAlignment = await page.locator(".group-heading").first().evaluate((element) => {
      const icon = element.querySelector("svg")!.getBoundingClientRect();
      const title = element.querySelector("h2")!.getBoundingClientRect();
      return Math.abs(icon.y + icon.height / 2 - title.y - title.height / 2);
    });
    expect(headingAlignment).toBeLessThan(1);
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.locator(".group-heading h2")).toHaveText(customOrder);
    const rows = await page.locator(".article-group").evaluateAll((groups) => groups.map((group) => group.getBoundingClientRect().y));
    expect(rows[1]).toBeGreaterThan(rows[0]);
    await page.getByLabel("Select all visible articles").check();
    await expect(bulk).toContainText("2 selected");
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(async () => {
      const toolbar = await bulk.boundingBox();
      const navigation = await page.locator(".app-header").boundingBox();
      return toolbar && navigation ? Math.abs(toolbar.y - navigation.y - navigation.height - 6) : Infinity;
    }).toBeLessThan(1);
    await expect(bulk.getByRole("button", { name: "Add tags", exact: true })).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByLabel("Tag", { exact: true }).selectOption("Manual");
    await expect(bulk).toContainText("1 selected");
    await page.getByLabel("Group by").selectOption("status");
    await page.getByLabel("Tag", { exact: true }).selectOption("");
    await page.reload();
    await expect(page.getByLabel("Status for First test article")).toHaveValue("read");
    await expect(page.locator(".article-tags").getByText("all", { exact: true })).toHaveCount(2);
    await expect(page.locator(".article-tags").getByText("Manual", { exact: true })).toHaveCount(1);
    await page.getByLabel("Group by").selectOption("tag");
    await expect(page.locator(".group-heading h2")).toHaveText(customOrder);
    await page.getByLabel("Tag", { exact: true }).selectOption("Manual");
    await expect(page.locator(".group-heading h2")).toHaveText(customOrder);
    await page.getByLabel("Tag", { exact: true }).selectOption("");
    await page.getByLabel("Group by").selectOption("status");
    await page.getByLabel("Select all visible articles").check();
    page.once("dialog", (dialog) => dialog.dismiss());
    await bulk.getByRole("button", { name: "Remove selected" }).click();
    await expect(page.locator(".article-card")).toHaveCount(2);
    const keepFavorites = (dialog: Dialog) => dialog.message().startsWith("Also delete")
      ? dialog.dismiss()
      : dialog.accept();
    page.on("dialog", keepFavorites);
    await bulk.getByRole("button", { name: "Remove selected" }).click();
    await expect(page.getByRole("status")).toContainText("2 articles removed");
    page.off("dialog", keepFavorites);
    await expect(page.locator(".article-card")).toHaveCount(0);
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ url: "https://example.com/first" })).length)).toBe(1);
    await page.reload();
    await expect(page.getByText("Your library is ready")).toBeVisible();
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await expect(page.getByText("No tags yet", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Library/ }).click();
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Ready E2E" }).check();
    await page.getByRole("button", { name: "Link selected" }).click();
    await page.getByLabel("Select all visible articles").check();
    const deleteFavorites = (dialog: Dialog) => dialog.accept();
    page.on("dialog", deleteFavorites);
    await bulk.getByRole("button", { name: "Remove selected" }).click();
    await expect(page.getByRole("status")).toContainText("2 articles removed");
    page.off("dialog", deleteFavorites);
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ url: "https://example.com/first" })).length)).toBe(0);
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ url: "https://example.com/second" })).length)).toBe(0);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Bookmark destination" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Backup & restore" })).toBeVisible();
    await expect(page.locator(".destination-path")).toHaveText("Ready (created on first save)");
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ title: "Ready" })).length)).toBe(0);
    const destinationPage = await context.newPage();
    async function saveAt(url: string) {
      await destinationPage.goto(url);
      await destinationPage.bringToFront();
      return page.evaluate(() => chrome.runtime.sendMessage({ type: "SAVE_ACTIVE_PAGE" }));
    }
    const defaultSave = await saveAt("https://example.com/default-save");
    expect(defaultSave.ok).toBe(true);
    const readyFolderId = await page.evaluate(async () => {
      const settings = await chrome.storage.local.get("readyFolderId");
      return String(settings.readyFolderId);
    });
    expect(await page.evaluate(async (id) => {
      const [bookmark] = await chrome.bookmarks.search({ url: "https://example.com/default-save" });
      return bookmark.parentId === id;
    }, readyFolderId)).toBe(true);
    expect(defaultSave.article.tags).toEqual([]);
    await page.getByRole("button", { name: "Choose folder", exact: true }).click();
    await page.getByRole("radio", { name: "Select Nested", exact: true }).check();
    await page.getByRole("button", { name: "Use folder", exact: true }).click();
    await expect(page.locator(".destination-path")).toContainText("Ready E2E / Nested");
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator(".destination-path")).toContainText("Ready E2E / Nested");
    const customSave = await saveAt("https://example.com/custom-save");
    expect(customSave.ok).toBe(true);
    expect(customSave.article.tags).toEqual(["Ready E2E", "Nested"]);
    expect((await saveAt("https://example.com/default-save")).createdBookmark).toBe(false);
    expect(await page.evaluate(async () => {
      const [bookmark] = await chrome.bookmarks.search({ url: "https://example.com/default-save" });
      const settings = await chrome.storage.local.get("readyFolderId");
      return bookmark.parentId === settings.readyFolderId;
    })).toBe(true);
    await page.evaluate(async () => {
      const settings = await chrome.storage.local.get("bookmarkFolderId");
      await chrome.bookmarks.removeTree(String(settings.bookmarkFolderId));
    });
    const missingDestination = await saveAt("https://example.com/missing-destination");
    expect(missingDestination.ok).toBe(false);
    expect(missingDestination.error).toContain("no longer exists");
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ url: "https://example.com/missing-destination" })).length)).toBe(0);
    await page.getByRole("button", { name: "Use Ready folder", exact: true }).click();
    await expect(page.locator(".destination-path")).toContainText("Ready");
    expect((await saveAt("https://example.com/reset-save")).ok).toBe(true);
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ title: "Ready" })).length)).toBe(1);
    await destinationPage.close();
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
