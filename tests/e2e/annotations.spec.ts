import { chromium, expect, test, type Page } from "@playwright/test";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ReadyResponse } from "../../src/browser/messages";

test("persists annotations and shows recovery after actual extension invalidation", async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(path.join(await realpath(os.tmpdir()), "ready-annotations-"));
  const extensionPath = path.join(directory, "extension");
  await cp(path.resolve("dist"), extensionPath, { recursive: true });
  const manifestPath = path.join(extensionPath, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Pregrant only the fixture origin, avoiding browser-chrome permission dialogs.
  manifest.host_permissions = ["https://example.com/*"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(path.join(directory, "profile"), {
    channel: process.env.READY_E2E_CHANNEL,
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const extensionPage = await context.newPage();
    const sidebarUrl = `chrome-extension://${extensionId}/sidebar.html`;
    await extensionPage.goto(sidebarUrl);
    await expect(extensionPage.getByRole("heading", { name: "Ready", exact: true })).toBeVisible();
    await extensionPage.evaluate(async () => {
      const bookmark = await chrome.bookmarks.create({
        title: "Annotation test", url: "https://example.com/annotations"
      });
      const result = await chrome.runtime.sendMessage({
        type: "LINK_BOOKMARKS", bookmarkIds: [bookmark.id]
      }) as ReadyResponse;
      if (!result.ok) throw new Error(result.error);
    });
    await context.route("https://example.com/**", (route) => route.fulfill({
      contentType: "text/html",
      body: `<title>Annotation test</title><article><p>A selected passage for a private reading note.</p><p>${"More article content. ".repeat(50)}</p></article>`
    }));
    const readingPage = await context.newPage();
    await readingPage.goto("https://example.com/annotations");
    const tabId = await extensionPage.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: "https://example.com/annotations" });
      if (tab.id === undefined) throw new Error("Missing reading tab.");
      return tab.id;
    });
    const ui = async (action?: string): Promise<string> => extensionPage.evaluate(async ({ tabId, action }) => {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (action?: string) => {
          const host = document.querySelector<HTMLElement>("[data-ready-ui]");
          if (!host) return "";
          const root = chrome.dom.openOrClosedShadowRoot(host);
          if (action) root?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click();
          return root?.textContent ?? "";
        },
        args: [action ?? ""]
      });
      return result.result ?? "";
    }, { tabId, action });
    const annotations = async () => extensionPage.evaluate(async () => {
      const result = await chrome.runtime.sendMessage({
        type: "GET_PAGE_DATA", url: "https://example.com/annotations"
      }) as ReadyResponse;
      if (!result.ok || !("annotations" in result)) throw new Error("Missing annotations.");
      return result.annotations;
    });

    await expect(readingPage.locator("[data-ready-ui]")).toHaveCount(1);
    await selectPassage(readingPage);
    await expect.poll(() => ui()).toContain("Add note");
    await ui("highlight");
    await expect.poll(annotations).toHaveLength(1);
    expect((await annotations())[0].anchor.exact).toBe("selected passage");
    await selectPassage(readingPage);
    await expect.poll(() => ui()).toContain("Add note");
    readingPage.once("dialog", (dialog) => dialog.accept("A persistent private note"));
    await ui("note");
    await expect.poll(annotations).toHaveLength(2);
    expect(await annotations()).toContainEqual(expect.objectContaining({ note: "A persistent private note" }));

    await readingPage.reload();
    await expect(readingPage.locator("[data-ready-ui]")).toHaveCount(1);
    expect(await annotations()).toHaveLength(2);
    await selectPassage(readingPage);
    await expect.poll(() => ui()).toContain("Add note");
    const bounds = await extensionPage.evaluate(async (tabId) => {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const host = document.querySelector<HTMLElement>("[data-ready-ui]")!;
          const button = chrome.dom.openOrClosedShadowRoot(host)!.querySelector('[data-action="highlight"]')!;
          const rect = button.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      });
      if (!result.result) throw new Error("Missing toolbar bounds.");
      return result.result;
    }, tabId);
    const unexpectedDialogs: string[] = [];
    readingPage.on("dialog", async (dialog) => {
      unexpectedDialogs.push(dialog.message());
      await dialog.dismiss();
    });
    const stopped = worker.waitForEvent("close");
    await extensionPage.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 50); });
    await stopped;
    await readingPage.bringToFront();
    await readingPage.mouse.click(bounds.x, bounds.y);
    const session = await context.newCDPSession(readingPage);
    const recoveryText = async () => JSON.stringify(await session.send("DOM.getDocument", { depth: -1, pierce: true }));
    await expect.poll(recoveryText).toContain("Reload this page");
    expect(await recoveryText()).toContain("Reload page");
    await expect(readingPage.locator("[data-ready-ui]")).toHaveCount(1);
    expect(unexpectedDialogs).toEqual([]);
    await session.detach();
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});

async function selectPassage(page: Page): Promise<void> {
  await page.bringToFront();
  await page.evaluate(() => {
    const text = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 18);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
  });
}
