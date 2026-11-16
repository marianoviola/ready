import { act, createElement } from "react";
import Dexie from "dexie";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendReadyMessage } from "../../src/browser/messages";
import { db } from "../../src/db/database";
import type { Article, Source } from "../../src/domain/types";
import { App } from "../../src/sidebar/App";

vi.mock("../../src/browser/messages", () => ({ sendReadyMessage: vi.fn() }));

let container: HTMLDivElement;
let root: Root;
let articles: Article[];
let sources: Source[];
let activeUrl: string;
let siteAccessGranted: boolean;
const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
const article: Article = {
  id: "article", title: "Story", originalUrl: "https://example.com/story",
  normalizedUrl: "https://example.com/story", domain: "example.com",
  bookmarkState: "linked", bookmarkId: "1", status: "unread", progress: 0,
  tags: [], createdAt: 1, updatedAt: 1, originalSavedAt: 1
};

function saveButton() {
  return container.querySelector<HTMLButtonElement>(".save-current-page")!;
}

async function settled(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    assertion();
  });
}

async function navigate(url: string) {
  activeUrl = url;
  await act(async () => {
    const refresh = vi.mocked(chrome.tabs.onActivated.addListener).mock.calls[0][0];
    refresh({ tabId: 1, windowId: 1 });
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  activeUrl = article.originalUrl;
  siteAccessGranted = true;
  articles = [];
  sources = [];
  vi.stubGlobal("chrome", {
    runtime: { id: "ready-test", getManifest: () => ({ version: "0.1.0" }), getURL: (path: string) => `chrome-extension://ready-test/${path}` },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
    bookmarks: { onCreated: event(), onChanged: event(), onMoved: event(), onRemoved: event() },
    tabs: {
      query: vi.fn(async () => [{ id: 1, url: activeUrl, active: true }]),
      onActivated: event(), onUpdated: event(), onRemoved: event()
    },
    permissions: { contains: vi.fn(async () => siteAccessGranted), request: vi.fn(async () => siteAccessGranted) }
  });
  vi.spyOn(db.articles, "toArray").mockImplementation(() => Dexie.Promise.resolve([...articles]));
  vi.spyOn(db.sources, "toArray").mockImplementation(() => Dexie.Promise.resolve([...sources]));
  vi.spyOn(db.annotations, "toArray").mockResolvedValue([]);
  vi.spyOn(db.sessions, "toArray").mockResolvedValue([]);
  vi.spyOn(db.readingHistory, "toArray").mockResolvedValue([]);
  vi.spyOn(db.ignoredRecommendations, "toArray").mockResolvedValue([]);
  vi.mocked(sendReadyMessage).mockReset();
  vi.mocked(sendReadyMessage).mockImplementation(async () => ({ ok: true, bookmarks: [] }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderApp() {
  await act(async () => root.render(createElement(App)));
  await settled(() => expect(saveButton().disabled).toBe(false));
}

describe("library filters after removal", () => {
  function select(label: string, value: string) {
    const control = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function refreshLibrary() {
    await act(async () => {
      vi.mocked(chrome.bookmarks.onRemoved.addListener).mock.calls[0][0]("1", {
        parentId: "0", index: 0, node: { id: "1", title: "Removed", url: article.originalUrl, syncing: false }
      });
    });
  }

  it("offers family and exact host filters and preserves a family with one remaining host", async () => {
    activeUrl = "https://example.net/";
    articles = [
      article,
      { ...article, id: "blog", title: "Blog story", domain: "blog.example.com" },
      { ...article, id: "other", title: "Other story", domain: "example.org" }
    ];
    await renderApp();
    const website = container.querySelector<HTMLSelectElement>('[aria-label="Website"]')!;
    expect(website.querySelector('optgroup[label="example.com"]')?.textContent).toContain("All example.com sites");
    await act(async () => select("Website", "family:example.com"));
    expect(container.querySelectorAll(".article-card")).toHaveLength(2);
    await act(async () => select("Website", "example.com"));
    expect(container.querySelectorAll(".article-card")).toHaveLength(1);
    expect(container.querySelector(".article-card")?.textContent).toContain("Story");
    await act(async () => select("Website", "family:example.com"));
    articles = articles.filter((item) => item.id !== article.id);
    await refreshLibrary();
    await settled(() => {
      expect(website.value).toBe("family:example.com");
      expect(container.querySelectorAll(".article-card")).toHaveLength(1);
      expect(container.querySelector(".article-card")?.textContent).toContain("Blog story");
    });
    articles = articles.filter((item) => item.id !== "blog");
    await refreshLibrary();
    await settled(() => {
      expect(website.value).toBe("all");
      expect(container.querySelector(".article-card")?.textContent).toContain("Other story");
    });
  });

  it("clears vanished website and tag selections while keeping surviving filters", async () => {
    activeUrl = "https://example.net/";
    articles = [
      { ...article, tags: ["Advertising", "Shared"] },
      { ...article, id: "remaining", title: "Remaining story", domain: "example.org", tags: ["Shared"] }
    ];
    await renderApp();
    await act(async () => {
      select("Website", "example.com");
      select("Tag", "Advertising");
      select("Reading status", "unread");
    });
    expect(container.querySelectorAll(".article-card")).toHaveLength(1);
    articles = articles.filter((item) => item.id !== article.id);
    await refreshLibrary();
    await settled(() => {
      expect(container.querySelector<HTMLSelectElement>('[aria-label="Website"]')!.value).toBe("all");
      expect(container.querySelector<HTMLSelectElement>('select[aria-label="Tag"]')!.value).toBe("");
      expect(container.querySelector(".article-card")?.textContent).toContain("Remaining story");
    });
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Reading status"]')!.value).toBe("unread");
    await act(async () => {
      select("Website", "example.org");
      select("Tag", "Shared");
    });
    await refreshLibrary();
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Website"]')!.value).toBe("example.org");
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Tag"]')!.value).toBe("Shared");
    articles = [];
    await refreshLibrary();
    await settled(() => {
      expect(container.querySelector<HTMLSelectElement>('[aria-label="Website"]')!.value).toBe("all");
      expect(container.querySelector('select[aria-label="Tag"]')).toBeNull();
    });
  });
});

describe("contextual save action", () => {
  it("shows progress, blocks duplicate saves, and derives saved page state from live data and navigation", async () => {
    let finish!: () => void;
    vi.mocked(sendReadyMessage).mockImplementation(async (request) => {
      if (request.type !== "SAVE_ACTIVE_PAGE") return { ok: true, bookmarks: [] };
      await new Promise<void>((resolve) => { finish = resolve; });
      articles.push(article);
      return { ok: true, article, createdBookmark: true };
    });
    await renderApp();
    expect(saveButton().textContent).toContain("Save page");
    await act(async () => {
      saveButton().click();
      saveButton().click();
    });
    expect(saveButton().textContent).toContain("Saving page");
    expect(saveButton().getAttribute("aria-busy")).toBe("true");
    expect(saveButton().querySelector('svg[aria-hidden="true"]')?.getAttribute("data-state")).toBe("saving");
    expect(saveButton().disabled).toBe(true);
    await act(async () => finish());
    await settled(() => expect(saveButton().textContent).toContain("Page saved"));
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().querySelector(".save-icon")?.getAttribute("data-state")).toBe("saved");
    expect(vi.mocked(sendReadyMessage).mock.calls.filter(([request]) => request.type === "SAVE_ACTIVE_PAGE")).toHaveLength(1);
    expect(container.querySelector(".app-header [role=status]")?.textContent).toContain("Saved to Edge Favorites");
    await navigate("https://example.com/story?utm_source=newsletter#position");
    expect(saveButton().textContent).toContain("Page saved");
    await navigate("https://example.com/another");
    expect(saveButton().textContent).toContain("Save page");
    expect(saveButton().disabled).toBe(false);
    await navigate("edge://settings");
    expect(saveButton().disabled).toBe(true);
    await navigate(article.originalUrl);
    expect(saveButton().textContent).toContain("Page saved");
  });

  it("saves the current website as a source without site access or creating an article", async () => {
    let finish!: () => void;
    const add = vi.spyOn(db.sources, "add").mockImplementation((source) => new Dexie.Promise<string>((resolve) => {
      finish = () => {
        const saved = { ...source, id: source.id ?? "source" };
        sources.push(saved);
        resolve(saved.id);
      };
    }));
    await renderApp();
    await act(async () => [...container.querySelectorAll("button")].find((button) => /^Sources/.test(button.textContent ?? ""))!.click());
    expect(saveButton().textContent).toContain("Save source");
    await act(async () => saveButton().click());
    expect(saveButton().textContent).toContain("Saving source");
    expect(saveButton().disabled).toBe(true);
    await act(async () => finish());
    await settled(() => expect(saveButton().textContent).toContain("Source saved"));
    expect(add).toHaveBeenCalledOnce();
    expect(sources[0]).toMatchObject({ name: "example.com", url: "https://example.com/", subscribed: false });
    expect(chrome.permissions.contains).not.toHaveBeenCalled();
    expect(vi.mocked(sendReadyMessage).mock.calls.some(([request]) => request.type === "SAVE_ACTIVE_PAGE")).toBe(false);
    expect(container.querySelector(".app-header [role=status]")?.textContent).toContain("Source added.");
    await navigate("https://www.example.com/another-story");
    expect(saveButton().textContent).toContain("Source saved");
    await act(async () => [...container.querySelectorAll("button")].find((button) => /^Library/.test(button.textContent ?? ""))!.click());
    expect(saveButton().textContent).toContain("Save page");
    expect(saveButton().disabled).toBe(false);
  });

  it("surfaces save errors in the header and permits a retry without a false saved state", async () => {
    siteAccessGranted = false;
    await renderApp();
    await act(async () => saveButton().click());
    await settled(() => expect(container.querySelector(".app-header [role=alert]")?.textContent).toContain("Site access is required"));
    expect(saveButton().textContent).toContain("Save page");
    expect(saveButton().disabled).toBe(false);
    expect(saveButton().getAttribute("aria-busy")).toBe("false");
    expect(vi.mocked(sendReadyMessage).mock.calls.some(([request]) => request.type === "SAVE_ACTIVE_PAGE")).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss error"]')!.click());
    expect(container.querySelector("[role=alert]")).toBeNull();
    siteAccessGranted = true;
    vi.mocked(sendReadyMessage).mockImplementation(async (request) => {
      if (request.type !== "SAVE_ACTIVE_PAGE") return { ok: true, bookmarks: [] };
      articles.push(article);
      return { ok: true, article, createdBookmark: false };
    });
    await act(async () => saveButton().click());
    await settled(() => expect(saveButton().textContent).toContain("Page saved"));
    expect(container.querySelector("[role=alert]")).toBeNull();
  });

  it("does not mark a newly active page saved when an earlier page finishes saving", async () => {
    let finish!: () => void;
    vi.mocked(sendReadyMessage).mockImplementation(async (request) => {
      if (request.type !== "SAVE_ACTIVE_PAGE") return { ok: true, bookmarks: [] };
      await new Promise<void>((resolve) => { finish = resolve; });
      articles.push(article);
      return { ok: true, article, createdBookmark: false };
    });
    await renderApp();
    await act(async () => saveButton().click());
    await navigate("https://another.example/new");
    await act(async () => finish());
    await settled(() => expect(saveButton().textContent).toContain("Save page"));
    expect(saveButton().disabled).toBe(false);
    await navigate(article.originalUrl);
    expect(saveButton().textContent).toContain("Page saved");
  });

  it("shows a source storage failure without claiming it was saved", async () => {
    vi.spyOn(db.sources, "add").mockRejectedValue(new Error("Source storage unavailable."));
    await renderApp();
    await act(async () => [...container.querySelectorAll("button")].find((button) => /^Sources/.test(button.textContent ?? ""))!.click());
    await act(async () => saveButton().click());
    await settled(() => expect(container.querySelector(".app-header [role=alert]")?.textContent).toContain("Source storage unavailable."));
    expect(saveButton().textContent).toContain("Save source");
    expect(saveButton().disabled).toBe(false);
    expect(sources).toHaveLength(0);
  });
});
