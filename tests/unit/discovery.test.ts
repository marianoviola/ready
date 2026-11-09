import { describe, expect, it } from "vitest";
import { rankRecommendations } from "../../src/domain/discovery";
import type { Article } from "../../src/domain/types";

const DAY = 86_400_000;
const now = new Date("2026-11-06T10:00:00Z").getTime();

function article(overrides: Partial<Article>): Article {
  return {
    id: crypto.randomUUID(),
    bookmarkState: "linked",
    originalUrl: "https://example.com/article",
    normalizedUrl: "https://example.com/article",
    title: "TypeScript browser architecture",
    domain: "example.com",
    originalSavedAt: now - 60 * DAY,
    status: "unread",
    progress: 0,
    createdAt: now - 60 * DAY,
    updatedAt: now - 60 * DAY,
    ...overrides
  };
}

describe("local discovery", () => {
  it("ranks forgotten and unfinished articles deterministically", () => {
    const forgotten = article({ id: "forgotten" });
    const unfinished = article({
      id: "continue",
      status: "in_progress",
      progress: 0.4,
      lastReadAt: now - 8 * DAY
    });
    const results = rankRecommendations([forgotten, unfinished], [], [], now);
    expect(results.map((item) => item.articleId)).toEqual(
      expect.arrayContaining(["continue", "forgotten"])
    );
    expect(
      results.find((item) => item.articleId === "continue")
    ).toMatchObject({ category: "continue", score: 72 });
  });

  it("does not repeatedly return recently ignored recommendations", () => {
    const forgotten = article({ id: "forgotten" });
    const results = rankRecommendations(
      [forgotten],
      [],
      [{ articleId: "forgotten", category: "forgotten", ignoredAt: now }],
      now
    );
    expect(results).toEqual([]);
  });
});
