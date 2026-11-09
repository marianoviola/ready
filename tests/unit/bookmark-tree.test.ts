import { describe, expect, it } from "vitest";
import {
  bookmarkMatchesFilter,
  hasMatchingBookmarks,
  selectableBookmarkIds
} from "../../src/domain/bookmark-tree";
import type { BookmarkNode } from "../../src/domain/types";

const folder: BookmarkNode = {
  id: "folder",
  title: "Reading",
  children: [
    { id: "new", title: "New article", url: "https://example.com/new" },
    {
      id: "nested",
      title: "Nested",
      children: [
        {
          id: "linked",
          title: "Linked article",
          url: "https://example.com/linked",
          linked: true
        },
        { id: "other", title: "Other article", url: "https://example.com/other" }
      ]
    }
  ]
};

describe("bookmark tree linking", () => {
  it("selects every unlinked descendant of a parent folder", () => {
    expect(selectableBookmarkIds(folder)).toEqual(["new", "other"]);
    expect(selectableBookmarkIds(folder, "linked")).toEqual([]);
  });

  it("filters linked and unlinked Favorites independently", () => {
    expect(hasMatchingBookmarks(folder, "linked")).toBe(true);
    expect(hasMatchingBookmarks(folder, "unlinked")).toBe(true);
    expect(bookmarkMatchesFilter(folder.children![0], "linked")).toBe(false);
    expect(
      bookmarkMatchesFilter(folder.children![1].children![0], "linked")
    ).toBe(true);
  });
});
