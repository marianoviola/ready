import type { Article } from "./types";

export type ArticleSort = "added" | "activity";

export function articleActivityAt(article: Article): number {
  return Math.max(
    article.originalSavedAt,
    article.createdAt,
    article.updatedAt,
    article.lastReadAt ?? 0
  );
}

export function compareArticles(
  left: Article,
  right: Article,
  sort: ArticleSort
): number {
  const leftTimestamp =
    sort === "added" ? left.originalSavedAt : articleActivityAt(left);
  const rightTimestamp =
    sort === "added" ? right.originalSavedAt : articleActivityAt(right);

  return (
    rightTimestamp - leftTimestamp ||
    right.originalSavedAt - left.originalSavedAt ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}
