<p align="center">
  <img src="public/icons/ready-128.png" alt="Ready" width="96" height="96">
</p>

<h1 align="center">Ready</h1>

**Your bookmarks. Your reading library.**

Ready turns Microsoft Edge Favorites into a reading library with progress tracking,
highlights, notes, and reading insights. Edge remains the source of truth for
bookmark URLs, titles, folders, creation dates, and native synchronization. Ready
stores only reading-specific data in IndexedDB.

Your reading data stays in your browser. No Ready account, no tracking.

**Public release candidate — 0.1.0.** Ready is being prepared for Microsoft Edge
Add-ons. Keep a JSON backup before updating, switching installations, or
uninstalling. This repository does not imply store approval or an available listing.

[Privacy policy](https://marianoviola.com/privacy/#ready) ·
[Contact & support](https://marianoviola.com/contact/)

## What works

- Link individual Favorites or entire Favorite folders without creating copies.
- Save the active page, linking an existing matching Favorite when available.
- The header save action follows your workspace: **Save page** in Library or **Save source** in Sources. It shows saving progress and a persistent saved state for the current article or website. Saving a source adds its website without creating a Favorite or requesting reading access.
- Success and error notifications stay in the sticky header while you scroll articles, sources, or settings. Errors inside an open dialog stay with that dialog.
- Keep reading records, progress, highlights, notes, and history after a Favorite is deleted.
- Restore orphaned records to an existing or newly created Favorite.
- See live Favorite links and folder paths; move any linked Favorite directly from Ready without changing its tags, reading progress, or default save destination.
- Track active reading progress without counting hidden/background tabs.
- Save a text-anchored reading position and offer an explicit **Resume reading** action.
- Create persistent CSS Custom Highlight API highlights and optional private notes.
- Search local article metadata and notes.
- Filter by reading status, website, tag, and orphan state; sort by recent activity or saved date; group by status, website, date, or tag with collapsible sections in List or horizontally scrolling Kanban layout.
- Website and tag filters reset automatically when their selected value no longer exists in the library; other filter selections are preserved.
- The website filter nests related hosts under their shared registrable domain. Select a whole website family or an individual host; multi-part public suffixes and private hosting domains are recognized locally, without network lookups.
- The save button uses bookmark, hourglass, and confirmation icons for idle, saving, and saved states, with persistent text labels and no animation. Saved-state colors remain consistent on hover in light and dark mode.
- Inherit tags from Favorite folders when linking, then edit them in an integrated editor with reusable existing tags and new tag creation.
- Navigate between **Library** and **Sources**, each with its own **Tags** and **Discover** views, with general settings kept separate.
- Use compact, consistent article and source cards: **Open/Resume** stays visible, with secondary actions in the **...** menu. Menus support arrow keys, Home/End, Escape, and outside-click dismissal.
- Browse scoped tag directories and open the corresponding filtered article or source list.
- Select visible articles for bulk tag addition, reading-status changes, or removal. One Ready confirmation offers an optional, unchecked **Also delete linked Edge Favorites** checkbox.
- Keep a separate directory of websites to browse manually, with private notes and subscription status.
- Removing a source uses the same in-Ready confirmation as article removal. Source notes and tags are removed, while saved articles, reading history, and Edge Favorites are kept.
- Tag sources during creation or editing, reusing tags from Library or creating new ones. Source and article tags share suggestions but remain independent; creating a source from an article suggests its tags without copying them automatically.
- Search source names, domains, notes, and tags; filter by tag or subscription; group by tag or subscription in List or Kanban, with collapsible groups and separately saved group order. Sources with multiple tags appear in each tag group; untagged sources have their own group.
- Sort sources by name, added date, updated date, or saved article count. The default remains subscribed first, then alphabetical. Updated date reflects source edits, not site visits.
- Show deterministic, on-device forgotten, unfinished, and related recommendations.
- Discover potential sources from websites already in your library, using the same source list controls. Suggestions make no external requests and are saved only after explicit confirmation.
- View local active reading time, a library-status ring, a seven-day activity chart, domain/tag bars, and archived reading history in **Library → Statistics**. Charts use Ready's violet palette, adapt to dark mode, and keep labeled values available to assistive technology.
- Optionally clean up the oldest read articles beyond a configurable limit (100 by default). Automation starts disabled, never removes unread/in-progress articles, and never deletes Edge Favorites.
- Export selected or all reading data to a versioned, browser-independent JSON file.
- Preview, reconcile, and non-destructively merge JSON imports.

Ready's reading data stays in your browser profile. Ready has no backend, account,
analytics, telemetry, paid API, or AI dependency. Edge may sync Favorites when you
enable browser sync. Opening sites, browser favicon retrieval, store updates, and
the support website remain subject to their own services and privacy policies.

### Reading-list removal and history

After marking an article read, choose **Remove from list** or **Keep in list**.
Removal archives its reading status, progress, sessions, URL, and historical Favorite
reference for statistics; highlights and private notes are deleted. Edge Favorites
are kept unless you explicitly select their deletion in the Ready confirmation.
Moving a Favorite is available for any linked article, regardless of reading status.

Enable **Reading-list automation** in Settings to retain only the configured number
of read articles. Saving enabled settings immediately applies cleanup. Cleanup also
runs after status changes, imports, and browser startup. Oldest is determined by the
recorded completion time, falling back to last update for older records without a
completion timestamp. There is no fabricated completion date for existing records.
Linking an archived article restores its local identity and progress without
duplicating session history. Full JSON backups include archived history and its
sessions; selected exports include only the selected active articles.

## Development

Requirements:

- Node.js 22.12 or newer (CI uses Node.js 24).
- Microsoft Edge 120 or newer.

Install and validate:

```bash
npm ci
npm run check
```

Useful commands:

```bash
npm run dev          # Vite development server for the sidebar UI
npm run typecheck    # strict TypeScript validation
npm test             # Vitest domain and persistence tests
npm run build        # production extension in dist/
npm run test:e2e     # build and run Playwright extension integration tests
npm run package     # build a release ZIP with licenses and SHA-256 checksum
npm run test:edge   # build and run integration tests in installed Microsoft Edge
npm run store:assets # capture store images in installed Microsoft Edge (build first)
npm run test:distribution # verify the generated ZIP (run package first)
```

Playwright's Chromium binary is installed separately when needed:

```bash
npx playwright install chromium
```

## Install in Microsoft Edge

1. Build with `npm run build`, or download an available release ZIP from
   [GitHub Releases](https://github.com/marianoviola/ready/releases) if you have repository access, verify its
   checksum, and extract it to a permanent directory.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the generated `dist/` directory, or the extracted directory containing
   `manifest.json` (not the ZIP file).
6. Pin Ready if desired. Selecting its toolbar icon opens the Ready sidebar.

The default keyboard shortcut **Alt+Shift+S** saves the active page. It can be changed at `edge://extensions/shortcuts`.

For an unpacked update, export a backup, replace the files in the same directory,
then select **Reload** in `edge://extensions`. Do not uninstall just to update:
uninstalling removes Ready's local reading data. Favorites and exported backups
are separate and remain under your control.

Reload any article tabs that were already open after updating or reloading the
extension. Their previous reading layer can no longer communicate with Ready.
If you try to annotate from one of those tabs, Ready displays a **Reload page**
notice instead of retrying against the disconnected extension. Existing saved
highlights and notes remain in your library; retry the unsaved annotation after
the page reloads.

## Distribution and release

Packaging requires the `zip` command; distribution tests also require `unzip`
(available on macOS and the Ubuntu CI runner). Consumers on Windows can extract
the resulting ZIP without these developer tools.

```bash
npm ci
npm run check
npm run package
npm run test:distribution
npm run test:e2e
```

The package is `release/ready-0.1.0.zip`, accompanied by
`ready-0.1.0.zip.sha256`. It contains the manifest at the archive root, the built
extension, MIT license, and third-party license notices. Source maps and development
files are excluded. Entries are sorted and timestamps normalized for repeatable
packaging of the same build and installed dependencies.
On macOS, verify a downloaded pair with `shasum -a 256 -c ready-0.1.0.zip.sha256`;
on Linux use `sha256sum -c ready-0.1.0.zip.sha256`.

CI checks types, unit tests, production build, package contents, and headed Chromium
extension tests under Xvfb. It uploads a release artifact but does not publish it.
Chromium integration tests do not replace manual testing in Microsoft Edge.

To prepare a GitHub release after review:

1. Keep `package.json`, its lockfile, and `public/manifest.json` versions aligned;
   keep `version_name` aligned with the release version.
2. Commit and push the reviewed changes and an explicit matching tag such as
   `v0.1.0`.
3. Run **Release candidate** in GitHub Actions with that existing tag. It validates the
   tagged source and creates a **draft release** with ZIP and checksum.
4. Inspect the draft, artifacts, and release notes before publishing manually.
   The workflow never publishes a release or submits to a store automatically.

`private: true` in `package.json` intentionally prevents npm publication; it does
not control the GitHub repository's visibility.

### Edge Add-ons submission

Suggested listing:

- **Name:** Ready
- **Tagline:** Your bookmarks. Your reading library.
- **Summary:** Turn Edge Favorites into a reading library with progress tracking, highlights, notes, and reading insights.
- **Description:** Organize saved articles with tags, filters, and List or Kanban
  groups. Track reading progress, resume where you stopped, and keep highlights
  and notes locally. Link existing Favorites without duplicating them and export
  your reading data as JSON. No account or Ready server.
- **Privacy URL:** <https://marianoviola.com/privacy/#ready>
- **Support URL:** <https://marianoviola.com/contact/>

Before public distribution:

- Publish the shared privacy-policy update so the Ready section is live.
- Review tracked files and the **entire Git history**, author identities, and
  third-party assets before making the repository public. Tests and CI are not a
  security audit or a guarantee that history contains no secrets.
- Manually test the packaged extension in Edge: permissions, save/link/restore,
  reading layer, tags, bulk deletion confirmation, backup/import, updates, and
  uninstall behavior. Back up real reading data first.
- Prepare actual Edge screenshots and the icons/promotional assets requested
  by Partner Center. Do not describe Chromium-only checks as Edge certification.
- Complete Partner Center's current permissions, privacy, and data-use
  declarations accurately, distinguishing local processing from collection by
  the publisher. Explain each permission using the table below.
- Upload the ZIP (not its enclosing folder), review the public listing,
  then submit manually. Store acceptance is not guaranteed by these checks.

The complete U.S. English listing, permission justifications, reviewer steps,
release checklist, and migration instructions are in
[Publishing to Edge Add-ons](docs/publishing.md).

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
Use **Add source** on a saved article to prefill the source website.
Source cards use the browser's favicon service, with a neutral globe fallback if
the icon cannot load. No third-party favicon provider is used.

When saved articles share the Source domain, **View saved** opens the Library
filtered to that website. Removing a Source never removes its articles or Edge
Favorites.

## Bookmark destination

Open **Settings** to choose where newly created Favorites are stored. By default,
Ready creates its own **Ready** folder on the first save, in the browser's default
Favorites location. **Choose folder** selects an existing folder; **Use Ready
folder** restores the default. These preferences stay local and are not included
in JSON backups. Backup and restore tools are also under **Settings**.

The destination applies to saves from the sidebar, keyboard shortcut, and context
menu. Existing matching Favorites are reused without moving or duplicating them.
Restoring an orphan can still use an explicitly chosen destination.
If a custom destination is deleted, saving reports an error instead of silently
using another folder; choose another folder or reset to Ready in Settings.
If Ready's own folder is deleted, it is recreated on the next save that needs it.

Folder names are inherited as tags when saving or linking Favorites, except for
the technical folder created by Ready (identified by its ID, not its name).
User-created folders named Ready and subfolders inside the technical folder
continue to contribute their own tags. Changing the destination does not move
existing Favorites or retag existing articles.

## Tags and library layouts

Use **Edit tags** (or **Add tags**) on an article to open the tag editor.
Select existing tags, or type a new name and press Enter or **Create tag**.
Remove a selected chip to unassign it, then **Save tags**. Tag names are
case-insensitively deduplicated and can include commas.

The **Tags** directory shows tags currently used in the library, with counts.
Clicking a tag clears other filters and opens its saved articles.
**List** stacks groups vertically; **Kanban** places the same groups in
horizontal, scrollable columns without drag-and-drop.
Use the arrows beside each group heading to move it earlier or later. The order
is saved locally per grouping (status, date, website, or tag), shared between
List and Kanban, and retained across reloads. Filtering hides groups without
discarding their saved positions.

The saved article matching the active tab in the sidebar's window has a
**Current page** badge and highlighted border. This updates when switching tabs
or navigating, ignoring URL fragments and tracking parameters while preserving
meaningful query parameters. Original and known canonical URLs are matched.

Use article checkboxes or **Select all** to reveal bulk actions. Selection is
accessible while scrolling: the bulk toolbar stays below the sticky navigation.
Success notifications disappear after six seconds and can also be dismissed;
errors remain visible until dismissed or cleared by a subsequent action.
Selection is
limited to articles matching the current filters and search (including collapsed
groups); changing filters drops hidden selections. Bulk **Add tags** keeps each
article's existing tags. Status changes and removals use the same operations as
individual articles. If a bulk operation fails partway, Ready reports how many
articles completed and keeps remaining articles selected.

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

The service worker holds no required in-memory state. Every operation reads or writes IndexedDB, Edge Favorites, or browser storage (`chrome.storage.local` and `chrome.storage.session`), so Manifest V3 suspension does not lose reading data.

## Permissions

| Permission | Why Ready needs it |
|---|---|
| `bookmarks` | Browse, link, create, restore, and explicitly delete Edge Favorites. |
| `sidePanel` | Display the Ready library in the Edge sidebar. |
| `activeTab` / `tabs` | Identify the current page and open saved articles. |
| `scripting` | Inject the reading layer after site access is granted. |
| `storage` | Store local preferences such as bookmark destination and carry a one-time resume request across opening a new tab. |
| `contextMenus` | Save a page or selected passage from the page menu. |
| `favicon` | Display website icons from the browser's favicon service in Sources. |
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

Playwright launches Chromium with the built extension and exercises the sidebar,
reading layer, tags, layouts, bulk actions, active-page indicators, bookmark
destinations, and support links. Distribution tests inspect the ZIP's entry point,
referenced assets, versions, licenses, checksum, and repeatable packaging.

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
- `readingHistory` in full backups, including archived article metadata and status.
- ISO export timestamp.

Imports are validated before writes. Existing articles and Sources are matched by normalized URL, newer metadata wins, the earliest saved date is preserved, and annotations/sessions are remapped to the stable local article ID. Version 1 backups remain importable and are upgraded with an empty Sources list.

## Privacy, support, and license

Read the [shared privacy policy, Ready section](https://marianoviola.com/privacy/#ready).
For support or private bug reports, use the [contact page](https://marianoviola.com/contact/).
Avoid sending reading backups, private URLs, or notes unless needed and intentionally shared.

Ready is licensed under the [MIT License](./LICENSE). Bundled dependencies retain
their own licenses, included in `THIRD-PARTY-NOTICES.txt` inside distribution ZIPs.
