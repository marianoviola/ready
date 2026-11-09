# Ready

Ready is a local-first Microsoft Edge extension that turns existing Favorites into a private reading library. Edge remains the source of truth for bookmark URLs, titles, folders, creation dates, and native synchronization. Ready stores only reading-specific data in IndexedDB.

## What works

- Link individual Favorites or entire Favorite folders without creating copies.
- Save the active page, linking an existing matching Favorite when available.
- Keep reading records, progress, highlights, notes, and history after a Favorite is deleted.
- Restore orphaned records to an existing or newly created Favorite.
- Track active reading progress without counting hidden/background tabs.
- Save a text-anchored reading position and offer an explicit **Resume reading** action.
- Create persistent CSS Custom Highlight API highlights and optional private notes.
- Search local article metadata and notes.
- Filter by reading status, website, and orphan state; sort by recent activity or saved date; group by status, website, or date with collapsible sections.
- Keep a separate directory of websites to browse manually, with private notes and subscription status.
- Show deterministic, on-device forgotten, unfinished, and related recommendations.
- Export selected or all reading data to a versioned, browser-independent JSON file.
- Preview, reconcile, and non-destructively merge JSON imports.

All data stays on the device. Ready has no backend, account, analytics, telemetry, paid API, or AI dependency.

## Development

Requirements:

- Node.js 20 or newer.
- Microsoft Edge 120 or newer.

Install and validate:

```bash
npm install
npm run check
```

Useful commands:

```bash
npm run dev          # Vite development server for the sidebar UI
npm run typecheck    # strict TypeScript validation
npm test             # Vitest domain and persistence tests
npm run build        # production extension in dist/
npm run test:e2e     # build and run Playwright extension smoke test
```

Playwright's Chromium binary is installed separately when needed:

```bash
npx playwright install chromium
```

## Install in Microsoft Edge

1. Run `npm run build`.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the generated `dist/` directory.
6. Pin Ready if desired. Selecting its toolbar icon opens the Ready sidebar.

The default keyboard shortcut **Alt+Shift+S** saves the active page. It can be changed at `edge://extensions/shortcuts`.

## Using the reading layer

Ready requests access only to a website when you save or open an article from the sidebar. On supported `http` and `https` pages:

1. Select text in the detected article.
2. Use the compact Ready toolbar to highlight it or attach a note.
3. Reopen an in-progress article with **Resume** to get an explicit resume prompt.

The original page is not downloaded or permanently modified. Highlights use the CSS Custom Highlight API rather than wrapper elements.

## Sources

Sources are websites or publications you want to keep independently from saved
articles. Add a URL and optional name, note, and subscription status from the
**Sources** tab. Ready does not scrape, fetch, or monitor the website; **Open**
simply navigates to it in a new tab.

When saved articles share the Source domain, **View saved** opens the Library
filtered to that website. Removing a Source never removes its articles or Edge
Favorites.

## Architecture

```text
src/
  background/   Manifest V3 service worker and message routing
  browser/      Edge bookmarks adapter and typed extension messages
  content/      Document adapter, anchors, tracker, renderer, isolated UI
  db/           Dexie IndexedDB schema
  domain/       Pure URL, status, anchor, discovery, and backup logic
  sidebar/      React sidebar, Sources, Favorite picker, discovery, and backup UI
```

### Data ownership

- **Edge Favorites:** URL, title, folder, and native creation date.
- **IndexedDB:** stable Ready article ID, bookmark relationship, recovery metadata, status, progress, position, sessions, annotations, Sources, and timestamps.

Bookmark IDs are never exported. Imported articles are reconciled by normalized URL and retain a stable local identity. When a Favorite disappears, Ready removes only the bookmark reference and marks the record as orphaned.

### Text anchoring

Anchors combine:

- Exact selected text.
- Prefix and suffix context.
- Normalized article-text offsets.
- An optional DOM hint.

Restoration prioritizes quote/context matching and uses text position only as a guarded fallback. Low-confidence matches remain unresolved instead of being attached to unrelated text.

### Service worker suspension

The service worker holds no required in-memory state. Every operation reads or writes IndexedDB, Edge Favorites, or `chrome.storage.session`, so Manifest V3 suspension does not lose reading data.

## Permissions

| Permission | Why Ready needs it |
|---|---|
| `bookmarks` | Browse, link, create, restore, and explicitly delete Edge Favorites. |
| `sidePanel` | Display the Ready library in the Edge sidebar. |
| `activeTab` / `tabs` | Identify the current page and open saved articles. |
| `scripting` | Inject the reading layer after site access is granted. |
| `storage` | Carry a one-time resume request across opening a new tab. |
| `contextMenus` | Save a page or selected passage from the page menu. |
| Optional `http://*/*`, `https://*/*` | Granted per site at user request for progress, highlights, and resume. |

Ready cannot run on browser-internal pages such as `edge://` URLs. Site access can be reviewed or revoked in Edge's extension settings.

## Tests

Vitest covers:

- URL normalization and bookmark matching rules.
- Reading status transitions.
- Text-anchor creation, disambiguation, changed-content restoration, and refusal.
- Discovery ranking and ignored recommendations.
- Versioned backup validation and non-destructive merge behavior.
- IndexedDB schema creation.

Playwright includes a built-extension smoke test that launches Chromium with the unpacked extension and verifies the sidebar entry point.

## Known limitations

- Edge internal pages, the Edge Add-ons store, and browser-managed PDF viewers may reject content-script injection.
- Main-content detection is heuristic. Unusual applications may expose only partial reading progress.
- A heavily rewritten article can make an anchor unresolved. Ready preserves the annotation and labels it instead of guessing.
- CSS Custom Highlight API highlights do not provide native pointer events; note editing and deletion are available from the sidebar.
- Reading metadata does not automatically sync between Edge installations. Use explicit JSON export/import; Edge sync remains responsible only for Favorites.
- Dynamic pages are observed and re-anchored, but continuous virtualized content can still invalidate a position.
- Edge currently has documented sidebar lifecycle behavior that can require reopening the sidebar after switching tabs.

## JSON format

Backups use `schemaVersion: 2` and contain:

- `articles` without Edge bookmark IDs.
- `annotations`, including unresolved annotations.
- `sessions`.
- `sources`, including notes and subscription status.
- ISO export timestamp.

Imports are validated before writes. Existing articles and Sources are matched by normalized URL, newer metadata wins, the earliest saved date is preserved, and annotations/sessions are remapped to the stable local article ID. Version 1 backups remain importable and are upgraded with an empty Sources list.
