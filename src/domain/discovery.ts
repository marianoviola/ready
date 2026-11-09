import type {
  Annotation,
  Article,
  IgnoredRecommendation,
  Recommendation
} from "./types";

const DAY = 86_400_000;

export function rankRecommendations(
  articles: Article[],
  annotations: Annotation[],
  ignored: IgnoredRecommendation[],
  now = Date.now()
): Recommendation[] {
  const recentCutoff = now - 30 * DAY;
  const ignoredKeys = new Set(
    ignored
      .filter((entry) => entry.ignoredAt > now - 90 * DAY)
      .map((entry) => `${entry.articleId}:${entry.category}`)
  );
  const recent = articles.filter(
    (article) => (article.lastReadAt ?? 0) >= recentCutoff
  );
  const recentKeywords = new Set(recent.flatMap((article) => keywords(article.title)));
  const annotationCounts = new Map<string, number>();
  for (const annotation of annotations) {
    annotationCounts.set(
      annotation.articleId,
      (annotationCounts.get(annotation.articleId) ?? 0) + 1
    );
  }

  const recommendations: Recommendation[] = [];
  for (const article of articles) {
    const ageDays = (now - article.originalSavedAt) / DAY;
    const idleDays = (now - (article.lastReadAt ?? article.originalSavedAt)) / DAY;

    if (
      article.status === "unread" &&
      ageDays >= 30 &&
      !ignoredKeys.has(`${article.id}:forgotten`)
    ) {
      recommendations.push({
        articleId: article.id,
        category: "forgotten",
        score: Math.min(100, 30 + ageDays / 2),
        reason: `Saved ${Math.floor(ageDays)} days ago and still unread`
      });
    }

    if (
      article.status === "in_progress" &&
      idleDays >= 3 &&
      !ignoredKeys.has(`${article.id}:continue`)
    ) {
      recommendations.push({
        articleId: article.id,
        category: "continue",
        score: 60 + Math.min(30, idleDays) + article.progress * 10,
        reason: `${Math.round(article.progress * 100)}% read, last opened ${Math.floor(idleDays)} days ago`
      });
    }

    if (
      !recent.includes(article) &&
      recentKeywords.size > 0 &&
      !ignoredKeys.has(`${article.id}:related`)
    ) {
      const overlap = keywords(article.title).filter((word) =>
        recentKeywords.has(word)
      ).length;
      const sameDomain = recent.some((item) => item.domain === article.domain);
      if (overlap > 0 || sameDomain) {
        recommendations.push({
          articleId: article.id,
          category: "related",
          score:
            overlap * 20 +
            (sameDomain ? 15 : 0) +
            Math.min(10, annotationCounts.get(article.id) ?? 0),
          reason: sameDomain
            ? `From ${article.domain}, related to recent reading`
            : "Shares topics with recent reading"
        });
      }
    }
  }

  return recommendations
    .sort((left, right) => right.score - left.score)
    .filter(
      (item, index, all) =>
        all.findIndex((other) => other.articleId === item.articleId) === index
    )
    .slice(0, 12);
}

function keywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "from",
  "into",
  "that",
  "their",
  "this",
  "with",
  "your"
]);
