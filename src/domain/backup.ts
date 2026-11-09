import type {
  Annotation,
  Article,
  ImportPreview,
  ReadingSession,
  ReadyBackup
} from "./types";
import { getDomain, normalizeUrl } from "./url";
import { isReadingStatus } from "./status";

export function createBackup(
  articles: Article[],
  annotations: Annotation[],
  sessions: ReadingSession[]
): ReadyBackup {
  const articleIds = new Set(articles.map((article) => article.id));
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    articles: articles.map(({ bookmarkId: _bookmarkId, bookmarkState: _state, ...article }) => article),
    annotations: annotations.filter((item) => articleIds.has(item.articleId)),
    sessions: sessions.filter((item) => articleIds.has(item.articleId))
  };
}

export function previewImport(
  value: unknown,
  localArticles: Article[]
): ImportPreview {
  const errors = validateBackup(value);
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      newArticles: 0,
      mergedArticles: 0,
      orphanedArticles: 0
    };
  }

  const backup = value as ReadyBackup;
  const localUrls = new Set(localArticles.map((article) => article.normalizedUrl));
  const mergedArticles = backup.articles.filter((article) =>
    localUrls.has(article.normalizedUrl)
  ).length;

  return {
    valid: true,
    errors: [],
    newArticles: backup.articles.length - mergedArticles,
    mergedArticles,
    orphanedArticles: backup.articles.length,
    backup
  };
}

export function mergeImportedArticle(
  incoming: ReadyBackup["articles"][number],
  local?: Article,
  bookmarkId?: string
): Article {
  const incomingUrl = normalizeUrl(incoming.originalUrl);
  if (!local) {
    return {
      ...incoming,
      normalizedUrl: incomingUrl,
      domain: getDomain(incoming.originalUrl),
      bookmarkId,
      bookmarkState: bookmarkId ? "linked" : "orphaned"
    };
  }

  const newer = incoming.updatedAt > local.updatedAt ? incoming : local;
  return {
    ...local,
    ...newer,
    id: local.id,
    bookmarkId: local.bookmarkId ?? bookmarkId,
    bookmarkState: local.bookmarkId || bookmarkId ? "linked" : "orphaned",
    originalSavedAt: Math.min(local.originalSavedAt, incoming.originalSavedAt),
    createdAt: Math.min(local.createdAt, incoming.createdAt),
    updatedAt: Math.max(local.updatedAt, incoming.updatedAt)
  };
}

function validateBackup(value: unknown): string[] {
  if (!isRecord(value)) return ["Backup must be a JSON object."];
  const errors: string[] = [];
  if (value.schemaVersion !== 1) errors.push("Unsupported backup schema version.");
  if (!Array.isArray(value.articles)) {
    errors.push("Backup articles must be an array.");
  }
  if (!Array.isArray(value.annotations)) {
    errors.push("Backup annotations must be an array.");
  }
  if (!Array.isArray(value.sessions)) {
    errors.push("Backup sessions must be an array.");
  }
  if (errors.length > 0) return errors;

  const articles = value.articles as unknown[];
  for (const [index, article] of articles.entries()) {
    if (!isRecord(article)) {
      errors.push(`Article ${index + 1} must be an object.`);
      continue;
    }
    if (typeof article.id !== "string" || !article.id) {
      errors.push(`Article ${index + 1} has no valid ID.`);
    }
    if (typeof article.originalUrl !== "string") {
      errors.push(`Article ${index + 1} has no valid URL.`);
    } else {
      try {
        normalizeUrl(article.originalUrl);
      } catch {
        errors.push(`Article ${index + 1} has an invalid URL.`);
      }
    }
    if (!isReadingStatus(article.status)) {
      errors.push(`Article ${index + 1} has an invalid reading status.`);
    }
    if (
      typeof article.progress !== "number" ||
      article.progress < 0 ||
      article.progress > 1
    ) {
      errors.push(`Article ${index + 1} has invalid reading progress.`);
    }
  }

  const annotations = value.annotations as unknown[];
  for (const [index, annotation] of annotations.entries()) {
    if (
      !isRecord(annotation) ||
      typeof annotation.id !== "string" ||
      typeof annotation.articleId !== "string" ||
      !isTextAnchor(annotation.anchor)
    ) {
      errors.push(`Annotation ${index + 1} is invalid.`);
    }
  }

  const sessions = value.sessions as unknown[];
  for (const [index, session] of sessions.entries()) {
    if (
      !isRecord(session) ||
      typeof session.id !== "string" ||
      typeof session.articleId !== "string" ||
      !isFiniteNumber(session.startedAt) ||
      !isFiniteNumber(session.endedAt) ||
      !isFiniteNumber(session.activeSeconds)
    ) {
      errors.push(`Reading session ${index + 1} is invalid.`);
    }
  }
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextAnchor(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.exact === "string" &&
    typeof value.prefix === "string" &&
    typeof value.suffix === "string" &&
    isFiniteNumber(value.start) &&
    isFiniteNumber(value.end)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
