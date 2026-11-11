export function normalizeTags(values: Iterable<string>): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const tag = value.trim();
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

export function mergeTags(
  existing: Iterable<string> = [],
  incoming: Iterable<string> = []
): string[] {
  return normalizeTags([...existing, ...incoming]);
}
