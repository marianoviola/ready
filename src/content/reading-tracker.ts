import type { ReadingPosition, ReadingSession } from "../domain/types";

export interface TrackerUpdate {
  progress: number;
  position?: ReadingPosition;
  activeSeconds: number;
  session?: ReadingSession;
}

export class ReadingTracker {
  private activeSeconds = 0;
  private lastTick = Date.now();
  private lastSavedAt = 0;
  private finalized = false;
  private readonly startedAt = Date.now();
  private readonly startProgress: number;
  private timer?: number;

  constructor(
    private readonly articleId: string,
    private readonly root: HTMLElement,
    initialProgress: number,
    private readonly capturePosition: () => ReadingPosition | undefined,
    private readonly save: (update: TrackerUpdate) => Promise<void>
  ) {
    this.startProgress = initialProgress;
  }

  start(): void {
    this.timer = window.setInterval(() => void this.tick(), 1000);
    window.addEventListener("scroll", this.onScroll, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.onPageHide);
  }

  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    window.removeEventListener("scroll", this.onScroll);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pagehide", this.onPageHide);
  }

  private tick = async (): Promise<void> => {
    const now = Date.now();
    if (document.visibilityState === "visible" && document.hasFocus()) {
      this.activeSeconds += Math.min(2, (now - this.lastTick) / 1000);
    }
    this.lastTick = now;
    if (now - this.lastSavedAt >= 5000 && this.activeSeconds > 0) {
      this.lastSavedAt = now;
      await this.flush(false);
    }
  };

  private onScroll = (): void => {
    if (Date.now() - this.lastSavedAt >= 5000) void this.flush(false);
  };

  private onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") void this.flush(false);
  };

  private onPageHide = (): void => {
    void this.flush(true);
  };

  private async flush(final: boolean): Promise<void> {
    if (final && this.finalized) return;
    if (final) this.finalized = true;
    const progress = this.progress();
    await this.save({
      progress,
      position: this.capturePosition(),
      activeSeconds: Math.round(this.activeSeconds),
      session: final
        ? {
            id: crypto.randomUUID(),
            articleId: this.articleId,
            startedAt: this.startedAt,
            endedAt: Date.now(),
            activeSeconds: Math.round(this.activeSeconds),
            startProgress: this.startProgress,
            endProgress: progress
          }
        : undefined
    });
  }

  private progress(): number {
    const rect = this.root.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    const viewportPoint = window.scrollY + window.innerHeight * 0.45;
    return Math.min(1, Math.max(0, (viewportPoint - top) / Math.max(1, rect.height)));
  }
}
