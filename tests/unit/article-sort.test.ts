import { describe, expect, it } from "vitest";
import { articleActivityAt, compareArticles } from "../../src/domain/article-sort";
import type { Article } from "../../src/domain/types";

function article(id: string, values: Partial<Article>): Article {
  return {
    id,
    bookmarkState: "linked",
    originalUrl: `https://example.com/${id}`,
    normalizedUrl: `https://example.com/${id}`,
    title: id,
    domain: "example.com",
    originalSavedAt: 100,
    status: "unread",
    progress: 0,
    createdAt: 100,
    updatedAt: 100,
    ...values
  };
}

describe("article sorting", () => {
  it("uses the latest meaningful timestamp for activity", () => {
    expect(
      articleActivityAt(
        article("active", {
          originalSavedAt: 100,
          createdAt: 200,
          updatedAt: 300,
          lastReadAt: 250
        })
      )
    ).toBe(300);
  });

  it("puts recently saved unread articles ahead in activity order", () => {
    const recentlySaved = article("recent", {
      originalSavedAt: 500,
      createdAt: 500,
      updatedAt: 500
    });
    const previouslyRead = article("read", {
      originalSavedAt: 100,
      createdAt: 100,
      updatedAt: 100,
      lastReadAt: 400
    });

    expect([previouslyRead, recentlySaved].sort((left, right) =>
      compareArticles(left, right, "activity")
    )).toEqual([recentlySaved, previouslyRead]);
  });

  it("sorts date added independently from later activity", () => {
    const older = article("older", {
      originalSavedAt: 100,
      updatedAt: 900
    });
    const newer = article("newer", {
      originalSavedAt: 500,
      updatedAt: 500
    });

    expect([older, newer].sort((left, right) =>
      compareArticles(left, right, "added")
    )).toEqual([newer, older]);
  });
});
