import { db } from "../db/database";
import { bookmarkTagsById } from "../domain/bookmark-tree";
import { mergeTags } from "../domain/tags";
import type { Article, BookmarkNode } from "../domain/types";
import { getDomain, normalizeUrl, urlsMatch } from "../domain/url";

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
  const tagsByBookmarkId = bookmarkTagsById(await chrome.bookmarks.getTree());
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

    await db.articles.add(articleFromBookmark(bookmark, undefined, inheritedTags));
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
      parentId: folderId,
      title: tab.title || tab.url,
      url: tab.url
    }));

  const article = articleFromBookmark(bookmark, tab.title);
  await db.articles.add(article);
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
      parentId: folderId,
      title: article.title,
      url: article.originalUrl
    }));

  const updated: Article = {
    ...article,
    bookmarkId: bookmark.id,
    bookmarkState: "linked",
    updatedAt: Date.now()
  };
  await db.articles.put(updated);
  return updated;
}

export async function removeArticle(
  articleId: string,
  deleteBookmark: boolean
): Promise<boolean> {
  const article = await db.articles.get(articleId);
  if (!article) throw new Error("The article no longer exists.");

  let removedBookmark = false;
  if (deleteBookmark && article.bookmarkId) {
    const referenceCount = await db.articles
      .where("bookmarkId")
      .equals(article.bookmarkId)
      .count();
    if (referenceCount > 1) {
      throw new Error(
        "This Favorite is linked to another Ready article and was not deleted."
      );
    }
    await chrome.bookmarks.remove(article.bookmarkId);
    removedBookmark = true;
  }

  await db.transaction(
    "rw",
    [db.articles, db.annotations, db.sessions, db.ignoredRecommendations],
    async () => {
      await db.annotations.where("articleId").equals(articleId).delete();
      await db.sessions.where("articleId").equals(articleId).delete();
      await db.ignoredRecommendations.where("articleId").equals(articleId).delete();
      await db.articles.delete(articleId);
    }
  );
  return removedBookmark;
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
