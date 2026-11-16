import { useEffect, useState } from "react";
import { sendReadyMessage } from "../browser/messages";
import { DEFAULT_READING_RETENTION, getReadingRetention } from "../browser/reading-retention";
import { useFeedback } from "./Feedback";

export function ReadingRetentionSettings({ onChanged }: { onChanged: () => Promise<void> }) {
  const [settings, setSettings] = useState(DEFAULT_READING_RETENTION);
  const [limit, setLimit] = useState(String(DEFAULT_READING_RETENTION.maxReadArticles));
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const { setMessage, setError } = useFeedback();

  useEffect(() => {
    let disposed = false;
    void getReadingRetention().then((value) => {
      if (disposed) return;
      setSettings(value);
      setLimit(String(value.maxReadArticles));
    }).catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "Reading-list automation could not be loaded.");
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);

  async function save() {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await sendReadyMessage({
        type: "SET_READING_RETENTION",
        settings: { ...settings, maxReadArticles: Number(limit) }
      });
      if (!response.ok) throw new Error(response.error);
      if (!("removedCount" in response)) throw new Error("Ready received an unexpected automation response.");
      await onChanged();
      setMessage(settings.enabled
        ? `Automation enabled. ${response.removedCount} read articles removed from the list; history and Edge Favorites kept.`
        : "Automation disabled. Your list will not be cleaned automatically.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Reading-list automation could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="settings-card retention-settings" aria-labelledby="retention-title">
      <h3 id="retention-title">Reading-list automation</h3>
      <p className="muted">Keep your list manageable without deleting Edge Favorites. The oldest read articles beyond your limit leave the list; their reading history and bookmark references stay in Statistics. Unread and in-progress articles are never removed.</p>
      <label className="retention-toggle">
        <input type="checkbox" checked={settings.enabled} disabled={loading || pending} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />
        Automatically clean up read articles
      </label>
      <label className="retention-limit">
        Read articles to keep
        <input type="number" min="1" step="1" value={limit} disabled={loading || pending} onChange={(event) => setLimit(event.target.value)} />
      </label>
      <p className="muted">Disabled by default. Saving with automation enabled also cleans up the current list immediately. Progress and sessions remain in history; highlights and notes are removed with the list item.</p>
      <div className="button-row">
        <button type="button" className="button secondary" disabled={loading || pending} onClick={() => void save()}>{pending ? "Saving..." : "Save automation"}</button>
      </div>
    </section>
  );
}
