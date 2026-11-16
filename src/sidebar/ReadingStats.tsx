import { calculateReadingStats } from "../domain/reading-stats";
import type { ReadingActivity } from "../domain/reading-stats";
import type { Article, ReadingSession } from "../domain/types";

export interface ReadingStatsProps {
  articles: readonly Article[];
  sessions: readonly ReadingSession[];
  history?: readonly Article[];
}

function formatDuration(seconds: number): string {
  if (seconds > 0 && seconds < 1) return "Less than 1 second";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remaining = rounded % 60;
  return [
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    remaining || (!hours && !minutes) ? `${remaining}s` : ""
  ].filter(Boolean).join(" ");
}

function ActivityList({ items }: { items: ReadingActivity[] }) {
  if (!items.length) return <p className="muted">No recorded activity yet.</p>;
  return (
    <ul className="stats-list">
      {items.map((item) => (
        <li key={item.key}>
          <span>{item.label}</span>{" "}<strong>{formatDuration(item.activeSeconds)}</strong>
        </li>
      ))}
    </ul>
  );
}

function safeArticleUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export function ReadingStats({ articles, sessions, history = [] }: ReadingStatsProps) {
  const stats = calculateReadingStats(articles, sessions, Date.now(), history);
  const dailyMax = Math.max(1, ...stats.dailyActivity.map((day) => day.activeSeconds));
  const dateFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <section className="panel-page stats-panel" aria-labelledby="reading-stats-heading">
      <div className="section-heading">
        <p className="eyebrow">Local reading activity</p>
        <h2 id="reading-stats-heading">Reading statistics</h2>
        <p className="muted">Recorded active time: <strong>{formatDuration(stats.totalActiveSeconds)}</strong></p>
        <p className="muted">
          Saved sessions for current and archived articles ending by now are included. Times are rounded to the nearest second.
          Archived history stays on this device. No telemetry is sent.
        </p>
      </div>

      <section className="settings-card" aria-labelledby="stats-status-heading">
        <h3 id="stats-status-heading">Current article status</h3>
        <ul className="stats-list">
          <li>Read: {stats.currentCounts.read}</li>
          <li>In progress: {stats.currentCounts.in_progress}</li>
          <li>Unread: {stats.currentCounts.unread}</li>
        </ul>
        <p>Recorded reads: {stats.recordedReads} ({stats.archivedReadCount} archived)</p>
        <p className="muted">Recorded reads reflect current or archived status, not completion dates.</p>
      </section>

      <section className="settings-card" aria-labelledby="stats-daily-heading">
        <h3 id="stats-daily-heading">Activity over the past 7 days</h3>
        <p className="muted">Sessions are assigned to their local end date; activity within a session is not split across days.</p>
        <ul className="stats-list stats-daily">
          {stats.dailyActivity.map((day) => {
            const label = dateFormat.format(day.date);
            return (
              <li key={day.date.getTime()}>
                <span>{label}: {formatDuration(day.activeSeconds)}</span>{" "}
                <meter aria-label={`Recorded active time on ${label}`} min={0} max={dailyMax} value={day.activeSeconds}>
                  {formatDuration(day.activeSeconds)}
                </meter>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="settings-card" aria-labelledby="stats-domains-heading">
        <h3 id="stats-domains-heading">Activity by domain</h3>
        <ActivityList items={stats.domains} />
      </section>
      <section className="settings-card" aria-labelledby="stats-tags-heading">
        <h3 id="stats-tags-heading">Activity by tags</h3>
        <p className="muted">Uses current article details or their archived snapshot. A session appears under each tag, so tag totals can overlap.</p>
        <ActivityList items={stats.tags} />
      </section>
      <section className="settings-card" aria-labelledby="stats-history-heading">
        <h3 id="stats-history-heading">Local history</h3>
        <details className="stats-history">
          <summary>Archived articles ({stats.archivedArticles.length})</summary>
          {stats.archivedArticles.length ? (
            <ul className="stats-list">
              {stats.archivedArticles.map((article) => {
                const url = safeArticleUrl(article.originalUrl);
                return (
                  <li key={article.id}>
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer">{article.title || article.originalUrl}</a> : <span>{article.title || article.originalUrl}</span>}
                    {" "}<span className="muted">{article.originalUrl}</span>
                    {article.bookmarkId && <>{" "}<span className="muted">Historical Favorite reference: {article.bookmarkId}</span></>}
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted">No archived articles yet.</p>}
        </details>
      </section>
    </section>
  );
}
