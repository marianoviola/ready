import { useMemo, useState } from "react";
import { normalizeTags } from "../domain/tags";
import type { Article, Source } from "../domain/types";

interface TagDirectoryProps {
  scope: "library" | "sources";
  articles: Article[];
  sources: Source[];
  onSelectTag: (tag: string) => void;
}

export function TagDirectory({ scope, articles, sources, onSelectTag }: TagDirectoryProps) {
  const [query, setQuery] = useState("");
  const entries = useMemo(() => {
    const records = scope === "library" ? articles : sources;
    const counts = new Map<string, { tag: string; count: number }>();
    for (const record of records) {
      for (const tag of normalizeTags(record.tags ?? [])) {
        const key = tag.toLocaleLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count++;
        else counts.set(key, { tag, count: 1 });
      }
    }
    return [...counts.values()].sort((left, right) => left.tag.localeCompare(right.tag));
  }, [scope, articles, sources]);
  const filtered = entries.filter(({ tag }) => tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const singular = scope === "library" ? "article" : "source";

  return (
    <main className="panel-page">
      <div className="section-heading">
        <p className="eyebrow">{scope === "library" ? "Your library" : "Your sources"}</p>
        <h2>Tags</h2>
        <p className="muted">Browse {scope === "library" ? "article" : "source"} tags. Article and source tags are independent.</p>
      </div>
      <label className="search-box">
        <span className="sr-only">Search tags</span>
        <input type="search" placeholder="Search tags" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {filtered.length ? <div className="tag-directory">
        {filtered.map(({ tag, count }) => <div className="tag-directory-item" key={tag.toLocaleLowerCase()}>
          <span>{tag}</span>
          <div className="tag-directory-counts">
            <button type="button" className="count" aria-label={`View ${singular === "article" ? "articles" : "sources"} tagged ${tag}`} onClick={() => onSelectTag(tag)}>
              {count} {singular}{count === 1 ? "" : "s"}
            </button>
          </div>
        </div>)}
      </div> : <div className="empty-state">
        <h2>{entries.length ? "No tags match" : "No tags yet"}</h2>
        <p>{entries.length ? "Try a different search." : `Add tags to ${scope === "library" ? "an article" : "a source"} to see them here.`}</p>
      </div>}
    </main>
  );
}
