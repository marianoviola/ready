import { db } from "../db/database";
import { bookmarkTagsById } from "../domain/bookmark-tree";
import { mergeTags } from "../domain/tags";
import { archiveReadingHistory, findReadingHistoryMatch, restoreReadingHistory } from "../domain/reading-history";
import type { Article, BookmarkNode } from "../domain/types";
import { getDomain, normalizeUrl, urlsMatch } from "../domain/url";
import { getBookmarkDestination, resolveBookmarkDestination } from "./bookmark-destination";

export interface BookmarkMetadata {
  articleId: string;
  state: Article["bookmarkState"];
  bookmarkId?: string;
  folderId?: string;
  folderPath: string[];
}

export function bookmarkMetadataForArticle(
  article: Article,
  tree: BookmarkNode[]
): BookmarkMetadata {
  function locate(nodes: BookmarkNode[], path: string[]): BookmarkMetadata | undefined {
    for (const node of nodes) {
      if (node.id === article.bookmarkId && node.url && urlsMatch(node.url, article.originalUrl)) {
        return {
          articleId: article.id,
          state: "linked",
          bookmarkId: node.id,
          folderId: node.parentId,
          folderPath: path
        };
      }
      const found = node.children && locate(
        node.children,
        node.parentId === undefined ? path : [...path, node.title || "Favorites"]
      );
      if (found) return found;
    }
    return undefined;
  }
  return locate(tree, []) ?? { articleId: article.id, state: "orphaned", folderPath: [] };
}

/** Reconcile IDs against a single live snapshot; a changed URL must never relink an article. */
export async function getBookmarkMetadata(): Promise<BookmarkMetadata[]> {
  const tree = await chrome.bookmarks.getTree();
  return db.transaction("rw", db.articles, async () => {
    const articles = await db.articles.toArray();
    const metadata = articles.map((article) => bookmarkMetadataForArticle(article, tree));
    for (const [index, item] of metadata.entries()) {
      const article = articles[index];
      if (article.bookmarkState !== item.state || article.bookmarkId !== item.bookmarkId) {
        await db.articles.update(article.id, {
          bookmarkId: item.bookmarkId,
          bookmarkState: item.state,
          updatedAt: Date.now()
        });
      }
    }
    return metadata;
  });
}

export async function moveBookmark(
  articleId: string,
  folderId: string
): Promise<{ article: Article; bookmarkMetadata: BookmarkMetadata }> {
  const article = await db.articles.get(articleId);
  if (!article) throw new Error("The article no longer exists.");
  if (!folderId) throw new Error("Choose a destination folder.");
  const tree = await chrome.bookmarks.getTree();
  const metadata = bookmarkMetadataForArticle(article, tree);
  if (!metadata.bookmarkId) {
    await markBookmarkOrphaned(article.bookmarkId ?? "");
    throw new Error("This Favorite is no longer linked. Restore it before moving it.");
  }
  // An explicit destination validates the folder without changing saved settings.
  await resolveBookmarkDestination(folderId);
  await chrome.bookmarks.move(metadata.bookmarkId, { parentId: folderId });
  const latest = await db.articles.get(articleId);
  if (!latest) throw new Error("The article no longer exists.");
  const bookmarkMetadata = bookmarkMetadataForArticle(latest, await chrome.bookmarks.getTree());
  if (bookmarkMetadata.state !== "linked") {
    await markBookmarkOrphaned(metadata.bookmarkId);
    throw new Error("The Favorite changed while it was being moved. Restore it to reconnect.");
  }
  return { article: latest, bookmarkMetadata };
}

export async function getBookmarkTree(): Promise<BookmarkNode[]> {
  const [tree, articles] = await Promise.all([
    chrome.bookmarks.getTree(),
    db.articles.where("bookmarkState").equals("linked").toArray()
  ]);
  const linkedBookmarkIds = new Set(
    articles.flatMap((article) => article.bookmarkId ? [article.bookmarkId] : [])
  );
  const linkedUrls = new Set(articles.map((article) => article.normalizedUrl));
  return tree.map((node) => toBookmarkNode(node, linkedBookmarkIds, linkedUrls));
}

export async function linkBookmarks(bookmarkIds: string[]): Promise<number> {
  const tagsByBookmarkId = await inheritedBookmarkTags();
  const collected = new Map<string, chrome.bookmarks.BookmarkTreeNode>();
  for (const id of bookmarkIds) {
    const nodes = await chrome.bookmarks.getSubTree(id);
    for (const node of flatten(nodes)) {
      if (node.url) collected.set(node.id, node);
    }
  }

  let linked = 0;
  for (const bookmark of collected.values()) {
    const inheritedTags = tagsByBookmarkId.get(bookmark.id) ?? [];
    const existing = await findArticleForBookmark(bookmark);
    if (existing) {
      if (!existing.bookmarkId) {
        await db.articles.update(existing.id, {
          bookmarkId: bookmark.id,
          bookmarkState: "linked",
          tags: mergeTags(existing.tags, inheritedTags),
          updatedAt: Date.now()
        });
        linked += 1;
      }
      continue;
    }

    await activateLinkedArticle(articleFromBookmark(bookmark, undefined, inheritedTags));
    linked += 1;
  }
  return linked;
}

export async function saveActivePage(folderId?: string): Promise<{
  article: Article;
  createdBookmark: boolean;
}> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab.id || !/^https?:/.test(tab.url)) {
    throw new Error("This page cannot be saved by Ready.");
  }

  const existingArticle = await findArticleByUrl(tab.url);
  if (existingArticle) {
    if (existingArticle.bookmarkState === "orphaned") {
      return {
        article: await restoreBookmark(existingArticle.id, folderId),
        createdBookmark: false
      };
    }
    return { article: existingArticle, createdBookmark: false };
  }

  const matchingBookmarks = await findBookmarksByUrl(tab.url);
  const bookmark =
    matchingBookmarks[0] ??
    (await chrome.bookmarks.create({
      parentId: await resolveBookmarkDestination(folderId),
      title: tab.title || tab.url,
      url: tab.url
    }));

  const tags = (await inheritedBookmarkTags()).get(bookmark.id) ?? [];
  const article = await activateLinkedArticle(articleFromBookmark(bookmark, tab.title, tags));
  return { article, createdBookmark: matchingBookmarks.length === 0 };
}

export async function restoreBookmark(
  articleId: string,
  folderId?: string
): Promise<Article> {
  const article = await db.articles.get(articleId);
  if (!article) throw new Error("The article no longer exists.");

  const matching = await findBookmarksByUrl(article.originalUrl);
  const bookmark =
    matching[0] ??
    (await chrome.bookmarks.create({
      parentId: await resolveBookmarkDestination(folderId),
      title: article.title,
      url: article.originalUrl
    }));

  const tags = (await inheritedBookmarkTags()).get(bookmark.id) ?? [];
  return db.transaction("rw", db.articles, async () => {
    const latest = await db.articles.get(articleId);
    if (!latest) throw new Error("The article no longer exists.");
    const updated: Article = {
      ...latest,
      bookmarkId: bookmark.id,
      bookmarkState: "linked",
      tags: mergeTags(latest.tags, tags),
      updatedAt: Date.now()
    };
    await db.articles.put(updated);
    return updated;
  });
}

export async function removeArticle(
  articleId: string,
  deleteBookmark: boolean
): Promise<boolean> {
  const article = await db.articles.get(articleId);
  if (!article) throw new Error("The article no longer exists.");

  let removedBookmark = false;
  const metadata = deleteBookmark && article.bookmarkId
    ? bookmarkMetadataForArticle(article, await chrome.bookmarks.getTree())
    : undefined;
  if (metadata?.bookmarkId) {
    const referenceCount = await db.articles
      .where("bookmarkId")
      .equals(metadata.bookmarkId)
      .count();
    if (referenceCount > 1) {
      throw new Error(
        "This Favorite is linked to another Ready article and was not deleted."
      );
    }
    try {
      await chrome.bookmarks.remove(metadata.bookmarkId);
      removedBookmark = true;
    } catch (error) {
      // Missing Favorites must not prevent removing Ready's own data.
      const current = bookmarkMetadataForArticle(article, await chrome.bookmarks.getTree());
      if (current.bookmarkId) throw error;
    }
  }

  await db.transaction(
    "rw",
    [db.articles, db.readingHistory, db.annotations, db.sessions, db.ignoredRecommendations],
    async () => {
      const latest = await db.articles.get(articleId);
      if (!latest) throw new Error("The article no longer exists.");
      await archiveReadingHistory({ ...latest, bookmarkId: article.bookmarkId ?? latest.bookmarkId });
      await db.annotations.where("articleId").equals(articleId).delete();
      await db.ignoredRecommendations.where("articleId").equals(articleId).delete();
      await db.articles.delete(articleId);
    }
  );
  return removedBookmark;
}

async function activateLinkedArticle(fresh: Article): Promise<Article> {
  return db.transaction("rw", db.articles, db.readingHistory, async () => {
    const active = await db.articles.where("normalizedUrl").equals(fresh.normalizedUrl).first();
    if (active) return active;
    const archived = findReadingHistoryMatch(fresh, await db.readingHistory.toArray());
    if (!archived) {
      await db.articles.add(fresh);
      return fresh;
    }
    const { archivedAt: _archivedAt, ...history } = archived;
    const article: Article = {
      ...history,
      bookmarkId: fresh.bookmarkId,
      bookmarkState: "linked",
      title: fresh.title,
      originalUrl: fresh.originalUrl,
      normalizedUrl: fresh.normalizedUrl,
      domain: fresh.domain,
      tags: mergeTags(history.tags, fresh.tags ?? []),
      updatedAt: fresh.updatedAt
    };
    await db.articles.put(article);
    await restoreReadingHistory(article.id);
    return article;
  });
}

export async function markBookmarkOrphaned(bookmarkId: string): Promise<void> {
  const articles = await db.articles
    .where("bookmarkId")
    .equals(bookmarkId)
    .toArray();
  const updatedAt = Date.now();
  await db.articles.bulkPut(
    articles.map((article) => ({
      ...article,
      bookmarkId: undefined,
      bookmarkState: "orphaned" as const,
      updatedAt
    }))
  );
}

export async function findBookmarksByUrl(
  url: string
): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  const roots = await chrome.bookmarks.getTree();
  return flatten(roots).filter(
    (node) => node.url && urlsMatch(node.url, url)
  );
}

export async function findArticleByUrl(url: string): Promise<Article | undefined> {
  let normalized: string;
  try {
    normalized = normalizeUrl(url);
  } catch {
    return undefined;
  }
  return db.articles.where("normalizedUrl").equals(normalized).first();
}

function articleFromBookmark(
  bookmark: chrome.bookmarks.BookmarkTreeNode,
  fallbackTitle?: string,
  tags: string[] = []
): Article {
  if (!bookmark.url) throw new Error("Folders cannot become Ready articles.");
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    bookmarkId: bookmark.id,
    bookmarkState: "linked",
    originalUrl: bookmark.url,
    normalizedUrl: normalizeUrl(bookmark.url),
    title: bookmark.title || fallbackTitle || bookmark.url,
    domain: getDomain(bookmark.url),
    tags,
    originalSavedAt: bookmark.dateAdded ?? now,
    status: "unread",
    progress: 0,
    createdAt: now,
    updatedAt: now
  };
}

async function findArticleForBookmark(
  bookmark: chrome.bookmarks.BookmarkTreeNode
): Promise<Article | undefined> {
  const byId = await db.articles.where("bookmarkId").equals(bookmark.id).first();
  return byId ?? (bookmark.url ? findArticleByUrl(bookmark.url) : undefined);
}

async function inheritedBookmarkTags(): Promise<Map<string, string[]>> {
  const [tree, settings] = await Promise.all([
    chrome.bookmarks.getTree(),
    getBookmarkDestination()
  ]);
  return bookmarkTagsById(tree, settings.readyFolderId);
}

function flatten(
  nodes: chrome.bookmarks.BookmarkTreeNode[]
): chrome.bookmarks.BookmarkTreeNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.children ? flatten(node.children) : [])
  ]);
}

function toBookmarkNode(
  node: chrome.bookmarks.BookmarkTreeNode,
  linkedBookmarkIds: Set<string>,
  linkedUrls: Set<string>
): BookmarkNode {
  let linked = linkedBookmarkIds.has(node.id);
  if (!linked && node.url) {
    try {
      linked = linkedUrls.has(normalizeUrl(node.url));
    } catch {
      linked = false;
    }
  }
  return {
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    url: node.url,
    dateAdded: node.dateAdded,
    linked: node.url ? linked : undefined,
    children: node.children?.map((child) =>
      toBookmarkNode(child, linkedBookmarkIds, linkedUrls)
    )
  };
}
