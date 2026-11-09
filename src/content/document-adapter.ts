const ARTICLE_SELECTORS = [
  "article",
  "main article",
  "[role='main'] article",
  "[itemprop='articleBody']",
  "main",
  "[role='main']"
];

export class DocumentAdapter {
  private root: HTMLElement;
  private observer?: MutationObserver;

  constructor(private readonly onDocumentChanged: () => void) {
    this.root = this.findRoot();
  }

  get articleRoot(): HTMLElement {
    return this.root;
  }

  start(): void {
    this.observer = new MutationObserver(() => {
      const next = this.findRoot();
      if (next !== this.root) this.root = next;
      this.onDocumentChanged();
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  stop(): void {
    this.observer?.disconnect();
  }

  private findRoot(): HTMLElement {
    for (const selector of ARTICLE_SELECTORS) {
      const candidate = document.querySelector<HTMLElement>(selector);
      if (candidate && visibleTextLength(candidate) >= 500) return candidate;
    }

    const candidates = [...document.querySelectorAll<HTMLElement>("section, div")]
      .filter((element) => visibleTextLength(element) >= 500)
      .sort((left, right) => score(right) - score(left));
    return candidates[0] ?? document.body;
  }
}

function score(element: HTMLElement): number {
  const textLength = visibleTextLength(element);
  const linksLength = [...element.querySelectorAll("a")].reduce(
    (total, link) => total + (link.textContent?.length ?? 0),
    0
  );
  const paragraphCount = element.querySelectorAll("p").length;
  return textLength - linksLength * 1.5 + paragraphCount * 80;
}

function visibleTextLength(element: HTMLElement): number {
  if (
    element.matches(
      "nav, aside, footer, [aria-hidden='true'], [hidden], .comments, #comments"
    )
  ) {
    return 0;
  }
  return (element.innerText || "").replace(/\s+/g, " ").trim().length;
}
