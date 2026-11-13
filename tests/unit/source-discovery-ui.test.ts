import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/database";
import type { Article, Source } from "../../src/domain/types";
import { SourceDiscover } from "../../src/sidebar/SourceDiscover";
import { TagDirectory } from "../../src/sidebar/TagDirectory";

const article: Article = {
  id: "a", originalUrl: "https://example.com/story", normalizedUrl: "https://example.com/story",
  title: "Story", domain: "example.com", bookmarkState: "orphaned", tags: ["Tech", "tech"],
  originalSavedAt: 1, status: "unread", progress: 0, createdAt: 1, updatedAt: 1
};
const source: Source = {
  id: "s", name: "Other", url: "https://other.example/", normalizedUrl: "https://other.example/",
  domain: "other.example", tags: ["News"], subscribed: false, createdAt: 1, updatedAt: 1
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("source discovery UI", () => {
  it("uses source controls without subscription controls and confirms suggested tags before saving", async () => {
    let notifyChanged!: () => void;
    const savedPromise = new Promise<void>((resolve) => { notifyChanged = resolve; });
    const changed = vi.fn(async () => { notifyChanged(); });
    await act(async () => root.render(createElement(SourceDiscover, {
      articles: [article], sources: [], availableTags: ["Tech"],
      onChanged: changed, onViewArticles: vi.fn()
    })));
    expect(container.querySelector('input[placeholder="Search suggested sources"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Subscription"]')).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("1 saved article");
    const add = [...container.querySelectorAll("button")].find((button) => button.textContent === "Add source");
    await act(async () => add?.click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Selected tags"]')?.textContent).not.toContain("Tech");
    expect(container.querySelector('[aria-label="Existing tags"]')?.textContent).toContain("Tech");
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await savedPromise;
    });
    const saved = await db.sources.where("domain").equals("example.com").first();
    expect(saved).toMatchObject({ domain: "example.com", subscribed: false, tags: [] });
    expect(changed).toHaveBeenCalledOnce();
    if (saved) await db.sources.delete(saved.id);
  });

  it("keeps directory counts scoped and invokes selection without navigation", async () => {
    const select = vi.fn();
    await act(async () => root.render(createElement(TagDirectory, {
      scope: "library", articles: [article], sources: [source], onSelectTag: select
    })));
    expect(container.textContent).toContain("1 article");
    expect(container.textContent).not.toContain("News");
    const search = container.querySelector<HTMLInputElement>('input[placeholder="Search tags"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "missing");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("No tags match");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector<HTMLButtonElement>(".tag-directory button")?.click());
    expect(select).toHaveBeenCalledWith("Tech");
    await act(async () => root.render(createElement(TagDirectory, {
      scope: "sources", articles: [article], sources: [source], onSelectTag: select
    })));
    expect(container.textContent).toContain("1 source");
    expect(container.textContent).not.toContain("Tech");
  });
});
