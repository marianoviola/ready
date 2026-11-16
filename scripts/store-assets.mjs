import { chromium, expect } from "@playwright/test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const extensionPath = path.resolve("dist");
const outputPath = path.resolve("release/store");
const profilePath = await mkdtemp(path.join(os.tmpdir(), "ready-store-"));
let context;

try {
  context = await chromium.launchPersistentContext(profilePath, {
    channel: "msedge",
    headless: false,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidebar.html`);
  await expect(page.getByRole("heading", { name: "Ready", exact: true })).toBeVisible();
  const now = Date.now();
  const day = 86_400_000;
  const examples = [
    { title: "Build a reading habit that lasts", domain: "example.com", tags: ["Personal growth"], status: "in_progress", progress: 0.42 },
    { title: "Small details, better interfaces", domain: "example.org", tags: ["Design"], status: "unread", progress: 0 },
    { title: "A quieter weekend with a good story", domain: "example.net", tags: ["Weekend"], status: "unread", progress: 0 },
    { title: "Make room for what matters", domain: "example.com", tags: ["Personal growth"], status: "read", progress: 1 }
  ];
  const articles = examples.map((example, index) => ({
    ...example, id: `demo-${index}`, originalUrl: `https://${example.domain}/reading-${index}`,
    normalizedUrl: `https://${example.domain}/reading-${index}`, originalSavedAt: now - (index + 1) * day,
    createdAt: now - (index + 1) * day, updatedAt: now - index * 3_600_000,
    ...(example.progress > 0 ? { lastReadAt: now - 60_000 } : {}),
    ...(example.status === "read" ? { completedAt: now - 60_000 } : {})
  }));
  await page.evaluate(async (articles) => {
    const folder = await chrome.bookmarks.create({ title: "Reading" });
    for (const article of articles) {
      await chrome.bookmarks.create({ parentId: folder.id, title: article.title, url: article.originalUrl });
    }
  }, articles);
  const backup = {
    schemaVersion: 2, exportedAt: new Date(now).toISOString(), articles, annotations: [],
    sessions: articles.filter((article) => article.progress > 0).map((article, index) => ({
      id: `demo-session-${index}`, articleId: article.id, startedAt: now - 1_200_000,
      endedAt: now - 60_000, activeSeconds: 600, startProgress: 0, endProgress: article.progress
    })),
    sources: [
      { name: "Field Notes", domain: "example.com", tags: ["Personal growth"], note: "Ideas worth coming back to.", subscribed: true },
      { name: "Design Journal", domain: "example.org", tags: ["Design"], note: "Thoughtful details for everyday products.", subscribed: true },
      { name: "Weekend Reader", domain: "example.net", tags: ["Weekend"], note: "A little space for a longer story.", subscribed: false }
    ].map((source, index) => ({
      ...source, id: `demo-source-${index}`, url: `https://${source.domain}/`,
      normalizedUrl: `https://${source.domain}/`, createdAt: now - day, updatedAt: now - day
    }))
  };
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Import JSON file").setInputFiles({
    name: "ready-demo.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator(".import-preview")).toContainText("4 new articles");
  await page.getByRole("button", { name: "Apply import", exact: true }).click();
  await expect(page.getByText("Imported 4 new articles", { exact: false })).toBeVisible();
  await mkdir(outputPath, { recursive: true });
  await copyFile(path.join(extensionPath, "icons/ready-128.png"), path.join(outputPath, "logo-128.png"));
  await page.getByRole("button", { name: /^Library/ }).click();
  await expect(page.locator(".article-card")).toHaveCount(4);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(outputPath, "01-library.png") });
  await page.getByRole("button", { name: /^Sources/ }).click();
  await expect(page.getByText("Field Notes", { exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(outputPath, "02-sources.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: /^Library/ }).click();
  await page.getByRole("button", { name: "Statistics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reading statistics", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(outputPath, "03-statistics.png") });
  console.log(`Store images captured in Microsoft Edge ${context.browser().version()}: ${outputPath}`);
} finally {
  await context?.close();
  await rm(profilePath, { recursive: true, force: true });
}
