import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getBookmarkDestination,
  resolveBookmarkDestination,
  setBookmarkDestination
} from "../../src/browser/bookmark-destination";
import { linkBookmarks, restoreBookmark, saveActivePage } from "../../src/browser/bookmarks";
import { db } from "../../src/db/database";
import { bookmarkTagsById } from "../../src/domain/bookmark-tree";

let stored: Record<string, unknown>;
let tree: chrome.bookmarks.BookmarkTreeNode[];
let nextId: number;
let activeUrl: string;

function nodes(): chrome.bookmarks.BookmarkTreeNode[] {
  function flatten(items: chrome.bookmarks.BookmarkTreeNode[]): chrome.bookmarks.BookmarkTreeNode[] {
    return items.flatMap((node) => [node, ...flatten(node.children ?? [])]);
  }
  return flatten(tree);
}

beforeEach(async () => {
  await db.articles.clear();
  stored = {};
  nextId = 10;
  activeUrl = "https://example.com/new";
  tree = [{ id: "0", title: "", syncing: false, children: [
    { id: "2", parentId: "0", title: "Other Favorites", syncing: false, children: [
      { id: "3", parentId: "2", title: "Reading", syncing: false, children: [] }
    ] }
  ] }];
  vi.stubGlobal("chrome", {
    storage: { local: {
      get: vi.fn(async () => ({ ...stored })),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, value); }),
      remove: vi.fn(async (key: string) => { delete stored[key]; })
    } },
    tabs: { query: vi.fn(async () => [{ id: 1, title: "New article", url: activeUrl }]) },
    bookmarks: {
      getTree: vi.fn(async () => structuredClone(tree)),
      getSubTree: vi.fn(async (id: string) => nodes().filter((node) => node.id === id)),
      create: vi.fn(async (details: chrome.bookmarks.CreateDetails) => {
        const node: chrome.bookmarks.BookmarkTreeNode = {
          ...details, id: String(nextId++), title: details.title ?? "", syncing: false,
          parentId: details.parentId ?? "2",
          ...(details.url ? {} : { children: [] })
        };
        const parent = nodes().find((item) => item.id === node.parentId);
        if (!parent?.children) throw new Error("Parent not found.");
        parent.children.push(node);
        return node;
      })
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("bookmark destination", () => {
  it("creates Ready lazily and shares it between simultaneous requests", async () => {
    expect(await getBookmarkDestination()).toEqual({ folderId: undefined, readyFolderId: undefined });
    expect(chrome.bookmarks.create).not.toHaveBeenCalled();
    const ids = await Promise.all([resolveBookmarkDestination(), resolveBookmarkDestination()]);
    expect(ids[0]).toBe(ids[1]);
    expect(chrome.bookmarks.create).toHaveBeenCalledTimes(1);
    expect(await resolveBookmarkDestination()).toBe(ids[0]);
    expect(stored.readyFolderId).toBe(ids[0]);
  });

  it("uses custom and explicit folders, then restores the Ready default", async () => {
    await setBookmarkDestination("3");
    expect(await resolveBookmarkDestination()).toBe("3");
    expect(await resolveBookmarkDestination("2")).toBe("2");
    expect(chrome.bookmarks.create).not.toHaveBeenCalled();
    await setBookmarkDestination();
    expect(await resolveBookmarkDestination()).not.toBe("3");
  });

  it("rejects deleted custom folders but recreates a deleted technical folder", async () => {
    await setBookmarkDestination("3");
    tree[0].children![0].children = [];
    await expect(resolveBookmarkDestination()).rejects.toThrow("no longer exists");
    expect(chrome.bookmarks.create).not.toHaveBeenCalled();
    await setBookmarkDestination();
    const first = await resolveBookmarkDestination();
    tree[0].children![0].children = [];
    expect(await resolveBookmarkDestination()).not.toBe(first);
  });

  it("rejects invalid settings, root nodes, and bookmarks as destinations", async () => {
    stored.bookmarkFolderId = 7;
    await expect(getBookmarkDestination()).rejects.toThrow("invalid");
    await expect(setBookmarkDestination("0")).rejects.toThrow("no longer exists");
    await chrome.bookmarks.create({ title: "Page", url: activeUrl, parentId: "3" });
    await expect(setBookmarkDestination("10")).rejects.toThrow("no longer exists");
  });

  it("saves to Ready without a technical tag and reuses existing Favorites without moving", async () => {
    const saved = await saveActivePage();
    expect(saved.createdBookmark).toBe(true);
    expect(saved.article.tags).toEqual([]);
    expect(nodes().find((node) => node.id === saved.article.bookmarkId)?.parentId).toBe(stored.readyFolderId);
    await db.articles.clear();
    await setBookmarkDestination("3");
    const reused = await saveActivePage();
    expect(reused.createdBookmark).toBe(false);
    expect(reused.article.bookmarkId).toBe(saved.article.bookmarkId);
    expect(nodes().find((node) => node.id === saved.article.bookmarkId)?.parentId).toBe(stored.readyFolderId);
    expect(chrome.bookmarks.create).toHaveBeenCalledTimes(2);
  });

  it("does not create Ready when the active page already has a Favorite", async () => {
    const bookmark = await chrome.bookmarks.create({ parentId: "3", title: "Existing", url: activeUrl });
    vi.mocked(chrome.bookmarks.create).mockClear();
    const saved = await saveActivePage();
    expect(saved.createdBookmark).toBe(false);
    expect(saved.article.bookmarkId).toBe(bookmark.id);
    expect(saved.article.tags).toEqual(["Reading"]);
    expect(chrome.bookmarks.create).not.toHaveBeenCalled();
    expect(stored.readyFolderId).toBeUndefined();
  });

  it("reports creation failures and allows a later retry", async () => {
    vi.mocked(chrome.bookmarks.create).mockRejectedValueOnce(new Error("Bookmarks unavailable"));
    await expect(resolveBookmarkDestination()).rejects.toThrow("Bookmarks unavailable");
    expect(stored.readyFolderId).toBeUndefined();
    expect(await resolveBookmarkDestination()).toBe(stored.readyFolderId);
  });

  it("inherits custom folder tags and preserves tags when restoring to a chosen folder", async () => {
    await setBookmarkDestination("3");
    const saved = await saveActivePage();
    expect(saved.article.tags).toEqual(["Reading"]);
    await db.articles.update(saved.article.id, { bookmarkId: undefined, bookmarkState: "orphaned", tags: ["Manual"] });
    tree[0].children![0].children![0].children = [];
    const restored = await restoreBookmark(saved.article.id, "3");
    expect(restored.tags).toEqual(["Manual", "Reading"]);
    expect(nodes().find((node) => node.id === restored.bookmarkId)?.parentId).toBe("3");
  });

  it("excludes only the technical folder ID when linking and keeps nested tags", async () => {
    const readyId = await resolveBookmarkDestination();
    const nested = await chrome.bookmarks.create({ parentId: readyId, title: "Nested" });
    const page = await chrome.bookmarks.create({ parentId: nested.id, title: "Page", url: activeUrl });
    const userReady = await chrome.bookmarks.create({ parentId: "2", title: "Ready" });
    const other = await chrome.bookmarks.create({ parentId: userReady.id, title: "Other", url: "https://example.com/other" });
    expect(bookmarkTagsById(tree, readyId).get(other.id)).toEqual(["Ready"]);
    expect(await linkBookmarks([page.id])).toBe(1);
    expect((await db.articles.toArray())[0].tags).toEqual(["Nested"]);
  });
});
