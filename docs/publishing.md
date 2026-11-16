# Publishing Ready to Microsoft Edge Add-ons

## Release identity

- Product: **Ready**
- Version: **0.1.0**
- Visibility: **Public** (searchable, not Hidden)
- Listing language: **English (United States)** (`en-US`)
- Suggested category: **Productivity**
- Publisher: use Mariano Viola's verified Partner Center developer account.
- Privacy policy: <https://marianoviola.com/privacy/#ready>
- Support: <https://marianoviola.com/contact/>
- Website: <https://marianoviola.com/>
- No account, payment, subscription, API key, or external service is required.

The GitHub repository may remain private. Its releases are not a public download
channel while it is private. Do not change repository visibility to publish the
extension. `private: true` prevents accidental npm publication and must remain.
Do not announce store availability or invent an Add-ons URL before approval.

## Copy-ready store listing

### Name

Ready

### Tagline

Your bookmarks. Your reading library.

### Short description

Turn Edge Favorites into a reading library with progress tracking, highlights, notes, and reading insights.

This must match `description` in the packaged manifest.

### Description

Your bookmarks. Your reading library.

Ready turns Microsoft Edge Favorites into a personal reading library, without
moving your articles into another service. Link existing Favorites or save the
current page, then organize what you want to read in the Edge sidebar.

MAKE YOUR FAVORITES A READING LIST

Link individual Favorites or entire folders without making duplicate bookmarks.
See each article's linked Favorite and folder, move Favorites directly from
Ready, and reconnect articles whose Favorite has been deleted. Removing an
article from Ready keeps the Favorite unless you explicitly choose to delete it.

ORGANIZE YOUR WAY

Add tags at any time or inherit them from Favorite folders when linking.
Search, filter, group, and sort your library. Switch between List and Kanban
views. Manage your favorite websites in Sources, with their own tags, private
notes, and subscription labels. Source subscriptions are organizational labels;
Ready does not fetch feeds or manage paid subscriptions.

PICK UP WHERE YOU LEFT OFF

Track active reading progress on supported web pages and explicitly resume at
your saved position. Highlight passages and attach private notes. Ready requests
site access when you use reading features on a website, rather than requesting
access to every site at installation.

KEEP THE HISTORY, NOT THE CLUTTER

See local reading time, daily activity, and reading statistics. Completed articles
can leave the active list while their reading history remains. Optional cleanup
keeps only a chosen number of read articles and never automatically deletes Edge
Favorites. Cleanup is off by default.

LOCAL FIRST

Your reading data stays in your browser. No Ready account, no tracking.

Ready has no account, backend, advertising, analytics, or telemetry. Reading data
is stored in your browser profile. Discover suggestions use your existing local
library, not an external recommendation service. Export a full JSON backup and
preview imports before merging them.

IMPORTANT DETAILS

Edge can sync Favorites through its own browser sync service. Ready's progress,
notes, tags, sources, and statistics are not automatically synced between devices.
Export a backup before uninstalling or switching installations. Removing an
article deletes its highlights and private notes but retains reading history for
statistics. Website redesigns can affect saved positions and highlights. Browser
internal pages, extension stores, PDFs, and some complex web apps are not supported
by the reading layer. Ready is a reading companion, not an offline article archive.

### Search terms

reading list; favorites; bookmarks; read later; highlights; notes; tags

### What's new in 0.1.0

Initial release: a local-first reading library connected to Edge Favorites, with
tags, List and Kanban views, highlights and notes, Sources, reading statistics,
optional read-list cleanup, and JSON backup and restore.

## Permissions and privacy declarations

### Single purpose

Help users organize and read articles saved in Microsoft Edge Favorites, keeping
their reading progress, annotations, and related organization data locally.

### Permission justifications

| Permission | Why Ready needs it |
| --- | --- |
| `bookmarks` | Read the Favorite tree; keep linked metadata current; link, create, restore, and move Favorites. Delete linked Favorites only after explicit user confirmation. Edge owns native bookmark synchronization. |
| `activeTab` | Access the current page after a user action to save it and activate its reading layer. |
| `tabs` | Read tab URLs and titles to save the current page, find already-open articles, and open or resume the correct article. It is not used to record a general browsing history. |
| `scripting` | Inject the bundled reading layer into supported pages to restore highlights and saved positions and record reading progress. |
| `contextMenus` | Provide the Save to Ready browser context-menu action. |
| `sidePanel` | Display the reading library and controls in the Edge sidebar. |
| `storage` | Store local preferences such as the save destination, view controls, and cleanup settings. Reading records are stored in IndexedDB. |
| `favicon` | Display website icons through the browser's favicon service. |
| Optional `http://*/*`, `https://*/*` | Request access to a specific website when the user saves or opens an article, so the reading layer can track progress and restore annotations there. Broad patterns allow users to choose their own sites; they do not grant all-site access at installation. |

### Data-use explanation for reviewers

Ready locally accesses and processes saved URLs, titles, Favorite folders and
identifiers, page text around selections, reading positions and time, highlights,
private notes, tags, and source metadata. These can contain personal or sensitive
information. They are **not transmitted to or collected by the publisher**, sold,
used for advertising, or shared with a Ready backend. There is no Ready backend.

Do not describe Ready as "not accessing any user data." Where Partner Center
asks about local access/use, disclose the categories above. Where it asks about
publisher collection/transmission, explain that none occurs. Read the actual
current wording before selecting checkboxes; do not mechanically answer every
privacy question "No."

Exported JSON files contain private data and are saved only at the user's request.
Imports are processed locally. Full backups include archived history and sessions.
Removing an active article retains its history, URL, and historical Favorite
reference for statistics, but deletes its highlights and private notes. Uninstall
removes extension storage, not Edge Favorites or previously exported files.

Opening a website or a support link, browser favicon retrieval, Edge Favorites
sync, and extension-store updates involve their respective providers under their
own policies. Support messages are handled under the website's contact policy.

### Remote code

Ready executes only JavaScript bundled in the extension. It does not load remote
scripts, use `eval` to run downloaded code, fetch executable modules, or call an
AI service. It has no remote configuration that changes executable behavior.
No credentials or test account are needed for certification.

## Store images

After building, run `npm run store:assets`. This uses installed Microsoft Edge
with an isolated temporary profile and synthetic example data, never your real
Favorites or reading data. It writes the following files to `release/store/`:

- `logo-128.png`: the existing 128 x 128 product icon (meets the minimum size).
- `01-library.png`: Library and its Favorite connections.
- `02-sources.png`: Sources in dark mode.
- `03-statistics.png`: local reading statistics.

Screenshots are actual extension-page UI rendered in Edge, not screenshots of
native browser chrome or evidence of store installation. Each is 1280 x 800 PNG.
Inspect them before upload. Do not upload screenshots containing real user data.
Screenshots are optional (up to six); accepted dimensions are 640 x 480 or
1280 x 800. The required square logo is at least 128 x 128; Microsoft recommends
300 x 300. Optional promotional tiles are not required for this submission.

## Reviewer instructions

1. Install the submitted package in Edge and select Ready's toolbar action to
   open the sidebar. No login, purchase, or setup key is needed.
2. Open a normal HTTPS article and select **Save page**, or use
   **Alt+Shift+S**. Accept the requested access to that site. Browser internal
   pages, extension stores, PDFs, and restricted pages cannot run the reading layer.
3. Use **Link** to select an existing Favorite or folder. Confirm the linked
   Favorite path and inherited tags. Use an article's action menu to move it.
4. Open an article, scroll while the tab is visible, and return to Ready.
   Verify progress and **Resume**. Select a passage in the article to create a
   highlight and a private note. Reload and verify persistence.
5. Add tags; exercise Filter, Group, Sort, List, and Kanban. Use **Sources** to
   create a source manually, from an article, or with the contextual **Save source**
   header button for the active website. Confirm the button shows **Page saved**
   or **Source saved** for an existing item. Saving a source does not create a
   Favorite or request site access. Sources and Discover do not
   fetch feeds, scrape sites, or call a remote recommendation service.
6. Mark an article read. Choose **Keep in list** or **Remove from list**.
   Statistics retain its reading history. Favorite deletion is a separate,
   unchecked option in Ready's removal confirmation.
7. In **Settings**, export a full backup, select that JSON file for import,
   inspect the preview, and apply it. No upload is made to a server.
8. Optionally enable read-list cleanup with a small limit. Only excess read
   articles are archived; Edge Favorites remain untouched.
9. After an extension update or reload, reload already-open article tabs.
   Existing injected scripts cannot communicate with the reloaded extension.

Automated Chromium and Edge annotation tests pregrant access to their synthetic
fixture origin to avoid native permission dialogs. They do **not** validate the
actual install-time/per-site permission prompt; test those manually with the ZIP.

## Release and submission checklist

- [ ] Confirm the Ready privacy section is publicly accessible at the exact URL above.
- [x] Run `npm run check`.
- [x] Run `node scripts/package-extension.mjs` and `npm run test:distribution`.
- [x] Run `npx playwright test` for the default Chromium suite.
- [x] Run `npm run test:edge` on a machine with Microsoft Edge installed.
- [x] Run `npm run store:assets` and visually inspect every upload image.
- [ ] Extract `release/ready-0.1.0.zip` into a new permanent directory and load
      that directory in a disposable Edge profile. Verify the checksum first.
- [ ] Manually verify the real toolbar/sidebar, site permission grant/denial,
      keyboard shortcut, save/link/move, reading layer, deletion confirmation,
      backup/import, extension reload, and uninstall behavior.
- [ ] Confirm the Partner Center account, verified publisher identity, and
      developer agreement. Select **Public** and **English (United States)**.
- [ ] Upload the ZIP, not the checksum or the containing release directory.
      Add the listing, logo, screenshots, support URL, privacy URL, single-purpose
      explanation, and truthful permission/data-use disclosures.
- [ ] Review the final draft, submit for certification, and retain the submission
      identifier. Certification and its timing are Microsoft's decision.
- [ ] After approval, verify the live store URL and install the store build in a
      clean profile. Add the real store link to the public website and README.

The workflow **Release candidate** creates a draft GitHub release only. It never
submits to Partner Center. Checks passing do not mean the extension is submitted,
approved, certified secure, or publicly available.

### Moving from an unpacked installation

Before removing the old installation, export **all** data in Settings and keep the
JSON file. Install the store version, import the backup, review the merge preview,
and verify articles, annotations, sources, and statistics. The store installation
may have a different extension ID and therefore separate storage. Ready reconciles
Favorites in the current profile during import. A backup does not recreate a
deleted Favorite automatically; restore or link it explicitly when needed.
Only remove the old installation after verifying the new one.

### Updates after publication

Keep the assigned store identity. Increment the version in `package.json`,
`package-lock.json`, and `public/manifest.json`, including `version_name`. Update
release notes and policy if behavior changes. Repeat validation, upload the new
ZIP to the existing Partner Center product, and submit the update. Never uninstall
the current extension as an update procedure.

## Official references

- [Publish a Microsoft Edge extension](https://learn.microsoft.com/microsoft-edge/extensions/publish/publish-extension)
- [Microsoft Edge Add-ons developer policies](https://learn.microsoft.com/legal/microsoft-edge/extensions/developer-policies)

Requirements were reviewed on November 16, 2026. Partner Center's current prompts
and policies take precedence if they change.
