import { normalizeTags } from "./tags";
import type { Article, ReadingSession, ReadingStatus } from "./types";

export interface ReadingActivity {
  key: string;
  label: string;
  activeSeconds: number;
}

export interface DailyReadingActivity {
  date: Date;
  activeSeconds: number;
}

export interface ReadingStats {
  totalActiveSeconds: number;
  currentCounts: Record<ReadingStatus, number>;
  recordedReads: number;
  archivedReadCount: number;
  archivedArticles: Article[];
  dailyActivity: DailyReadingActivity[];
  domains: ReadingActivity[];
  tags: ReadingActivity[];
}

/**
 * Session timing within its start and end is unavailable. Attribute each
 * session to its local end date rather than inventing a midnight split.
 */
export function calculateReadingStats(
  articles: readonly Article[],
  sessions: readonly ReadingSession[],
  now = Date.now(),
  history: readonly Article[] = []
): ReadingStats {
  const currentCounts: Record<ReadingStatus, number> = {
    read: 0,
    in_progress: 0,
    unread: 0
  };
  const activeArticles = new Map(articles.map((article) => [article.id, article]));
  const archivedById = new Map(history.filter((article) => !activeArticles.has(article.id)).map((article) => [article.id, article]));
  const articlesById = new Map(archivedById);
  for (const article of activeArticles.values()) {
    articlesById.set(article.id, article);
    if (article.status in currentCounts) currentCounts[article.status]++;
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dailyActivity = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return { date, activeSeconds: 0 };
  });
  const domains = new Map<string, ReadingActivity>();
  const tags = new Map<string, ReadingActivity>();
  let totalActiveSeconds = 0;
  const seenSessions = new Set<string>();

  for (const session of sessions) {
    const article = articlesById.get(session.articleId);
    if (
      !article ||
      seenSessions.has(session.id) ||
      !Number.isFinite(session.activeSeconds) ||
      session.activeSeconds <= 0 ||
      !Number.isFinite(session.startedAt) ||
      !Number.isFinite(session.endedAt) ||
      !Number.isFinite(new Date(session.startedAt).getTime()) ||
      !Number.isFinite(new Date(session.endedAt).getTime()) ||
      session.startedAt > session.endedAt ||
      session.endedAt > now
    ) continue;
    seenSessions.add(session.id);
    const seconds = session.activeSeconds;
    totalActiveSeconds += seconds;

    const end = new Date(session.endedAt);
    end.setHours(0, 0, 0, 0);
    const day = dailyActivity.find((entry) => entry.date.getTime() === end.getTime());
    if (day) day.activeSeconds += seconds;

    const domain = article.domain.trim();
    addActivity(domains, domain ? `domain:${domain.toLocaleLowerCase()}` : "unknown", domain || "Unknown domain", seconds);
    const articleTags = normalizeTags(article.tags ?? []);
    if (articleTags.length === 0) {
      addActivity(tags, "untagged", "No tags (untagged)", seconds);
    } else {
      for (const tag of articleTags) {
        addActivity(tags, `tag:${tag.toLocaleLowerCase()}`, tag, seconds);
      }
    }
  }

  const sorted = (groups: Map<string, ReadingActivity>) =>
    [...groups.values()].sort((a, b) =>
      b.activeSeconds - a.activeSeconds || a.label.localeCompare(b.label) || a.key.localeCompare(b.key)
    );
  return {
    totalActiveSeconds,
    currentCounts,
    archivedReadCount: [...archivedById.values()].filter((article) => article.status === "read").length,
    recordedReads: [...articlesById.values()].filter((article) => article.status === "read").length,
    archivedArticles: [...archivedById.values()],
    dailyActivity,
    domains: sorted(domains),
    tags: sorted(tags)
  };
}

function addActivity(
  groups: Map<string, ReadingActivity>,
  key: string,
  label: string,
  activeSeconds: number
): void {
  const group = groups.get(key);
  if (group) group.activeSeconds += activeSeconds;
  else groups.set(key, { key, label, activeSeconds });
}
