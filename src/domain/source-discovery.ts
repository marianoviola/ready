import { normalizeTags } from "./tags";
import type { Article, Source } from "./types";
import { getDomain, isScriptableUrl } from "./url";

export interface SourceCandidate {
  domain: string;
  url: string;
  articleCount: number;
  suggestedTags: string[];
  createdAt: number;
  updatedAt: number;
}

export function sourceDomain(source: Source): string {
  try {
    return getDomain(source.url);
  } catch {
    return source.domain.trim().toLowerCase().replace(/^www\./, "");
  }
}

export function discoverSources(articles: Article[], sources: Source[]): SourceCandidate[] {
  const savedDomains = new Set(sources.map(sourceDomain));
  const candidates = new Map<string, SourceCandidate>();

  for (const article of articles) {
    if (!isScriptableUrl(article.originalUrl)) continue;
    const url = new URL(article.originalUrl);
    const domain = getDomain(url.href);
    if (savedDomains.has(domain)) continue;
    let candidate = candidates.get(domain);
    if (!candidate) {
      candidate = {
        domain,
        url: `${url.origin}/`,
        articleCount: 0,
        suggestedTags: [],
        createdAt: article.originalSavedAt,
        updatedAt: article.updatedAt
      };
      candidates.set(domain, candidate);
    }
    candidate.articleCount++;
    candidate.suggestedTags = normalizeTags([...candidate.suggestedTags, ...(article.tags ?? [])]);
    candidate.createdAt = Math.max(candidate.createdAt, article.originalSavedAt);
    candidate.updatedAt = Math.max(candidate.updatedAt, article.updatedAt);
  }

  return [...candidates.values()].sort((left, right) => left.domain.localeCompare(right.domain));
}
