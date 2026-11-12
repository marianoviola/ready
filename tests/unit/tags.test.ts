import { describe, expect, it } from "vitest";
import { bookmarkTagsById } from "../../src/domain/bookmark-tree";
import { mergeTags, normalizeTags } from "../../src/domain/tags";
import type { BookmarkNode } from "../../src/domain/types";
import { tagsWithQuery } from "../../src/sidebar/TagPicker";

describe("tags", () => {
  it("saves pending tag input with shared spelling without duplicates", () => {
    expect(tagsWithQuery(["Personal"], ["Research"], " research ")).toEqual(["Personal", "Research"]);
    expect(tagsWithQuery(["Research"], ["Research"], "research")).toEqual(["Research"]);
    expect(tagsWithQuery([], [], " New tag ")).toEqual(["New tag"]);
    expect(tagsWithQuery(["Research"], [], " ")).toEqual(["Research"]);
  });

  it("normalizes and merges tags without replacing manual values", () => {
    expect(normalizeTags([" Research ", "", "research", "TypeScript"])).toEqual([
      "Research",
      "TypeScript"
    ]);
    expect(mergeTags(["Personal"], ["Research", "personal"])).toEqual([
      "Personal",
      "Research"
    ]);
  });

  it("derives tags from user folders while excluding browser roots", () => {
    const tree: BookmarkNode[] = [
      {
        id: "root",
        title: "",
        children: [
          {
            id: "toolbar",
            parentId: "root",
            title: "Favorites bar",
            children: [
              {
                id: "research",
                parentId: "toolbar",
                title: "Research",
                children: [
                  {
                    id: "frontend",
                    parentId: "research",
                    title: "Frontend",
                    children: [
                      {
                        id: "article",
                        parentId: "frontend",
                        title: "Article",
                        url: "https://example.com/article"
                      }
                    ]
                  }
                ]
              },
              {
                id: "direct",
                parentId: "toolbar",
                title: "Direct bookmark",
                url: "https://example.com/direct"
              }
            ]
          }
        ]
      }
    ];

    const tags = bookmarkTagsById(tree);
    expect(tags.get("article")).toEqual(["Research", "Frontend"]);
    expect(tags.get("direct")).toEqual([]);
  });
});
