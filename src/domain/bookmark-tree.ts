import type { BookmarkNode } from "./types";

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
