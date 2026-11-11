import {
  getBookmarkTree,
  linkBookmarks,
  markBookmarkOrphaned,
  removeArticle,
  restoreBookmark,
  saveActivePage
} from "../browser/bookmarks";
import type { ReadyRequest, ReadyResponse } from "../browser/messages";
import { db } from "../db/database";
import type { Annotation, Article } from "../domain/types";
import { statusAfterActivity, transitionStatus } from "../domain/status";
import { normalizeUrl } from "../domain/url";

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.create({
    id: "ready-save-page",
    title: "Save page to Ready",
    contexts: ["page"]
  });
  chrome.contextMenus.create({
    id: "ready-save-selection",
    title: "Save selection to Ready",
    contexts: ["selection"]
  });
});

chrome.bookmarks.onRemoved.addListener((id) => {
  void markBookmarkOrphaned(id);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !info.menuItemId.toString().startsWith("ready-save")) return;
  void saveAndActivate(tab.id, tab.url, info.selectionText).catch(reportSaveError);
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "save-current-page") return;
  void saveActivePage().then(async ({ article }) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await ensureReadingLayer(tab.id, tab.url);
    await notify(article.title, "Saved to Ready");
  }).catch(reportSaveError);
});

function reportSaveError(error: unknown): void {
  console.error("Ready could not save the page.", error);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    void ensureReadingLayer(tabId, tab.url);
  }
});

chrome.runtime.onMessage.addListener(
  (
    request: ReadyRequest,
    _sender,
    sendResponse: (response: ReadyResponse) => void
  ) => {
    void handleMessage(request)
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unexpected Ready error."
        })
      );
    return true;
  }
);

async function handleMessage(request: ReadyRequest): Promise<ReadyResponse> {
  switch (request.type) {
    case "GET_BOOKMARK_TREE":
      return { ok: true, bookmarkTree: await getBookmarkTree() };
    case "LINK_BOOKMARKS":
      return {
        ok: true,
        linked: await linkBookmarks(request.bookmarkIds)
      };
    case "SAVE_ACTIVE_PAGE": {
      const result = await saveActivePage(request.folderId);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await ensureReadingLayer(tab.id, tab.url);
      return { ok: true, ...result };
    }
    case "RESTORE_BOOKMARK":
      return {
        ok: true,
        article: await restoreBookmark(request.articleId, request.folderId),
        createdBookmark: true
      };
    case "REMOVE_ARTICLE":
      return {
        ok: true,
        removedBookmark: await removeArticle(
          request.articleId,
          request.deleteBookmark
        )
      };
    case "OPEN_ARTICLE": {
      const article = await requireArticle(request.articleId);
      if (request.resume) {
        await chrome.storage.session.set({ [`resume:${article.id}`]: true });
      }
      await chrome.tabs.create({ url: article.originalUrl });
      return { ok: true };
    }
    case "GET_PAGE_DATA": {
      const article = await db.articles
        .where("normalizedUrl")
        .equals(normalizeUrl(request.url))
        .first();
      if (!article) {
        return { ok: true, annotations: [], shouldResume: false };
      }
      const resumeKey = `resume:${article.id}`;
      const resumeState = await chrome.storage.session.get(resumeKey);
      if (resumeState[resumeKey]) await chrome.storage.session.remove(resumeKey);
      return {
        ok: true,
        article,
        annotations: await db.annotations
          .where("articleId")
          .equals(article.id)
          .toArray(),
        shouldResume: Boolean(resumeState[resumeKey])
      };
    }
    case "SAVE_READING_UPDATE": {
      const article = await requireArticle(request.articleId);
      const now = Date.now();
      await db.articles.put({
        ...article,
        progress: Math.max(article.progress, clamp(request.progress)),
        position: request.position ?? article.position,
        status: statusAfterActivity(article.status, request.activeSeconds),
        lastReadAt: now,
        updatedAt: now
      });
      if (request.session) await db.sessions.put(request.session);
      return { ok: true };
    }
    case "CREATE_ANNOTATION": {
      await requireArticle(request.articleId);
      const now = Date.now();
      const annotation: Annotation = {
        id: crypto.randomUUID(),
        articleId: request.articleId,
        anchor: request.anchor,
        color: "yellow",
        note: request.note?.trim() || undefined,
        unresolved: false,
        createdAt: now,
        updatedAt: now
      };
      await db.annotations.add(annotation);
      return { ok: true, annotation };
    }
    case "UPDATE_ANNOTATION": {
      const annotation = await db.annotations.get(request.annotationId);
      if (!annotation) throw new Error("The annotation no longer exists.");
      const updated = {
        ...annotation,
        note: request.note?.trim() || undefined,
        unresolved: request.unresolved ?? annotation.unresolved,
        updatedAt: Date.now()
      };
      await db.annotations.put(updated);
      return { ok: true, annotation: updated };
    }
    case "DELETE_ANNOTATION":
      await db.annotations.delete(request.annotationId);
      return { ok: true };
    case "SET_STATUS": {
      const article = await requireArticle(request.articleId);
      await db.articles.update(article.id, {
        status: transitionStatus(article.status, request.status),
        updatedAt: Date.now()
      });
      return { ok: true };
    }
  }
}

async function saveAndActivate(
  tabId: number,
  url?: string,
  selectionText?: string
): Promise<void> {
  const { article } = await saveActivePage();
  await ensureReadingLayer(tabId, url);
  if (selectionText) {
    await chrome.tabs.sendMessage(tabId, {
      type: "READY_HIGHLIGHT_SELECTION",
      articleId: article.id
    });
  }
}

async function ensureReadingLayer(tabId: number, url?: string): Promise<void> {
  if (!url || !/^https?:/.test(url)) return;
  const article = await db.articles
    .where("normalizedUrl")
    .equals(normalizeUrl(url))
    .first();
  if (!article) return;

  const originPattern = `${new URL(url).origin}/*`;
  if (!(await chrome.permissions.contains({ origins: [originPattern] }))) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (error) {
    console.warn("Ready could not activate the reading layer.", error);
  }
}

async function requireArticle(id: string): Promise<Article> {
  const article = await db.articles.get(id);
  if (!article) throw new Error("The article no longer exists.");
  return article;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

async function notify(title: string, message: string): Promise<void> {
  console.info(`${message}: ${title}`);
}
