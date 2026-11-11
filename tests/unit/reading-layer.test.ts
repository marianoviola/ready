import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadyRequest, ReadyResponse } from "../../src/browser/messages";
import type { Article } from "../../src/domain/types";

const article: Article = {
  id: "article-1", title: "Test article", domain: "example.com",
  originalUrl: "https://example.com", normalizedUrl: "https://example.com",
  bookmarkState: "linked", status: "unread", progress: 0,
  originalSavedAt: 1, createdAt: 1, updatedAt: 1
};
let roots: ShadowRoot[];
let runtime: {
  id: string | undefined;
  sendMessage: ReturnType<typeof vi.fn>;
  onMessage: { addListener: ReturnType<typeof vi.fn>; removeListener: ReturnType<typeof vi.fn> };
};
let highlights: Map<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  roots = [];
  delete window.__readyReadingLayer;
  document.body.innerHTML = "<p>A selected passage for a private reading note.</p>";
  highlights = new Map();
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal("Highlight", class { constructor(..._ranges: Range[]) {} });
  runtime = {
    id: "ready-test",
    sendMessage: vi.fn(async (request: ReadyRequest): Promise<ReadyResponse> => {
      if (request.type === "GET_PAGE_DATA") {
        return { ok: true, article, annotations: [], shouldResume: false };
      }
      if (request.type === "CREATE_ANNOTATION") {
        return { ok: true, annotation: {
          id: "annotation-1", articleId: request.articleId, anchor: request.anchor,
          color: "yellow", note: request.note, unresolved: false, createdAt: 1, updatedAt: 1
        } };
      }
      return { ok: true };
    }),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() }
  };
  vi.stubGlobal("chrome", { runtime });
  const attachShadow = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (this: HTMLElement, init) {
    const root = attachShadow.call(this, init);
    roots.push(root);
    return root;
  });
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() =>
    Object.assign(createRange(), { getBoundingClientRect: () => new DOMRect(100, 100, 200, 20) })
  );
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(window, "prompt").mockReturnValue("My private note");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  document.dispatchEvent(new Event("ready:dispose-reading-layer"));
  document.querySelectorAll("[data-ready-ui]").forEach((host) => host.remove());
  document.getSelection()?.removeAllRanges();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__readyReadingLayer;
});

async function initialize(): Promise<void> {
  await import("../../src/content/index");
  await vi.advanceTimersByTimeAsync(0);
}

async function selectPassage(): Promise<void> {
  const text = document.querySelector("p")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 2);
  range.setEnd(text, 18);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  await vi.advanceTimersByTimeAsync(1);
}

function click(action: string): void {
  const button = roots.at(-1)?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  expect(button).toBeTruthy();
  button!.click();
}

describe("reading annotations and context lifecycle", () => {
  it.each(["highlight", "note"])("saves a %s with its selected passage", async (action) => {
    await initialize();
    await selectPassage();
    click(action);
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "CREATE_ANNOTATION", articleId: article.id,
      anchor: expect.objectContaining({ exact: "selected passage" }),
      note: action === "note" ? "My private note" : undefined
    }));
    expect(highlights.has("ready-annotations")).toBe(true);
    expect(roots[0].querySelector('[role="toolbar"]')).toBeNull();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("preserves selection on toolbar mousedown and cancels notes without saving", async () => {
    await initialize();
    await selectPassage();
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    roots[0].querySelector("button")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    vi.mocked(window.prompt).mockReturnValue(null);
    click("note");
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(roots[0].querySelector('[role="toolbar"]')).not.toBeNull();
  });

  it.each(["highlight", "note"])("replaces a stale %s toolbar with one recovery notice", async (action) => {
    await initialize();
    await selectPassage();
    runtime.id = undefined;
    click(action);
    await vi.advanceTimersByTimeAsync(1);
    expect(roots.at(-1)?.querySelector('[role="alert"]')?.textContent).toContain("Reload this page");
    expect(roots.at(-1)?.textContent).toContain("Reload page");
    expect(document.querySelectorAll("[data-ready-ui]")).toHaveLength(1);
    expect(window.__readyReadingLayer).toBe(false);
    expect(window.prompt).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    const calls = runtime.sendMessage.mock.calls.length;
    await selectPassage();
    window.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("pagehide"));
    document.body.append(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runtime.sendMessage).toHaveBeenCalledTimes(calls);
    expect(roots.at(-1)?.querySelector('[role="toolbar"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles context invalidation during a send without leaving unhandled rejections", async () => {
    await initialize();
    await selectPassage();
    runtime.sendMessage.mockRejectedValueOnce(new Error("Extension context invalidated."));
    click("highlight");
    await vi.advanceTimersByTimeAsync(1);
    expect(roots.at(-1)?.textContent).toContain("Reload page");
    expect(window.__readyReadingLayer).toBe(false);
  });

  it("surfaces ordinary save failures without disabling the layer or clearing selection", async () => {
    await initialize();
    await selectPassage();
    runtime.sendMessage.mockResolvedValueOnce({ ok: false, error: "Storage is full." });
    click("highlight");
    await vi.advanceTimersByTimeAsync(1);
    expect(roots[0].querySelector('[role="alert"]')?.textContent).toBe("Storage is full.");
    expect(roots[0].textContent).not.toContain("Reload page");
    expect(window.__readyReadingLayer).toBe(true);
    expect(document.getSelection()?.toString()).toBe("selected passage");
    expect(highlights.size).toBe(0);
  });

  it("handles tracker invalidation and stops its timer and page listeners", async () => {
    await initialize();
    runtime.id = undefined;
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(1);
    expect(roots.at(-1)?.textContent).toContain("Reload page");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks tracker failure responses instead of silently ignoring them", async () => {
    await initialize();
    runtime.sendMessage.mockResolvedValueOnce({ ok: false, error: "Article no longer exists." });
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(1);
    expect(roots[0].querySelector('[role="alert"]')?.textContent).toBe("Article no longer exists.");
  });

  it("handles failures while marking an unresolved annotation", async () => {
    runtime.sendMessage.mockResolvedValueOnce({
      ok: true, article, shouldResume: false, annotations: [{
        id: "missing", articleId: article.id, color: "yellow", note: "Keep my note",
        anchor: { exact: "This passage no longer exists.", prefix: "", suffix: "", start: 100, end: 130 },
        unresolved: false, createdAt: 1, updatedAt: 1
      }]
    });
    runtime.sendMessage.mockRejectedValueOnce(new Error("Extension context invalidated."));
    await initialize();
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "UPDATE_ANNOTATION", annotationId: "missing", note: "Keep my note", unresolved: true
    });
    expect(roots.at(-1)?.textContent).toContain("Reload page");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not submit the same selection twice while a save is pending", async () => {
    await initialize();
    await selectPassage();
    let finish!: (response: ReadyResponse) => void;
    runtime.sendMessage.mockReturnValueOnce(new Promise<ReadyResponse>((resolve) => { finish = resolve; }));
    click("highlight");
    click("highlight");
    expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
    finish({ ok: false, error: "Storage is full." });
    await vi.advanceTimersByTimeAsync(1);
    expect(roots[0].querySelector('[role="alert"]')?.textContent).toBe("Storage is full.");
  });

  it("releases initialization guard when a page is not linked or initialization fails", async () => {
    runtime.sendMessage.mockResolvedValueOnce({ ok: true, annotations: [], shouldResume: false });
    await initialize();
    expect(window.__readyReadingLayer).toBe(false);
    vi.resetModules();
    runtime.sendMessage.mockRejectedValueOnce(new Error("Background unavailable."));
    await initialize();
    expect(window.__readyReadingLayer).toBe(false);
    expect(roots.at(-1)?.textContent).toContain("Background unavailable.");
  });

  it("disposes the old layer, including highlights, before a fresh context takes over", async () => {
    await initialize();
    await selectPassage();
    click("highlight");
    await vi.advanceTimersByTimeAsync(1);
    expect(highlights.size).toBe(1);
    // A replacement extension context has a new isolated window, but shares the DOM.
    delete window.__readyReadingLayer;
    vi.resetModules();
    await initialize();
    expect(runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    expect(highlights.size).toBe(0);
    expect(document.querySelectorAll("[data-ready-ui]")).toHaveLength(1);
    expect(window.__readyReadingLayer).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });
});
