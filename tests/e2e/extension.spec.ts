import { chromium, expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function installClassicScrollbars() {
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "html { overflow-y: scroll; } html::-webkit-scrollbar { width: 15px; height: 15px; }";
    document.head.append(style);
  });
}

test("links Favorites and manages tags, layouts, bulk actions, and sources", async () => {
  test.setTimeout(60_000);
  const extensionPath = path.resolve("dist");
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "ready-playwright-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.READY_E2E_CHANNEL,
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    await context.addInitScript(installClassicScrollbars);
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
    const chevrons = await page.locator(".select-field, .compact-select-field").evaluateAll((fields) =>
      fields.map((field) => ({
        inset: Number.parseFloat(getComputedStyle(field, "::after").right),
        padding: Number.parseFloat(getComputedStyle(field.querySelector("select")!).paddingRight)
      })));
    expect(chevrons.length).toBeGreaterThan(0);
    for (const chevron of chevrons) {
      expect(chevron.inset).toBeGreaterThanOrEqual(12);
      expect(chevron.padding).toBeGreaterThanOrEqual(32);
    }
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
    await expect(page.locator(".app-header").getByRole("status")).toContainText("Linked 2 Favorites");
    await page.clock.fastForward(5000);
    await expect(page.getByRole("status")).toBeVisible();
    await page.clock.fastForward(1100);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "First test article", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Second test article", exact: true })).toBeVisible();
    await expect(page.locator(".article-tags").getByText("Ready E2E", { exact: true })).toHaveCount(2);
    await expect(page.locator(".article-tags").getByText("Nested", { exact: true })).toHaveCount(1);
    await expect(page.getByLabel("Tag", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Group by").locator('option[value="tag"]')).toHaveCount(1);

    const unreadGroup = page.getByRole("button", { name: /Unread\s*2/ });
    await unreadGroup.click();
    await expect(unreadGroup).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "First test article", exact: true })).toBeHidden();
    await unreadGroup.click();
    await expect(unreadGroup).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "First test article", exact: true })).toBeVisible();

    const firstArticleCard = page.locator(".article-card").filter({
      has: page.getByRole("button", { name: "First test article", exact: true })
    });
    const searchIcon = page.locator(".search-box .search-icon");
    await expect(searchIcon).toHaveAttribute("aria-hidden", "true");
    expect(await searchIcon.boundingBox()).toMatchObject({ width: 16, height: 16 });
    for (const colorScheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme });
      const title = firstArticleCard.getByRole("button", { name: "First test article", exact: true });
      await title.hover();
      const textColors = await firstArticleCard.evaluate((card) => {
        const luminance = (color: string) => {
          const channels = color.match(/[\d.]+/g)!.slice(0, 3).map((value) => {
            const channel = Number(value) / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        return Array.from(card.querySelectorAll(".article-title, .card-actions > .button")).map((element) => {
          const styles = getComputedStyle(element);
          const background = luminance(styles.backgroundColor === "rgba(0, 0, 0, 0)"
            ? getComputedStyle(card).backgroundColor : styles.backgroundColor);
          const foreground = luminance(styles.color);
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
      });
      expect(textColors.length).toBeGreaterThan(1);
      for (const contrast of textColors) expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
    await context.route("https://example.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Test article</title><p>Reading page</p>" })
    );
    const readingPage = await context.newPage();
    await readingPage.goto("https://example.com/first?utm_source=test#reading");
    await readingPage.bringToFront();
    await expect(firstArticleCard.getByText("Current page", { exact: true })).toBeVisible();
    await expect(firstArticleCard).toHaveClass(/current-page/);
    await expect(page.getByRole("button", { name: /Page saved/ })).toBeDisabled();
    await readingPage.goto("https://example.com/second");
    await expect(firstArticleCard.getByText("Current page", { exact: true })).toHaveCount(0);
    await expect(page.locator(".article-card.current-page")).toContainText("Second test article");
    await readingPage.goto("https://example.com/second?chapter=2");
    await expect(page.locator(".current-page-badge")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Save page/ })).toBeEnabled();
    await readingPage.goto("https://example.com/first");
    await expect(firstArticleCard.getByText("Current page", { exact: true })).toBeVisible();
    await page.bringToFront();
    await expect(page.locator(".current-page-badge")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Save page/ })).toBeDisabled();
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
    await expect(page.getByRole("main", { name: "Articles", exact: true })).toBeVisible();
    await expect(page.locator("main > .section-heading")).toHaveCount(0);
    const articleActions = firstArticleCard.getByRole("button", { name: /^Actions for article/ });
    await articleActions.focus();
    await page.keyboard.press("ArrowDown");
    await expect(firstArticleCard.getByRole("menuitem", { name: "Edit tags" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(firstArticleCard.getByRole("menuitem", { name: "Remove", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(firstArticleCard.getByRole("menuitem", { name: "Edit tags" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(firstArticleCard.getByRole("menu")).not.toBeVisible();
    await expect(articleActions).toBeFocused();
    await articleActions.click();
    await firstArticleCard.getByRole("menuitem", { name: "Edit tags" }).click();
    const tagDialog = page.getByRole("dialog", { name: "Edit tags", exact: true });
    await tagDialog.getByRole("button", { name: "Nested", exact: true }).click();
    await tagDialog.getByRole("button", { name: "Remove tag Nested", exact: true }).click();
    await tagDialog.getByRole("button", { name: "Nested", exact: true }).click();
    await tagDialog.getByLabel("Find or create tag").fill("Manual");
    await tagDialog.getByLabel("Find or create tag").press("Enter");
    await tagDialog.getByRole("button", { name: "Save tags" }).click();
    await expect(firstArticleCard.getByText("Manual", { exact: true })).toBeVisible();
    await articleActions.click();
    await firstArticleCard.getByRole("menuitem", { name: "Edit tags" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove tag Manual" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(firstArticleCard.getByText("Manual", { exact: true })).toBeVisible();

    await articleActions.click();
    await firstArticleCard.getByRole("menuitem", { name: "Add source" }).click();
    const sourceDialog = page.getByRole("dialog", { name: "Add source" });
    await expect(sourceDialog.getByLabel("Website URL")).toHaveValue("https://example.com");
    await expect(sourceDialog.getByLabel(/Name/)).toHaveValue("example.com");
    await sourceDialog.getByLabel(/Name/).fill("Example Weekly");
    await sourceDialog.getByLabel(/Note/).fill("Browse every Friday");
    await sourceDialog.getByLabel("I have a subscription").check();
    await expect(sourceDialog.getByLabel("Selected tags").getByRole("button")).toHaveCount(0);
    await sourceDialog.getByRole("button", { name: "Manual", exact: true }).click();
    await sourceDialog.getByLabel("Find or create tag").fill("Publications");
    await sourceDialog.getByRole("button", { name: "Add source" }).click();

    await expect(page.getByRole("status")).toContainText("Source added");
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await expect(page.getByRole("status")).toHaveCount(0);
    await articleActions.click();
    await firstArticleCard.getByRole("menuitem", { name: "View source" }).click();
    await expect(page.getByRole("main", { name: "Sources", exact: true })).toBeVisible();
    await expect(page.locator("main > .section-heading")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Example Weekly" })).toBeVisible();
    await expect(page.locator(".subscription-badge")).toHaveText("Subscribed");
    await expect(page.locator(".source-card .article-tags")).toHaveText("ManualPublications");
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

    await page.getByLabel("Search sources").fill("publications");
    await expect(page.locator(".source-card")).toHaveCount(1);
    await page.getByLabel("Subscription", { exact: true }).selectOption("not-subscribed");
    await expect(page.getByRole("heading", { name: "No sources match" })).toBeVisible();
    await page.getByLabel("Search sources").fill("");
    await expect(page.locator(".source-card")).toHaveCount(1);
    await page.getByLabel("Subscription", { exact: true }).selectOption("all");
    await page.getByLabel("Source tag").selectOption("Manual");
    await expect(page.locator(".source-card")).toHaveCount(1);
    await page.getByLabel("Source tag").selectOption("");
    await page.getByLabel("Sort by").selectOption("name");
    await expect(page.locator(".source-card h3")).toHaveText(["Example Weekly", "Manual source"]);
    await page.getByLabel("Sort by").selectOption("articles");
    await expect(page.locator(".source-card h3")).toHaveText(["Example Weekly", "Manual source"]);
    await page.getByLabel("Group by").selectOption("tag");
    await expect(page.locator(".group-heading h2")).toHaveText(["Manual", "Publications", "Untagged"]);
    await expect(page.locator(".source-card")).toHaveCount(3);
    await page.getByRole("button", { name: "Untagged 1", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Manual source" })).toHaveCount(0);
    await page.getByRole("button", { name: "Untagged 1", exact: true }).click();
    await page.getByRole("button", { name: "Kanban", exact: true }).click();
    const sourceColumns = await page.locator(".article-group").evaluateAll((groups) => groups.map((group) => {
      const { x, y } = group.getBoundingClientRect();
      return { x, y };
    }));
    expect(new Set(sourceColumns.map(({ y }) => y)).size).toBe(1);
    expect(sourceColumns[1].x).toBeGreaterThan(sourceColumns[0].x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const kanbanSource = page.locator(".source-card").first();
    await kanbanSource.getByRole("button", { name: /^Actions for source/ }).click();
    await expect(kanbanSource.getByRole("menuitem", { name: "View saved" })).toBeVisible();
    const menuBounds = await kanbanSource.getByRole("menu").boundingBox();
    expect(menuBounds).not.toBeNull();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(12);
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(308);
    expect(menuBounds!.y).toBeGreaterThanOrEqual(12);
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(788);
    await page.getByLabel("Search sources").click();
    await expect(kanbanSource.getByRole("menu")).not.toBeVisible();
    await page.getByRole("button", { name: "Move Publications earlier", exact: true }).click();
    await expect(page.locator(".group-heading h2")).toHaveText(["Publications", "Manual", "Untagged"]);
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByLabel("Group by").selectOption("subscription");
    await expect(page.locator(".group-heading h2")).toHaveText(["Not subscribed", "Subscribed"]);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const sourceStyles = await page.locator(".source-card .article-tags span").first().evaluate((chip) => {
        const style = getComputedStyle(chip);
        return { color: style.color, background: style.backgroundColor };
      });
      expect(sourceStyles).toEqual(scheme === "dark"
        ? { color: "rgb(198, 195, 255)", background: "rgb(59, 57, 91)" }
        : { color: "rgb(81, 77, 159)", background: "rgb(238, 237, 251)" });
      const card = page.locator(".source-card").first();
      await card.getByRole("button", { name: /^Actions for source/ }).click();
      const menu = card.getByRole("menu");
      await expect(menu).toBeVisible();
      expect(await menu.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(scheme === "dark" ? "rgb(43, 43, 48)" : "rgb(255, 255, 255)");
      expect(await menu.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.keyboard.press("Escape");
      const clippedOptions = await page.locator(".organize-row select, .source-filters select").evaluateAll((selects) =>
        selects.flatMap((element) => {
          const select = element as HTMLSelectElement;
          const style = getComputedStyle(select);
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d")!;
          const available = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return [...select.options].filter((option) => [style.fontFamily, "Arial, sans-serif"].some((family) => {
            context.font = `${style.fontWeight} ${style.fontSize} ${family}`;
            return context.measureText(option.text).width > available;
          }))
            .map((option) => option.text);
        }));
      expect(clippedOptions).toEqual([]);
    }
    await page.getByLabel("Group by").selectOption("none");
    const manualSource = page.locator(".source-card").filter({ hasText: "Manual source" });
    const manualActions = manualSource.getByRole("button", { name: /^Actions for source/ });
    await manualActions.focus();
    await page.keyboard.press("ArrowUp");
    await expect(manualSource.getByRole("menuitem", { name: "Remove", exact: true })).toBeFocused();
    await expect(manualSource.getByRole("menuitem", { name: "View saved" })).toBeDisabled();
    await page.keyboard.press("Home");
    await expect(manualSource.getByRole("menuitem", { name: "Edit", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(manualSource.getByRole("menu")).not.toBeVisible();
    await manualActions.click();
    await manualSource.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const editSourceDialog = page.getByRole("dialog", { name: "Edit source" });
    await editSourceDialog.getByRole("button", { name: "Publications", exact: true }).click();
    await editSourceDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".source-card").filter({ hasText: "Manual source" }).locator(".article-tags")).toHaveText("Publications");
    await page.reload();
    await page.getByRole("button", { name: /^Sources/ }).click();
    await page.getByLabel("Group by").selectOption("tag");
    await expect(page.locator(".group-heading h2")).toHaveText(["Publications", "Manual"]);
    await page.getByLabel("Group by").selectOption("none");
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    const sourceOnlyTag = page.locator(".tag-directory-item").filter({ hasText: "Publications" });
    await expect(sourceOnlyTag.getByRole("button", { name: "View articles tagged Publications", exact: true })).toHaveCount(0);
    await expect(sourceOnlyTag).toContainText("2 sources");
    await sourceOnlyTag.getByRole("button", { name: "View sources tagged Publications", exact: true }).click();
    await expect(page.getByLabel("Source tag")).toHaveValue("Publications");
    await expect(page.locator(".source-card")).toHaveCount(2);
    await page.getByLabel("Source tag").selectOption("");

    const importedSourceCard = page.locator(".source-card").filter({
      has: page.getByRole("heading", { name: "Example Weekly" })
    });
    await importedSourceCard.getByRole("button", { name: /^Actions for source/ }).click();
    await importedSourceCard.getByRole("menuitem", { name: "View saved" }).click();
    await expect(page.getByRole("button", { name: "First test article", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Second test article", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Link" }).click();
    await page.getByLabel("Show").selectOption("linked");
    await expect(page.getByText("Linked", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Link selected" })).toBeDisabled();
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await expect(page.locator(".tag-directory-item")).toHaveCount(3);
    await expect(page.locator(".tag-directory-item").filter({ hasText: "Ready E2E" })).toContainText("2 articles");
    for (const colorScheme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.getByRole("button", { name: "Tags", exact: true }).click();
      await page.keyboard.press("Tab");
      const sourcesTab = page.getByRole("button", { name: "Discover", exact: true });
      await expect(sourcesTab).toBeFocused();
      await expect(sourcesTab).toHaveCSS("outline-style", "solid");
      await expect(sourcesTab).toHaveCSS("outline-width", "2px");
      await expect(sourcesTab).toHaveCSS("outline-offset", "-4px");
      await expect(sourcesTab).toHaveCSS("outline-color", colorScheme === "dark" ? "rgb(164, 168, 255)" : "rgb(91, 95, 199)");
      const tagCount = page.locator(".tag-directory-item .count").first();
      await expect(tagCount).toHaveCSS("background-color", colorScheme === "dark" ? "rgb(61, 63, 101)" : "rgb(231, 229, 250)");
      await expect(tagCount).toHaveCSS("color", colorScheme === "dark" ? "rgb(211, 213, 255)" : "rgb(36, 36, 36)");
    }
    await page.getByLabel("Search tags").fill("Manual");
    await expect(page.getByLabel("Search tags")).toHaveCSS("outline-style", "none");
    await expect(page.locator(".tag-directory-item")).toHaveCount(1);
    await page.getByRole("button", { name: "View articles tagged Manual", exact: true }).click();
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
    expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(305);
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
    await page.getByLabel("Website", { exact: true }).selectOption("example.com");
    await page.getByLabel("Select all visible articles").check();
    await bulk.getByRole("button", { name: "Remove selected" }).click();
    const removalDialog = page.getByRole("dialog", { name: "Remove from Ready?" });
    for (const width of [320, 800]) {
      await page.setViewportSize({ width, height: 800 });
      const bounds = await removalDialog.boundingBox();
      expect(bounds!.width).toBeLessThanOrEqual(440);
      expect(bounds!.width).toBeLessThan(width - 24);
      expect(bounds!.height).toBeLessThan(500);
      const option = await removalDialog.locator(".remove-bookmarks-option").boundingBox();
      const actions = await removalDialog.locator(".modal-actions").boundingBox();
      expect(actions!.y - (option!.y + option!.height)).toBeGreaterThanOrEqual(16);
      await expect(removalDialog.getByRole("button", { name: "Remove from Ready", exact: true })).toBeInViewport();
      await page.screenshot({ path: test.info().outputPath(`removal-${width}.png`) });
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await expect(removalDialog.getByRole("checkbox")).not.toBeChecked();
    await removalDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(".article-card")).toHaveCount(2);
    await bulk.getByRole("button", { name: "Remove selected" }).click();
    await removalDialog.getByRole("button", { name: "Remove from Ready", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("2 articles removed");
    await expect(page.locator(".article-card")).toHaveCount(0);
    await expect(page.getByLabel("Website", { exact: true })).toHaveValue("all");
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ url: "https://example.com/first" })).length)).toBe(1);
    await page.reload();
    await expect(page.getByText("Your library is ready")).toBeVisible();
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await expect(page.locator(".tag-directory-item")).toHaveCount(0);
    await page.getByRole("button", { name: /^Sources/ }).click();
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await expect(page.locator(".tag-directory-item")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "View sources tagged Manual", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: /^Library/ }).click();
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Ready E2E" }).check();
    await page.getByRole("button", { name: "Link selected" }).click();
    await page.getByLabel("Select all visible articles").check();
    await bulk.getByRole("button", { name: "Remove selected" }).click();
    await removalDialog.getByRole("checkbox").check();
    await removalDialog.getByRole("button", { name: "Remove from Ready", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("2 articles removed");
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ url: "https://example.com/first" })).length)).toBe(0);
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ url: "https://example.com/second" })).length)).toBe(0);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Bookmark destination" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Backup & restore" })).toBeVisible();
    const versionName = await page.evaluate(() => chrome.runtime.getManifest().version_name);
    await expect(page.getByRole("heading", { name: `Ready ${versionName}`, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy", exact: true })).toHaveAttribute("href", "https://marianoviola.com/privacy/#ready");
    await expect(page.getByRole("link", { name: "Contact & support", exact: true })).toHaveAttribute("href", "https://marianoviola.com/contact/");
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

test("moves Favorites, discovers local sources, and preserves statistics through optional cleanup and backup", async () => {
  const extensionPath = path.resolve("dist");
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "ready-history-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.READY_E2E_CHANNEL,
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  try {
    await context.addInitScript(installClassicScrollbars);
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`chrome-extension://${unpackedExtensionId(extensionPath)}/sidebar.html`);
    const favorites = await page.evaluate(async () => {
      const reading = await chrome.bookmarks.create({ title: "Reading" });
      const archive = await chrome.bookmarks.create({ title: "Archive" });
      const first = await chrome.bookmarks.create({ parentId: reading.id, title: "First", url: "https://example.com/first" });
      const second = await chrome.bookmarks.create({ parentId: reading.id, title: "Second", url: "https://example.com/second" });
      return { reading, archive, first, second };
    });
    const timestamp = Date.now() - 60_000;
    const records = ["first", "second", "unread", "progress"].map((id, index) => ({
      id, title: id, originalUrl: `https://example.com/${id}`, normalizedUrl: `https://example.com/${id}`,
      domain: "example.com", tags: ["Manual"], originalSavedAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp + index,
      completedAt: index < 2 ? timestamp + index : undefined,
      status: index < 2 ? "read" : index === 2 ? "unread" : "in_progress", progress: index < 2 ? 1 : 0.3
    }));
    const backup = {
      schemaVersion: 2, exportedAt: new Date().toISOString(), articles: records, annotations: [], sources: [],
      sessions: records.slice(0, 2).map((article, index) => ({
        id: `session-${article.id}`, articleId: article.id, startedAt: timestamp,
        endedAt: timestamp + 1_000, activeSeconds: index === 0 ? 20 : 10, startProgress: 0, endProgress: 1
      }))
    };
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Import JSON file").setInputFiles({
      name: "history.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))
    });
    await page.getByRole("button", { name: "Apply import", exact: true }).click();
    await expect(page.getByText("Imported 4 new articles", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /^Library/ }).click();
    const first = page.locator(".article-card").filter({ has: page.getByLabel("Status for first", { exact: true }) });
    await expect(first.locator(".bookmark-folder-path")).toContainText("Reading");
    const actions = first.getByRole("button", { name: "Actions for article first", exact: true });
    await actions.click();
    await first.getByRole("menuitem", { name: "Move Favorite", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Move Favorite", exact: true });
    await expect(picker.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(picker).not.toBeVisible();
    await expect(actions).toBeFocused();
    await actions.click();
    await first.getByRole("menuitem", { name: "Move Favorite", exact: true }).click();
    await picker.getByRole("radio", { name: "Select Archive", exact: true }).check();
    await picker.getByRole("button", { name: "Move here", exact: true }).click();
    await expect(first.locator(".bookmark-folder-path")).toContainText("Archive");
    await expect(first.locator(".article-tags")).toHaveText("Manual");
    expect(await page.evaluate(async (id) => (await chrome.bookmarks.get(id))[0].parentId, favorites.first.id)).toBe(favorites.archive.id);
    await page.evaluate(async (id) => { await chrome.bookmarks.update(id, { title: "Finished" }); }, favorites.archive.id);
    await expect(first.locator(".bookmark-folder-path")).toContainText("Finished");
    await first.getByLabel("Status for first", { exact: true }).selectOption("unread");
    await first.getByLabel("Status for first", { exact: true }).selectOption("read");
    await expect(page.getByRole("button", { name: "Remove from list", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep in list", exact: true }).click();
    await page.evaluate(async (id) => { await chrome.bookmarks.remove(id); }, favorites.first.id);
    await expect(first.getByText("Not linked to Edge Favorites", { exact: true })).toBeVisible();
    await actions.click();
    await first.getByRole("menuitem", { name: "Restore or relink Favorite", exact: true }).click();
    const restore = page.getByRole("dialog", { name: "Restore or relink Favorite", exact: true });
    await restore.getByRole("radio", { name: "Select Reading", exact: true }).check();
    await restore.getByRole("button", { name: "Use folder", exact: true }).click();
    await expect(first.getByText("Linked to Edge Favorites", { exact: true })).toBeVisible();
    await expect(first.getByLabel("Status for first", { exact: true })).toHaveValue("read");

    await page.getByRole("button", { name: /^Sources/ }).click();
    await page.getByRole("button", { name: "Discover", exact: true }).click();
    await expect(page.locator(".source-card")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "example.com", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settingsGap = await page.locator(".settings-preferences > .settings-card").evaluateAll((cards) =>
      cards[1].getBoundingClientRect().top - cards[0].getBoundingClientRect().bottom);
    expect(settingsGap).toBe(14);
    await expect(page.getByRole("checkbox", { name: "Automatically clean up read articles" })).not.toBeChecked();
    await expect(page.getByRole("spinbutton", { name: "Read articles to keep" })).toHaveValue("100");
    await page.getByRole("checkbox", { name: "Automatically clean up read articles" }).check();
    await page.getByRole("spinbutton", { name: "Read articles to keep" }).fill("1");
    await page.getByRole("button", { name: "Save automation", exact: true }).click();
    await expect(page.getByText("Automation enabled. 1 read articles", { exact: false })).toBeVisible();
    expect(await page.evaluate(async (id) => (await chrome.bookmarks.get(id)).length, favorites.second.id)).toBe(1);
    await page.getByRole("button", { name: /^Library/ }).click();
    await expect(page.locator(".article-card")).toHaveCount(3);
    await expect(page.getByLabel("Status for unread", { exact: true })).toHaveValue("unread");
    await expect(page.getByLabel("Status for progress", { exact: true })).toHaveValue("in_progress");
    await page.getByRole("button", { name: "Statistics", exact: true }).click();
    await expect(page.getByText("Recorded active time:", { exact: false })).toContainText("30s");
    await expect(page.getByText("Recorded reads: 2 (1 archived)", { exact: true })).toBeVisible();
    await page.getByText("Archived articles (1)", { exact: true }).click();
    await expect(page.getByText(`Historical Favorite reference: ${favorites.second.id}`, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(305);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export all", exact: true }).click();
    const download = await downloadPromise;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator(".app-header").getByRole("status")).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath("scrolled-header-feedback.png") });
    const stream = await download.createReadStream();
    let json = "";
    for await (const chunk of stream) json += chunk.toString();
    const exported = JSON.parse(json);
    expect(exported.articles).toHaveLength(3);
    expect(exported.readingHistory).toHaveLength(1);
    expect(exported.readingHistory[0].id).toBe("second");
    expect(exported.readingHistory[0].bookmarkId).toBeUndefined();
    expect(exported.sessions).toHaveLength(2);
    const lateUpdate = await page.evaluate(async () => chrome.runtime.sendMessage({
      type: "SAVE_READING_UPDATE", articleId: "second", progress: 1, activeSeconds: 12,
      session: {
        id: "session-second", articleId: "second", startedAt: Date.now() - 12_000,
        endedAt: Date.now(), activeSeconds: 12, startProgress: 0, endProgress: 1
      }
    }));
    expect(lateUpdate.ok).toBe(true);
    await page.getByLabel("Import JSON file").setInputFiles({
      name: "restore.json", mimeType: "application/json", buffer: Buffer.from(json)
    });
    await page.getByRole("button", { name: "Apply import", exact: true }).click();
    await expect(page.getByText("Imported 0 new articles", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /^Library/ }).click();
    await page.getByRole("button", { name: "Statistics", exact: true }).click();
    await expect(page.getByText("Recorded active time:", { exact: false })).toContainText("32s");
    await expect(page.getByText("Recorded reads: 2 (1 archived)", { exact: true })).toBeVisible();
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("saves the active website as a source and keeps contextual saved state in sync", async () => {
  const directory = await mkdtemp(path.join(await realpath(os.tmpdir()), "ready-contextual-save-"));
  const extensionPath = path.join(directory, "extension");
  await cp(path.resolve("dist"), extensionPath, { recursive: true });
  const manifestPath = path.join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Pregrant only the fixture origins, avoiding browser-chrome permission dialogs.
  manifest.host_permissions = ["https://example.com/*", "https://www.example.com/*"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(path.join(directory, "profile"), {
    channel: process.env.READY_E2E_CHANNEL,
    headless: false,
    viewport: { width: 320, height: 800 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  try {
    await context.addInitScript(installClassicScrollbars);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${unpackedExtensionId(extensionPath)}/sidebar.html`);
    await page.getByRole("button", { name: /^Sources/ }).click();
    await context.route(/^https:\/\/(?:www\.)?example\.com\//, (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Source test</title><p>Article</p>" }));
    const articlePage = await context.newPage();
    await articlePage.goto("https://example.com/story");
    await articlePage.bringToFront();
    const save = page.locator(".save-current-page");
    await expect(save).toContainText("Save source");
    await expect(save).toBeEnabled();
    // Keep the article tab active, as it is when using the native sidebar.
    await save.evaluate((button: HTMLButtonElement) => button.click());
    await expect(save).toContainText("Source saved");
    await expect(save).toBeDisabled();
    const brandBounds = await page.locator(".brand span").boundingBox();
    const saveBounds = await save.boundingBox();
    expect(brandBounds!.x + brandBounds!.width).toBeLessThanOrEqual(saveBounds!.x - 12);
    await expect(page.locator(".source-card")).toHaveCount(1);
    await expect(page.locator(".app-header").getByRole("status")).toContainText("Source added.");
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ url: "https://example.com/" })).length)).toBe(0);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({ path: test.info().outputPath(`source-saved-${colorScheme}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
    await articlePage.goto("https://www.example.com/another");
    await expect(save).toContainText("Source saved");
    await page.getByRole("button", { name: /^Library/ }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(save).toContainText("Save page");
    await expect(save).toBeEnabled();
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const released = new Promise<void>((resolve) => document.addEventListener("finish-test-save",
        () => resolve(), { once: true }));
      chrome.runtime.sendMessage = ((message: { type: string }) => {
        if (message.type !== "SAVE_ACTIVE_PAGE") return send(message);
        return Promise.all([send(message), released]).then(([response]) => response);
      }) as typeof chrome.runtime.sendMessage;
    });
    await save.evaluate((button: HTMLButtonElement) => button.click());
    await expect(save).toHaveAccessibleName("Saving page…");
    await expect(save.locator(".save-icon")).toHaveAttribute("data-state", "saving");
    expect(await save.locator(".save-icon").evaluate((icon) => icon.getAnimations({ subtree: true }).length)).toBe(0);
    await page.evaluate(() => document.dispatchEvent(new Event("finish-test-save")));
    await expect(save).toContainText("Page saved");
    await expect(save.locator(".save-icon")).toHaveAttribute("data-state", "saved");
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.mouse.move(0, 0);
      const colors = await save.evaluate((button) => ({
        background: getComputedStyle(button).backgroundColor, color: getComputedStyle(button).color
      }));
      await save.hover();
      expect(await save.evaluate((button) => ({
        background: getComputedStyle(button).backgroundColor, color: getComputedStyle(button).color
      }))).toEqual(colors);
      expect(colors.background).toBe(colorScheme === "light" ? "rgb(232, 246, 237)" : "rgb(38, 61, 50)");
      await page.screenshot({ path: test.info().outputPath(`saved-hover-${colorScheme}.png`) });
    }
    await page.getByRole("button", { name: /^Sources/ }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(save).toContainText("Source saved");
    await page.getByRole("button", { name: "Actions for source example.com", exact: true }).click();
    await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
    const removeSourceDialog = page.getByRole("dialog", { name: "Remove source?", exact: true });
    await expect(removeSourceDialog).toContainText("Edge Favorites are kept");
    await expect(removeSourceDialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    const sourceRemovalBounds = await removeSourceDialog.boundingBox();
    expect(sourceRemovalBounds!.height).toBeLessThan(400);
    expect(sourceRemovalBounds!.x).toBeGreaterThanOrEqual(16);
    await page.screenshot({ path: test.info().outputPath("source-removal-dark.png") });
    await removeSourceDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(".source-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Actions for source example.com", exact: true }).click();
    await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
    await removeSourceDialog.getByRole("button", { name: "Remove source", exact: true }).click();
    await expect(page.locator(".source-card")).toHaveCount(0);
    expect(await page.evaluate(async () => (await chrome.bookmarks.search({ url: "https://www.example.com/another" })).length)).toBe(1);
    await page.getByRole("button", { name: /^Library/ }).click();
    await expect(page.locator(".article-card")).toHaveCount(1);
    await page.getByRole("button", { name: /^Sources/ }).click();
    await articlePage.bringToFront();
    await expect(save).toContainText("Save source");
    await expect(save).toBeEnabled();
    await page.reload();
    await page.getByRole("button", { name: /^Sources/ }).click();
    await expect(page.locator(".source-card")).toHaveCount(0);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function unpackedExtensionId(extensionPath: string): string {
  const digest = createHash("sha256").update(extensionPath).digest("hex").slice(0, 32);
  return [...digest]
    .map((character) => String.fromCharCode("a".charCodeAt(0) + Number.parseInt(character, 16)))
    .join("");
}
