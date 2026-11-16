import { getDomain } from "tldts";

const FAMILY_PREFIX = "family:";

export function websiteFamilies(domains: string[]) {
  const families = new Map<string, string[]>();
  for (const domain of [...new Set(domains)].sort()) {
    const root = getDomain(domain, { allowPrivateDomains: true }) ?? domain;
    const members = families.get(root) ?? [];
    members.push(domain);
    families.set(root, members);
  }
  return [...families].sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, members]) => ({ domain, members, value: `${FAMILY_PREFIX}${domain}` }));
}

export function matchesWebsite(domain: string, filter: string): boolean {
  if (filter === "all") return true;
  if (!filter.startsWith(FAMILY_PREFIX)) return domain === filter;
  const root = filter.slice(FAMILY_PREFIX.length);
  return (getDomain(domain, { allowPrivateDomains: true }) ?? domain) === root;
}

export function reconcileWebsiteFilter(domains: string[], filter: string): string {
  return filter === "all" || domains.some((domain) => matchesWebsite(domain, filter)) ? filter : "all";
}
