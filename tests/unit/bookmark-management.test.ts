import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookmarkMetadataForArticle,
  getBookmarkMetadata,
  moveBookmark,
  removeArticle,
  restoreBookmark,
  linkBookmarks
} from "../../src/browser/bookmarks";
import { db } from "../../src/db/database";
import type { Article } from "../../src/domain/types";

let tree: chrome.bookmarks.BookmarkTreeNode[];
let article: Article;
const node = (id: string, title: string, parentId?: string): chrome.bookmarks.BookmarkTreeNode =>
  ({ id, title, parentId, syncing: false, children: [] });
function allNodes(): chrome.bookmarks.BookmarkTreeNode[] {
  const flatten = (items: chrome.bookmarks.BookmarkTreeNode[]): chrome.bookmarks.BookmarkTreeNode[] =>
    items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
  return flatten(tree);
}

beforeEach(async () => {
  await Promise.all([db.articles.clear(), db.readingHistory.clear(), db.annotations.clear(), db.sessions.clear(), db.ignoredRecommendations.clear()]);
  const root = node("0", "");
  const favorites = node("1", "Favorites bar", "0");
  const folder = node("2", "Reading", "1");
  const destination = node("3", "Archive", "1");
  folder.children = [{ id: "4", title: "Original", parentId: "2", url: "https://example.com/article", syncing: false }];
  favorites.children = [folder, destination];
  root.children = [favorites];
  tree = [root];
  article = {
    id: "article", bookmarkId: "4", bookmarkState: "linked",
    originalUrl: "https://example.com/article", normalizedUrl: "https://example.com/article",
    title: "My title", domain: "example.com", tags: ["Manual"], originalSavedAt: 1,
    status: "read", progress: 1, createdAt: 2, updatedAt: 3, lastReadAt: 4
  };
  await db.articles.add(article);
  vi.stubGlobal("chrome", {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() } },
    bookmarks: {
      getTree: vi.fn(async () => structuredClone(tree)),
      getSubTree: vi.fn(async (id: string) => [structuredClone(allNodes().find((item) => item.id === id)!)]),
      move: vi.fn(async (id: string, details: chrome.bookmarks.MoveDestination) => {
        const bookmark = allNodes().find((item) => item.id === id)!;
        const oldParent = allNodes().find((item) => item.id === bookmark.parentId)!;
        oldParent.children = oldParent.children!.filter((item) => item.id !== id);
        const parent = allNodes().find((item) => item.id === details.parentId)!;
        parent.children!.push(bookmark);
        bookmark.parentId = parent.id;
        return structuredClone(bookmark);
      }),
      create: vi.fn(async (details: chrome.bookmarks.CreateDetails) => {
        const bookmark = { id: "5", title: details.title ?? "", url: details.url, parentId: details.parentId, syncing: false };
        allNodes().find((item) => item.id === details.parentId)!.children!.push(bookmark);
        return bookmark;
      }),
      remove: vi.fn(async (id: string) => {
        const parent = allNodes().find((item) => item.children?.some((child) => child.id === id))!;
        parent.children = parent.children!.filter((child) => child.id !== id);
      })
    }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("live Favorite management", () => {
  it("reports folder paths and reflects ancestor renames and moves", async () => {
    expect(bookmarkMetadataForArticle(article, tree).folderPath).toEqual(["Favorites bar", "Reading"]);
    allNodes().find((item) => item.id === "2")!.title = "To read";
    await chrome.bookmarks.move("2", { parentId: "3" });
    expect((await getBookmarkMetadata())[0].folderPath).toEqual(["Favorites bar", "Archive", "To read"]);
  });

  it("reconciles all descendants when a folder is removed without losing reading data", async () => {
    await chrome.bookmarks.remove("2");
    expect((await getBookmarkMetadata())[0]).toEqual({ articleId: article.id, state: "orphaned", folderPath: [] });
    expect(await db.articles.get(article.id)).toEqual({
      ...article, bookmarkId: undefined, bookmarkState: "orphaned", updatedAt: expect.any(Number)
    });
  });

  it("orphans a changed URL instead of silently pointing reading data at another page", async () => {
    allNodes().find((item) => item.id === "4")!.url = "https://example.com/different";
    await getBookmarkMetadata();
    expect((await db.articles.get(article.id))?.bookmarkState).toBe("orphaned");
    await expect(moveBookmark(article.id, "3")).rejects.toThrow("no longer linked");
    expect(chrome.bookmarks.move).not.toHaveBeenCalled();
  });

  it("moves an already-read article without changing tags, state, or saved destination", async () => {
    const result = await moveBookmark(article.id, "3");
    expect(result.article).toEqual(article);
    expect(result.bookmarkMetadata.folderPath).toEqual(["Favorites bar", "Archive"]);
    expect(await db.articles.get(article.id)).toEqual(article);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  });

  it.each(["", "0", "4", "missing"])("rejects invalid destination %s", async (folderId) => {
    await expect(moveBookmark(article.id, folderId)).rejects.toThrow();
    expect(chrome.bookmarks.move).not.toHaveBeenCalled();
  });

  it("surfaces move errors and preserves Ready data for retry", async () => {
    vi.mocked(chrome.bookmarks.move).mockRejectedValueOnce(new Error("Move failed"));
    await expect(moveBookmark(article.id, "3")).rejects.toThrow("Move failed");
    expect(await db.articles.get(article.id)).toEqual(article);
  });

  it("relinks a same-URL Favorite without moving it or overwriting reading data", async () => {
    await db.articles.update(article.id, { bookmarkId: undefined, bookmarkState: "orphaned" });
    const restored = await restoreBookmark(article.id, "3");
    expect(restored).toMatchObject({ ...article, tags: ["Manual", "Reading"], updatedAt: expect.any(Number) });
    expect(chrome.bookmarks.create).not.toHaveBeenCalled();
    expect(chrome.bookmarks.move).not.toHaveBeenCalled();
  });

  it("restores the original URL after the former Favorite changes", async () => {
    allNodes().find((item) => item.id === "4")!.url = "https://example.com/different";
    await getBookmarkMetadata();
    const restored = await restoreBookmark(article.id, "3");
    expect(restored.bookmarkId).toBe("5");
    expect(chrome.bookmarks.create).toHaveBeenCalledWith({
      parentId: "3", title: article.title, url: article.originalUrl
    });
    expect(restored.tags).toEqual(["Manual", "Archive"]);
    expect(restored.progress).toBe(1);
  });

  it("keeps a concurrently updated reading status when restoring", async () => {
    vi.mocked(chrome.bookmarks.getTree).mockImplementationOnce(async () => {
      await db.articles.update(article.id, { status: "in_progress", progress: 0.6 });
      return structuredClone(tree);
    });
    const restored = await restoreBookmark(article.id);
    expect(restored.status).toBe("in_progress");
    expect(restored.progress).toBe(0.6);
  });

  it("removes Ready-owned article data but keeps Favorites by default", async () => {
    await db.sessions.add({ id: "session", articleId: article.id, startedAt: 1, endedAt: 2, activeSeconds: 1, startProgress: 0, endProgress: 1 });
    await db.annotations.add({ id: "note", articleId: article.id, anchor: { exact: "test", prefix: "", suffix: "", start: 0, end: 4 }, color: "yellow", note: "Keep private", unresolved: false, createdAt: 1, updatedAt: 1 });
    await db.ignoredRecommendations.add({ articleId: article.id, category: "forgotten", ignoredAt: 1 });
    expect(await removeArticle(article.id, false)).toBe(false);
    expect(await db.articles.count()).toBe(0);
    expect(await db.annotations.count()).toBe(0);
    expect(await db.sessions.count()).toBe(1);
    expect(await db.readingHistory.get(article.id)).toMatchObject({ ...article, archivedAt: expect.any(Number) });
    expect(await db.ignoredRecommendations.count()).toBe(0);
    expect(chrome.bookmarks.remove).not.toHaveBeenCalled();
  });

  it("reactivates an archived Favorite with its original identity, progress, and session references", async () => {
    await db.sessions.add({ id: "session", articleId: article.id, startedAt: 1, endedAt: 2, activeSeconds: 1, startProgress: 0, endProgress: 1 });
    await removeArticle(article.id, false);
    expect(await linkBookmarks(["4"])).toBe(1);
    expect(await db.articles.get(article.id)).toMatchObject({
      bookmarkId: "4", status: "read", progress: 1, tags: ["Manual", "Reading"]
    });
    expect(await db.readingHistory.count()).toBe(0);
    expect((await db.sessions.get("session"))?.articleId).toBe(article.id);
  });

  it("optionally deletes the linked Favorite", async () => {
    expect(await removeArticle(article.id, true)).toBe(true);
    expect(chrome.bookmarks.remove).toHaveBeenCalledWith("4");
    expect(await db.articles.count()).toBe(0);
  });

  it("removes Ready data even when the optional Favorite is already missing", async () => {
    await chrome.bookmarks.remove("2");
    vi.mocked(chrome.bookmarks.remove).mockClear();
    expect(await removeArticle(article.id, true)).toBe(false);
    expect(await db.articles.count()).toBe(0);
    expect(chrome.bookmarks.remove).not.toHaveBeenCalled();
  });

  it("never deletes a Favorite whose URL no longer matches", async () => {
    allNodes().find((item) => item.id === "4")!.url = "https://example.com/different";
    expect(await removeArticle(article.id, true)).toBe(false);
    expect(chrome.bookmarks.remove).not.toHaveBeenCalled();
  });

  it("keeps Ready data on an optional deletion failure so confirmation can be retried", async () => {
    vi.mocked(chrome.bookmarks.remove).mockRejectedValueOnce(new Error("Read-only Favorite"));
    await expect(removeArticle(article.id, true)).rejects.toThrow("Read-only Favorite");
    expect(await db.articles.get(article.id)).toEqual(article);
  });
});
