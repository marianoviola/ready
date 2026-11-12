import type { Source } from "./types";
import { getDomain, isScriptableUrl, normalizeUrl } from "./url";
import { normalizeTags } from "./tags";

export interface SourceInput {
  name: string;
  url: string;
  subscribed: boolean;
  note?: string;
  tags?: string[];
}

export function normalizeSourceUrl(value: string): string {
  const trimmed = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  if (!isScriptableUrl(candidate)) {
    throw new Error("Source URL must use http or https.");
  }
  return normalizeUrl(candidate);
}

export function sourceFromInput(
  input: SourceInput,
  existing?: Source,
  now = Date.now()
): Source {
  const normalizedUrl = normalizeSourceUrl(input.url);
  const name = input.name.trim() || getDomain(normalizedUrl);
  const note = input.note?.trim();

  return {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    url: normalizedUrl,
    normalizedUrl,
    domain: getDomain(normalizedUrl),
    subscribed: input.subscribed,
    tags: normalizeTags(input.tags ?? existing?.tags ?? []),
    note: note || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

export type SourceSort = "default" | "name" | "added" | "updated" | "articles";
export type SourceGrouping = "none" | "tag" | "subscription";
export type SubscriptionFilter = "all" | "subscribed" | "not-subscribed";

export function selectSources(
  sources: Source[],
  query: string,
  tag: string,
  subscription: SubscriptionFilter,
  sort: SourceSort,
  articleCounts: ReadonlyMap<string, number>
): Source[] {
  const search = query.trim().toLocaleLowerCase();
  return sources.filter((source) =>
    (!search || [source.name, source.domain, source.note ?? "", ...(source.tags ?? [])]
      .some((value) => value.toLocaleLowerCase().includes(search))) &&
    (!tag || source.tags?.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) &&
    (subscription === "all" || source.subscribed === (subscription === "subscribed"))
  ).sort((left, right) => {
    const primary = sort === "default"
      ? Number(right.subscribed) - Number(left.subscribed)
      : sort === "added" ? right.createdAt - left.createdAt
        : sort === "updated" ? right.updatedAt - left.updatedAt
          : sort === "articles"
            ? (articleCounts.get(right.domain) ?? 0) - (articleCounts.get(left.domain) ?? 0)
            : 0;
    return primary || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

export function groupSources(sources: Source[], grouping: SourceGrouping) {
  const groups = new Map<string, { key: string; label: string; sources: Source[] }>();
  for (const source of sources) {
    const tags = normalizeTags(source.tags ?? []);
    const keys = grouping === "none" ? [{ key: "all", label: "All sources" }]
      : grouping === "subscription"
        ? [{ key: source.subscribed ? "subscribed" : "not-subscribed", label: source.subscribed ? "Subscribed" : "Not subscribed" }]
        : tags.length ? tags.map((tag) => ({ key: `tag:${tag.toLocaleLowerCase()}`, label: tag }))
          : [{ key: "untagged", label: "Untagged" }];
    for (const { key, label } of keys) {
      const group = groups.get(key);
      if (group) group.sources.push(source);
      else groups.set(key, { key, label, sources: [source] });
    }
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}
