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
  const maximum = Math.max(1, ...items.map((item) => item.activeSeconds));
  return (
    <ul className="stats-list stats-ranking">
      {items.map((item, index) => (
        <li key={item.key}>
          <div className="stats-ranking-label"><span>{item.label}</span>{" "}<strong>{formatDuration(item.activeSeconds)}</strong></div>
          <div className="stats-bar-track" aria-hidden="true">
            <span className={`stats-tone-${index % 3}`} style={{ width: `${item.activeSeconds / maximum * 100}%` }} />
          </div>
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
  const weekdayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short" });
  const statuses = [
    { label: "Read", count: stats.currentCounts.read },
    { label: "In progress", count: stats.currentCounts.in_progress },
    { label: "Unread", count: stats.currentCounts.unread }
  ];
  const currentTotal = statuses.reduce((total, status) => total + status.count, 0);
  const readPercent = currentTotal ? stats.currentCounts.read / currentTotal * 100 : 0;
  const progressPercent = currentTotal ? stats.currentCounts.in_progress / currentTotal * 100 : 0;
  const weekSeconds = stats.dailyActivity.reduce((total, day) => total + day.activeSeconds, 0);

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
        <div className="stats-status">
          <div className="stats-ring" aria-hidden="true" style={{
            background: currentTotal
              ? `conic-gradient(var(--stats-primary) 0% ${readPercent}%, var(--stats-secondary) ${readPercent}% ${readPercent + progressPercent}%, var(--stats-tertiary) ${readPercent + progressPercent}% 100%)`
              : "var(--stats-track)"
          }}>
            <div><strong>{currentTotal}</strong><span>in library</span></div>
          </div>
          <ul className="stats-list stats-legend">
            {statuses.map((status, index) => (
              <li key={status.label}>
                <span className={`stats-swatch stats-tone-${index}`} aria-hidden="true" />
                <span>{status.label}: {status.count}</span>
                <span className="muted">{currentTotal ? Math.round(status.count / currentTotal * 100) : 0}%</span>
              </li>
            ))}
          </ul>
        </div>
        {!currentTotal && <p className="muted">Save an article to start building your library.</p>}
        <p>Recorded reads: {stats.recordedReads} ({stats.archivedReadCount} archived)</p>
        <p className="muted">Recorded reads reflect current or archived status, not completion dates.</p>
      </section>

      <section className="settings-card" aria-labelledby="stats-daily-heading">
        <h3 id="stats-daily-heading">Activity over the past 7 days</h3>
        <p className="stats-week-total"><strong>{formatDuration(weekSeconds)}</strong> <span className="muted">this week</span></p>
        <ul className="stats-list stats-daily">
          {stats.dailyActivity.map((day) => {
            const label = dateFormat.format(day.date);
            return (
              <li key={day.date.getTime()}>
                <span className="stats-day-value" aria-hidden="true">{day.activeSeconds ? formatDuration(day.activeSeconds) : "\u2014"}</span>
                <div className="stats-day-track" aria-hidden="true">
                  <span style={{ height: `${day.activeSeconds / dailyMax * 100}%` }} />
                </div>
                <span className="stats-day-label" aria-hidden="true">{weekdayFormat.format(day.date)}</span>
                <meter className="sr-only" aria-label={`Recorded active time on ${label}`} min={0} max={dailyMax} value={day.activeSeconds} aria-valuetext={formatDuration(day.activeSeconds)}>
                  {formatDuration(day.activeSeconds)}
                </meter>
              </li>
            );
          })}
        </ul>
        {!weekSeconds && <p className="muted">No recorded activity this week yet.</p>}
        <p className="muted">Sessions are assigned to their local end date; activity within a session is not split across days.</p>
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
