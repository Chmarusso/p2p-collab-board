# Plan: Kanban board (Trello-style)

Status: **desktop done (phases 1–5); phase 6 (CLI) and 7 (iOS) remain**. Nothing here is implemented yet.

## Goal

Turn the board from a single vertical feed of posts into a horizontal Kanban board:

- Default columns **New**, **In progress**, **Done**; members can add, rename, reorder
  and delete columns.
- Cards move between columns (drag and drop on desktop).
- Board look is customizable: background and accent/column colors.
- Card descriptions and comments support **Markdown** with **code highlighting**.
- **@mentions** of other members, with a visible "you were mentioned" signal.
- **Due dates** and **labels** on cards.

Votes, comments, images, invites and encryption keep working as they do today.

## Where we start (code-verified)

- All board logic lives in `workers/main.js`. State is an in-memory `Map` of objects
  rebuilt from an Autobee log of **signed, encrypted operations**: `create`,
  `profile`, `vote`, `comment`. The view is sorted by `op:<writer>:<length>`, **not
  causal order**, so `loadBoard()` applies creates first and dependents after.
- Three hosts render the same worker state: desktop (`renderer/app.js`, vanilla JS, no
  bundler), iOS (`apps/mobile/src/App.tsx`, React Native) and CLI (`apps/cli`).
  Message names are shared through `packages/board-protocol`.
- Peers also gossip a full **unsigned snapshot** every second (`board:state`) and
  merge it with `mergeBoardObject()`. Fine for append-only data (posts, comments),
  but **wrong for mutable data**: a snapshot can't tell an old card position from a
  new one, and it isn't signed, so any member could rewrite another member's edit.

## Key design decisions

### 1. Mutable state = signed ops + last-writer-wins

Every change is a new signed op appended to the log, like today. For fields that can
change (card column/position, title, labels, due date, column name, board theme), each
op carries a timestamp `ts` (ms) and the state keeps, per field, the op with the
highest `(ts, identity, opId)`. That's deterministic whatever order the ops are
applied in, so it works with the non-causal Autobee view and gives the same result on
every peer.

### 2. Snapshots stop carrying mutable state

`board:state` today merges whole objects. Change it to gossip the **signed ops** (or
just their ids, plus a request for the missing ones) instead of derived objects. Each
receiver checks signatures and runs the same LWW reducer. That closes the unsigned
overwrite hole and keeps moves from flip-flopping between peers. Autobee replication
stays the durable path; live broadcast stays the fast path.

### 3. Default columns are virtual

`New`, `In progress`, `Done` get fixed ids (`col:new`, `col:doing`, `col:done`) and
exist on every board with no op written. Without that, two peers opening the same new
board offline would each create their own three columns. Renaming or deleting them is
an ordinary column op.

### 4. Ordering uses fractional indexes

Card and column positions are sortable strings (fractional indexing: a key between
two neighbours, tie-broken by card id). A move is one op (`columnId`, `position`), no
renumbering of other cards, and concurrent moves converge.

### 5. Back-compat

- Existing posts have no `columnId` → shown in **New**, sorted by `createdAt`.
- Old clients drop unknown op types (`applyBoardMessage` returns `false`), so a mixed
  board stays readable; old clients just won't see columns, moves or edits. The
  release notes should say "update all devices".
- The `vote` and `comment` ops stay as they are.

## Data model (new op payloads)

| Op                  | Fields                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `column:upsert`     | `columnId`, `name?`, `position?`, `color?`, `ts`                                         |
| `column:delete`     | `columnId`, `ts` (its cards move to the first remaining column; tombstoned, not dropped) |
| `card:update`       | `objectId`, any of `title`, `body`, `dueDate` (ISO date or `null`), `labelIds`, `ts`     |
| `card:move`         | `objectId`, `columnId`, `position`, `ts`                                                 |
| `card:archive`      | `objectId`, `archived` (bool), `ts`                                                      |
| `label:upsert`      | `labelId`, `name`, `color`, `ts` (board-level label set, like Trello)                    |
| `label:delete`      | `labelId`, `ts`                                                                          |
| `board:theme`       | `background` (preset id or color/gradient), `accent`, `ts`                               |
| `create` (extended) | adds optional `columnId`, `position`, `labelIds`, `dueDate`, `mentions`                  |
| `comment` (ext.)    | adds optional `mentions` (array of identity keys)                                        |

Validation lives in the worker: string lengths capped, colors restricted to a palette
or `#rrggbb`, dates parsed, unknown label/column ids ignored at render time.

## Feature details

### Horizontal Kanban (desktop)

- `#board-objects` becomes a horizontal, scrollable row of columns. Each column has a
  header (name, card count, menu: rename / color / delete) and a "+ Add card" button.
- "+ Add column" at the end of the row.
- Cards show: title, labels (chips), due date (red when overdue, amber within 24h),
  vote score, comment count, image count, mention indicator.
- Clicking a card opens a **detail modal**: Markdown description (edit/preview), labels,
  due date, comments, images, votes, archive.
- Drag and drop: native HTML5 DnD for cards between and within columns, and for
  reordering columns. Keyboard alternative: "Move to…" in the card menu.

### Theme and colors

- Board settings panel: background presets (solid colors and gradients) plus a
  custom color picker, an accent color, and per-column header colors.
- Stored as `board:theme` / `column:upsert.color`, so everyone on the board sees the
  same theme (Trello behavior).
- Applied as CSS variables on the board container; text contrast is computed
  automatically so cards stay readable.
- **Not in phase 1:** background images (would go through Hyperblobs, like
  attachments).

### Markdown and code highlighting

- Desktop: `marked` + `DOMPurify` + `highlight.js` (core plus a few common languages),
  vendored into `renderer/vendor/` because the renderer has no bundler.
  **Sanitizing is mandatory:** card text comes from other peers and the renderer has
  `window.bridge`, so unsanitized HTML would be an XSS that can drive the worker.
  Links open in the external browser; no raw HTML, no remote images.
- Mobile: `react-native-markdown-display` with a monospace code style (highlighting
  can follow later).
- CLI: shows the raw Markdown.

### @mentions

- Typing `@` in a description or comment opens an autocomplete of board members
  (from `profiles`). The text stores `@displayName`; the op also carries a `mentions`
  array of identity keys, so renames don't break it.
- Mentions render as highlighted chips. When a card or comment mentions you, it gets
  a badge, the top bar shows a "Mentions" counter/inbox, and desktop shows a native
  notification (new `notify` bridge call in `electron/preload.js` → `Notification` in
  main).
- What's read is tracked locally (per identity, per board), not synced.
- Limitation: P2P with no push server, so a member only gets notified once their
  device syncs the op. Mobile push is out of scope.

### Due dates and labels

- Due date picker on the card (date, optional time). Overdue/soon styling. Optional
  "sort by due date" in a column menu.
- Board-level labels (name + color, Trello's 10-color palette), managed from board
  settings or inline from the card. Filter bar: by label, by member mentioned, by due.

## Delivery phases

Each phase ends with a PR to `main`.

1. **Worker + protocol foundation.** LWW reducer, new op types and validation,
   virtual default columns, snapshot fix (signed-op gossip), back-compat for old
   posts. New `scripts/test-kanban-convergence.mjs`: two or three peers make
   concurrent moves/edits offline, reconnect, and must end with identical state.
   Rebuild the mobile worker bundle. Check `npm run package` boots.
2. **Desktop Kanban UI.** Columns, add/rename/reorder/delete, card detail modal, drag
   and drop, keyboard move.
3. **Markdown + code highlighting + @mentions** (desktop), notification bridge.
4. **Due dates + labels + filters** (desktop).
5. **Theme customization** (desktop).
6. **CLI:** `columns`, `move <card> <column>`, `label`, `due`, `show` with
   columns/labels/due date.
7. **iOS:** horizontally paged columns, long-press "Move to…", card detail with
   Markdown, labels, due dates, mentions. Rebuild the bundle and OTA.

Phases 2 to 5 can be reordered; phase 1 has to come first.

## Things that need the maintainer's approval (per AGENTS.md)

- **New dependencies:** `marked`, `dompurify`, `highlight.js` (desktop),
  `react-native-markdown-display` (mobile), maybe `fractional-indexing` (tiny, could
  be inlined instead).
- **Wire-protocol change** to `board:state` snapshots. Coordinated across all three
  clients, but not a `pear.json` / multisig change.
- New bridge surface (`notify`) in `electron/preload.js` + `electron/main.js`. No new
  CLI flags or launch surfaces.

## Verification per phase

- `npm run lint` passes.
- Convergence test passes (phase 1+) and the existing `test:board-replication` /
  `test:clipboard` still pass.
- `npm run package` → packaged app boots, opens an existing (pre-Kanban) board, posts
  show in **New**.
- Two dev instances (`npm start -- --storage <dir>`) see the same moves, edits, theme
  and mentions live.
- XSS check: a card with `<img onerror>` / `javascript:` links renders inert.

## Decisions (2026-10-22)

1. Theme is **shared by the whole board**, synced as a signed `board:theme` op.
2. **Any member** can edit, move and archive cards and manage columns.
3. **Votes stay**: a compact score badge on the card, full vote buttons in the detail
   modal.
4. New dependencies **approved**: `marked`, `dompurify`, `highlight.js`,
   `react-native-markdown-display`.
5. Client order: **desktop first**, then CLI, then iOS.

## Phase 1 notes

- The reducer is `packages/board-protocol/board.js` (`deriveBoard`). The worker keeps
  verified ops and re-derives the board from them; `board-state` now also carries
  `columns`, `labels` and `theme`.
- Found while testing: `chatSwarm` never joins a topic (on `main` too), so the room
  channel (live `board:message` broadcast and the old snapshot gossip) never
  connects. All sync goes through Autobee replication. The room-channel code now
  gossips signed ops and digests, so it is safe to switch on later, but it isn't
  live yet. Deciding whether to join it or delete it is a separate change.
- Tests: `npm run test:kanban` (reducer convergence + the real worker, including
  a restart). `npm run test:kanban-peers` runs two workers over the public DHT
  and depends on the network: when it fails, both sides report 0 peers.

## Phase 2 notes

- `renderer/`: horizontal columns, "Add a card" per column, add / rename / move /
  delete columns (delete needs a second click), card detail dialog (title,
  column, description, images, votes, comments, archive), "Show archived",
  drag and drop for cards and columns, Alt+arrow keys to move the focused card.
- Fixed in the worker: card and comment ids were `<identity>-<ms>`, so two cards
  created in the same millisecond collided and the second one was dropped. They
  now get a random suffix.
- Checked over CDP in the dev app and in the packaged app (no keychain: the test
  uses an in-memory identity).

## Phase 3 notes

- `renderer/markdown.js`: marked → DOMPurify, raw HTML shown as text, no images,
  only http(s)/mailto links, read-only task checkboxes. Code blocks highlighted
  with highlight.js (13 languages) from `@highlightjs/cdn-assets`, the project's
  browser ES-module build (the `highlight.js` npm package is CommonJS inside).
- @mentions: `@` opens a member picker in the description, comment and new-card
  fields; ops carry `mentions` (identity keys). Mentions of you show a badge on the
  card, an inbox in the top bar and a desktop notification while the window is in
  the background (web `Notification`, no bridge change needed). Read state is in
  `localStorage`, per identity and board.
- Checked with a second worker over the DHT: the comment, the notification, the
  inbox and marking as read all worked. XSS payloads (`<img onerror>`, `<script>`,
  `javascript:` / `data:` links) render inert, in dev and in a packaged copy
  outside the repo.

## Phase 4 notes

- Card dialog: labels (Trello's 10-color palette; create, rename, recolor, delete
  with confirmation; a label created from a card is put on it) and a due date
  with optional time. Date-only due dates are due at the end of that day.
- Card face: label chips, due badge (amber within 24 h, red when overdue).
- Filter panel: labels (any of), mentioned member, due (overdue / next 7 days /
  none). Filters are local to the device and reset when you switch boards.
- Worker: `board:label-upsert` accepts a client-chosen `label:<12 hex>` id.
- Not done: "sort column by due date" (it would write one move op per card).

## Phase 5 notes

- "Customize" panel: six gradient backgrounds plus a custom color, seven accent
  colors plus a custom one, shared by the board (`board:theme`). Per-column color
  from the column header (palette icon), shown as the column's top border.
- Text on a light custom background turns dark; the accent's button text picks
  black or white by luminance. Cards and columns keep their own dark surfaces so
  they stay readable on any background.
- Leaving a board resets the theme; boards without one keep the default look.
- Checked in dev and in a packaged copy outside the repo, together with the
  phase 2 and phase 4 flows.

## Polish after phase 5

- Motion (find-animation-opportunities → animate → review-animations): cards and
  columns a peer moves slide into place (FLIP, 220 ms, ease-in-out); your own
  drags and keyboard moves stay instant. Card press feedback, dialog and panel
  entries, drop marker entry, mentions pop. `--ease-out` / `--ease-in-out` tokens;
  reduced motion keeps fades and drops movement. No entry motion on bulk loads.
- Labels: every board label is a one-click chip on the card, plus a "New label"
  box (Enter creates or reuses by name). Renaming, recoloring and deleting moved
  to a separate Labels screen with usage counts.
- Due date: hidden behind an "Add due date" button; a popover holds the date and
  an optional time.
- Stress test (break-ui) with `npm run dev:worst-case` against a dev app with
  `--remote-debugging-port`. Fixed: dialog overflow from long URLs, tables and
  code; long titles in the dialog; the identity button wrapping and widening the
  page at 320 px; due dates without the year; label chips wrapping; column names
  truncated by invisible tools; RTL text; same-millisecond comments out of order;
  uncapped board names (now 100) and comments (now 5,000).
- Defaults chosen for you (easy to change): card faces show 4 labels then "+N",
  titles clamp to 4 lines, the dialog shows the latest 10 comments.
- Open: boards with 1,000+ cards rebuild every card on each update; virtualizing
  is a separate change.
- Board description: shared `board:info` op (last writer wins, 2,000 chars,
  Markdown), shown under the board name, two lines with "More", edited in place.
- Images in card descriptions: upload, paste or drop in the description editor.
  `card:image` adds refs to the card as an add-only set, so concurrent uploads
  all survive (12 per card). Markdown `![alt](image:<key>)` shows only the card's
  own encrypted attachments; remote images stay blocked. The first image is the
  card's cover on the board.
- Notifications across boards: a bell in the header with alerts from every
  joined board (mentions, due soon / overdue, others' comments, moves and edits
  on my cards, new cards; last 14 days). The open board updates live; the others
  are checked in the background every 3 minutes. Clicking an alert switches board
  and opens the card. Rules in `board-protocol/alerts.js`.
- Fixed on the way: boards created on one device shared one Autobee (same key);
  new boards now get their own namespace (`board-spaces.json`), legacy boards keep
  working. Leaving a board right after an edit no longer drops the edit, and
  opening/leaving boards no longer race. `npm run test:board-spaces` covers these.
