import type {
  Annotation,
  Article,
  ImportPreview,
  ReadingSession,
  ReadyBackup,
  Source
} from "./types";
import { getDomain, normalizeUrl } from "./url";
import { isReadingStatus } from "./status";

export function createBackup(
  articles: Article[],
  annotations: Annotation[],
  sessions: ReadingSession[],
  sources: Source[] = []
): ReadyBackup {
  const articleIds = new Set(articles.map((article) => article.id));
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    articles: articles.map(({ bookmarkId: _bookmarkId, bookmarkState: _state, ...article }) => article),
    annotations: annotations.filter((item) => articleIds.has(item.articleId)),
    sessions: sessions.filter((item) => articleIds.has(item.articleId)),
    sources
  };
}

export function previewImport(
  value: unknown,
  localArticles: Article[],
  localSources: Source[] = []
): ImportPreview {
  const errors = validateBackup(value);
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      newArticles: 0,
      mergedArticles: 0,
      orphanedArticles: 0,
      newSources: 0,
      mergedSources: 0
    };
  }

  const backup = upgradeBackup(value);
  const localUrls = new Set(localArticles.map((article) => article.normalizedUrl));
  const localSourceUrls = new Set(
    localSources.map((source) => source.normalizedUrl)
  );
  const mergedArticles = backup.articles.filter((article) =>
    localUrls.has(article.normalizedUrl)
  ).length;
  const mergedSources = backup.sources.filter((source) =>
    localSourceUrls.has(source.normalizedUrl)
  ).length;

  return {
    valid: true,
    errors: [],
    newArticles: backup.articles.length - mergedArticles,
    mergedArticles,
    orphanedArticles: backup.articles.length,
    newSources: backup.sources.length - mergedSources,
    mergedSources,
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

export function mergeImportedSource(
  incoming: Source,
  local?: Source
): Source {
  if (!local) return incoming;
  const newer = incoming.updatedAt > local.updatedAt ? incoming : local;
  return {
    ...local,
    ...newer,
    id: local.id,
    createdAt: Math.min(local.createdAt, incoming.createdAt),
    updatedAt: Math.max(local.updatedAt, incoming.updatedAt)
  };
}

function validateBackup(value: unknown): string[] {
  if (!isRecord(value)) return ["Backup must be a JSON object."];
  const errors: string[] = [];
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    errors.push("Unsupported backup schema version.");
  }
  if (!Array.isArray(value.articles)) {
    errors.push("Backup articles must be an array.");
  }
  if (!Array.isArray(value.annotations)) {
    errors.push("Backup annotations must be an array.");
  }
  if (!Array.isArray(value.sessions)) {
    errors.push("Backup sessions must be an array.");
  }
  if (value.schemaVersion === 2 && !Array.isArray(value.sources)) {
    errors.push("Backup sources must be an array.");
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

  const sources = value.schemaVersion === 2
    ? value.sources as unknown[]
    : [];
  for (const [index, source] of sources.entries()) {
    if (
      !isRecord(source) ||
      typeof source.id !== "string" ||
      typeof source.name !== "string" ||
      typeof source.url !== "string" ||
      typeof source.normalizedUrl !== "string" ||
      typeof source.domain !== "string" ||
      typeof source.subscribed !== "boolean" ||
      !isFiniteNumber(source.createdAt) ||
      !isFiniteNumber(source.updatedAt)
    ) {
      errors.push(`Source ${index + 1} is invalid.`);
      continue;
    }
    try {
      const normalized = normalizeUrl(source.url);
      if (normalized !== source.normalizedUrl) {
        errors.push(`Source ${index + 1} has inconsistent URL data.`);
      }
    } catch {
      errors.push(`Source ${index + 1} has an invalid URL.`);
    }
  }
  return errors;
}

function upgradeBackup(value: unknown): ReadyBackup {
  const backup = value as {
    schemaVersion: 1 | 2;
    exportedAt: string;
    articles: ReadyBackup["articles"];
    annotations: Annotation[];
    sessions: ReadingSession[];
    sources?: Source[];
  };
  return {
    schemaVersion: 2,
    exportedAt: backup.exportedAt,
    articles: backup.articles,
    annotations: backup.annotations,
    sessions: backup.sessions,
    sources: backup.sources ?? []
  };
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
