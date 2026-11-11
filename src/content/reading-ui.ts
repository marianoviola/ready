export class ReadingUi {
  private readonly host = document.createElement("div");
  private readonly root: ShadowRoot;
  private toolbar?: HTMLElement;
  private resumeBanner?: HTMLElement;
  private errorBanner?: HTMLElement;

  constructor() {
    this.host.dataset.readyUi = "";
    this.host.style.all = "initial";
    this.root = this.host.attachShadow({ mode: "closed" });
    this.root.innerHTML = `<style>
      :host { all: initial; }
      .ready {
        position: fixed;
        z-index: 2147483647;
        font: 13px/1.35 system-ui, sans-serif;
        color: #242424;
      }
      .panel {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px;
        border: 1px solid rgba(0,0,0,.12);
        border-radius: 9px;
        background: #fff;
        box-shadow: 0 8px 24px rgba(0,0,0,.18);
      }
      button {
        border: 0;
        border-radius: 6px;
        padding: 6px 9px;
        background: #f0f0f0;
        color: #242424;
        cursor: pointer;
        font: inherit;
      }
      button.primary { background: #5b5fc7; color: white; }
      button:hover { filter: brightness(.96); }
      button:focus-visible { outline: 2px solid #5b5fc7; outline-offset: 2px; }
      .resume { top: 16px; left: 50%; transform: translateX(-50%); }
      .resume .panel { padding: 8px 10px 8px 12px; }
      .error { top: 16px; left: 16px; right: 16px; max-width: 560px; }
      .error .panel { flex-wrap: wrap; padding: 10px 12px; }
      .error [role="alert"] { flex: 1 1 240px; }
      @media (prefers-color-scheme: dark) {
        .panel { color: #f5f5f5; background: #292929; border-color: #555; }
        button { color: #f5f5f5; background: #444; }
      }
    </style>`;
    document.documentElement.append(this.host);
  }

  showSelectionToolbar(
    rect: DOMRect,
    onHighlight: () => void,
    onNote: () => void
  ): void {
    this.hideToolbar();
    const toolbar = document.createElement("div");
    toolbar.className = "ready";
    toolbar.style.left = `${Math.max(8, Math.min(window.innerWidth - 190, rect.left))}px`;
    toolbar.style.top = `${Math.max(8, rect.top - 48)}px`;
    toolbar.innerHTML = `<div class="panel" role="toolbar" aria-label="Ready annotation tools">
      <button class="primary" data-action="highlight">Highlight</button>
      <button data-action="note">Add note</button>
    </div>`;
    toolbar.addEventListener("mousedown", (event) => event.preventDefault());
    toolbar.querySelector("[data-action='highlight']")?.addEventListener("click", onHighlight);
    toolbar.querySelector("[data-action='note']")?.addEventListener("click", onNote);
    this.root.append(toolbar);
    this.toolbar = toolbar;
  }

  hideToolbar(): void {
    this.toolbar?.remove();
    this.toolbar = undefined;
  }

  destroy(): void {
    this.host.remove();
  }

  showError(message: string, reloadPage = false): void {
    this.hideToolbar();
    this.resumeBanner?.remove();
    this.errorBanner?.remove();
    const banner = document.createElement("div");
    banner.className = "ready error";
    const panel = document.createElement("div");
    panel.className = "panel";
    const text = document.createElement("span");
    text.setAttribute("role", "alert");
    text.textContent = message;
    panel.append(text);
    if (reloadPage) {
      const reload = document.createElement("button");
      reload.className = "primary";
      reload.textContent = "Reload page";
      reload.addEventListener("click", () => window.location.reload());
      panel.append(reload);
    }
    const dismiss = document.createElement("button");
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => banner.remove());
    panel.append(dismiss);
    banner.append(panel);
    this.root.append(banner);
    this.errorBanner = banner;
  }

  showResume(onResume: () => void): void {
    this.resumeBanner?.remove();
    const banner = document.createElement("div");
    banner.className = "ready resume";
    banner.innerHTML = `<div class="panel">
      <span>Continue where you left off?</span>
      <button class="primary" data-action="resume">Resume reading</button>
      <button aria-label="Dismiss resume prompt" data-action="dismiss">×</button>
    </div>`;
    banner.querySelector("[data-action='resume']")?.addEventListener("click", () => {
      onResume();
      banner.remove();
    });
    banner.querySelector("[data-action='dismiss']")?.addEventListener("click", () => banner.remove());
    this.root.append(banner);
    this.resumeBanner = banner;
  }
}
