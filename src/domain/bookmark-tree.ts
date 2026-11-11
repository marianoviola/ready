import type { BookmarkNode } from "./types";
import { normalizeTags } from "./tags";

export type BookmarkLinkFilter = "unlinked" | "linked" | "all";

export function bookmarkMatchesFilter(
  node: BookmarkNode,
  filter: BookmarkLinkFilter
): boolean {
  if (!node.url) return false;
  if (filter === "all") return true;
  return filter === "linked" ? node.linked === true : node.linked !== true;
}

export function hasMatchingBookmarks(
  node: BookmarkNode,
  filter: BookmarkLinkFilter
): boolean {
  return node.url
    ? bookmarkMatchesFilter(node, filter)
    : node.children?.some((child) => hasMatchingBookmarks(child, filter)) ?? false;
}

export function selectableBookmarkIds(
  node: BookmarkNode,
  filter: BookmarkLinkFilter = "all"
): string[] {
  if (node.url) {
    return !node.linked && filter !== "linked" ? [node.id] : [];
  }
  return node.children?.flatMap((child) =>
    selectableBookmarkIds(child, filter)
  ) ?? [];
}

export function bookmarkTagsById(nodes: BookmarkNode[]): Map<string, string[]> {
  const tagsById = new Map<string, string[]>();

  function visit(node: BookmarkNode, inheritedTags: string[], depth: number) {
    const tags =
      !node.url && depth >= 2
        ? normalizeTags([...inheritedTags, node.title])
        : inheritedTags;

    if (node.url) {
      tagsById.set(node.id, [...inheritedTags]);
    }
    for (const child of node.children ?? []) {
      visit(child, tags, depth + 1);
    }
  }

  for (const node of nodes) {
    visit(node, [], 0);
  }
  return tagsById;
}
