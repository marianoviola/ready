import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/database";
import type { Article, Source } from "../../src/domain/types";
import { SourceDiscover } from "../../src/sidebar/SourceDiscover";
import { TagDirectory } from "../../src/sidebar/TagDirectory";
import { FeedbackProvider } from "../../src/sidebar/Feedback";
import { SourcesPanel } from "../../src/sidebar/SourcesPanel";

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
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }) },
    close: { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }) }
  });
  Object.defineProperties(HTMLElement.prototype, {
    showPopover: { configurable: true, value: vi.fn() },
    hidePopover: { configurable: true, value: vi.fn() }
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
  Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
  vi.unstubAllGlobals();
});

describe("source discovery UI", () => {
  it("confirms source removal inside Ready, supports cancellation and retries failures without removing articles", async () => {
    const changed = vi.fn(async () => {});
    const remove = vi.spyOn(db.sources, "delete").mockRejectedValueOnce(new Error("Storage unavailable.")).mockResolvedValue();
    const articleDelete = vi.spyOn(db.articles, "delete");
    const render = () => createElement(FeedbackProvider, null, createElement(SourcesPanel, {
      articles: [article], sources: [source], availableTags: ["News"], initialTag: "",
      onChanged: changed, onViewArticles: vi.fn()
    }));
    await act(async () => root.render(render()));
    async function openRemoval() {
      await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Actions for source Other"]')!.click());
      await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .find((button) => button.textContent === "Remove")!.click());
    }
    await openRemoval();
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.querySelector("dialog")?.textContent).toContain("Edge Favorites are kept");
    expect(remove).not.toHaveBeenCalled();
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("dialog button")]
      .find((button) => button.textContent === "Cancel")!.click());
    expect(container.querySelector("dialog")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    await openRemoval();
    await act(async () => container.querySelector<HTMLButtonElement>("dialog .danger")!.click());
    expect(container.querySelector('dialog [role="alert"]')?.textContent).toBe("Storage unavailable.");
    expect(changed).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>("dialog .danger")!.click();
      container.querySelector<HTMLButtonElement>("dialog .danger")!.click();
    });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenLastCalledWith(source.id);
    expect(changed).toHaveBeenCalledOnce();
    expect(articleDelete).not.toHaveBeenCalled();
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("uses source controls without subscription controls and confirms suggested tags before saving", async () => {
    let notifyChanged!: () => void;
    const savedPromise = new Promise<void>((resolve) => { notifyChanged = resolve; });
    const changed = vi.fn(async () => { notifyChanged(); });
    await act(async () => root.render(createElement(FeedbackProvider, null, createElement(SourceDiscover, {
      articles: [article], sources: [], availableTags: ["Tech"],
      onChanged: changed, onViewArticles: vi.fn()
    }))));
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
