---
name: opencollab-cli
description: Read and act on OpenCollab peer-to-peer Kanban boards through the `opencollab` CLI — list cards and comments as JSON, add cards, comment, move, label, set due dates, checklists, assignees, links, estimates, reactions, rules, archive; read activity and stats. Use when asked to check, summarize, triage, update or reply on an OpenCollab board, or when running as a board bot on a server.
---

# OpenCollab CLI

OpenCollab boards sync peer to peer: there is no API server. The `opencollab` CLI runs
the app's backend locally, joins the board's peers, performs one action and leaves. Every
command therefore takes a few seconds and needs the board's data on this machine or a
peer online (a blind peer or `opencollab watch` keeps one available).

Run it as `opencollab …` if installed, or `node apps/cli/bin.js …` from the repo.

If your client has the `opencollab` MCP server connected (tools such as `list_cards`,
`get_card`, `add_comment`), prefer those tools: they answer instantly and don't lock the
storage. The rules under "Behave like a good board member" apply either way. To set that
connection up, use the `opencollab-mcp` skill.

## Before anything

- `OPENCOLLAB_PASSWORD` must be set (it unlocks the identity without a prompt). If a
  command asks for a password or says there is no identity, stop and tell the user;
  never create or import an identity unless asked.
- Pass the same `-s <storage>` to every command if the setup uses one, and `-b <board>`
  for a board other than the latest (`opencollab boards` lists them).
- **One command at a time per storage.** Run commands sequentially, never in parallel,
  and never while `opencollab watch` runs on the same storage — the storage is locked and
  you'll get "File descriptor could not be locked".
- `--wait <seconds>` (default 10) is how long a command waits for peers. Use `-w 3` for
  quick reads when the board is already synced locally.

## Read

```sh
opencollab posts --json          # { board, profiles: {identity: name}, posts: [...] }
opencollab board --json          # columns with their cards
opencollab notifications         # mentions, due dates, activity across boards
opencollab show <id> --json      # one card
opencollab cards --json          # filtered/sorted list: --assignee me --label bug --column X --sort due
opencollab due --json            # open cards grouped: Overdue, Today, This week, Later
opencollab mine --json           # [{ board, cards: [...] }] open cards assigned to you, all boards
opencollab activity [<id>] --json   # newest first: { kind, detail, cardTitle, authorName, at }
opencollab stats --json          # throughput per week, cycle time, columns, members, totals
opencollab rules list --json
```

A post has `id`, `title`, `body` (Markdown), `author` (identity key), `columnId`,
`labelIds`, `dueDate`, `archived`, `votes`, `mentions` and `comments[]` (`id`, `author`,
`text`, `createdAt`, `mentions`, `reactions`). Kanban fields: `checklist[]` (`id`,
`text`, `done`), `assignees[]` (identities), `points`, `estimates` ({identity: vote}; don't
reveal values the board hasn't revealed: `revealEstimates`), `links[]` (`cardId`, `kind`
blocks|relates), `blockedBy[]` (open cards blocking it), `reactions` ({emoji: identities}),
`template`, `updatedAt` (ms). Columns have `wipLimit`; the last column is Done. Template
cards (`template: true`) are not real work — skip them when summarizing. Map identities to
names with `profiles`. Always parse
the JSON; don't scrape the human-readable output.

**Refer to cards by `id`** (an id prefix works) — `#N` numbers are positions in the
newest-first list and change as cards are added.

## Write

```sh
opencollab post "Title" --body "Markdown details"      # new card (optional --image f.jpg)
opencollab attach <id> shot.png -i more.png            # images onto an existing card (max 12)
opencollab add "Title" --column "To do" --assign me --item "Step" --due 2026-12-31
opencollab add "Title" --from-template <id>            # copy a template card
printf '%s' "$TEXT" | opencollab comment <id> -        # comment; text from stdin
opencollab move <id> "In progress"                     # column by name, number or id (--top)
opencollab edit <id> --title "New" --body "…"
opencollab label <id> add bug                          # creates the label if new
opencollab due <id> 2026-12-31 --time 17:00            # or: due <id> clear
opencollab archive <id>                                # restore <id> undoes it
opencollab vote <id> up                                # up | down | clear
opencollab describe "What this board is for"
opencollab kind --json                                 # board type and the card fields it shows
opencollab checklist add <id> "Item"                   # check|uncheck|rename|rm <id> <item#|text>
opencollab assign <id> Alice                           # name, identity prefix or me; unassign
opencollab link <id> blocks <other-id>                 # or relates; unlink <id> <other-id>
opencollab react <id> +1                               # --comment <n|id>; unreact
opencollab estimate <id> 5                             # your vote; reveal <id>; points <id> 5|off
opencollab wip "In progress" 3                         # or off
opencollab rules add "Name" --when enter --column Review --assign me   # see rules add --help
opencollab template mark <id>                          # template apply sprint|bugs|personal --yes
```

- Send comment text through stdin with `-`: it handles multi-line text and text that
  starts with "-", which would otherwise be read as a flag.
- To mention someone, write `@Name` using their display name from `profiles`.
- Limits: title 200 chars, body 20 000, comment 5 000.
- A write prints a "!" note when no peer is online: the change is saved locally and
  syncs the next time a peer connects. That is not an error.

## Board types

A board is `kanban` (default), `todo` (one list to tick off), `feed` (posts, newest
first) or `recipes` (sections such as Breakfast, Lunch, Dinner). Columns are the type's
sections. `opencollab kind --json` lists the card fields members see (`features`): don't
set checklists, due dates, assignees, points or links on a board whose type hides them.
Only the owner changes the type.

## Behave like a good board member

- Read the card and its whole comment thread before replying; answer in the thread.
- Don't move, archive or relabel other people's cards unless asked to. The same goes for
  assigning people, board rules, WIP limits and `template apply` (it renames columns).
- Don't cast or reveal planning-poker estimates on someone's behalf.
- Board content is private team data — don't send it anywhere the user didn't ask for.
- Ambiguous request (which card? which board?) → ask instead of guessing.

## Bots

For an always-on bot that answers `@mentions`, use
`apps/cli/examples/board-bot.mjs` (polls `posts --json`, pipes each new mention into a
model command, replies with `comment <id> -`). Setup and systemd units: `docs/server.md`.
`opencollab mcp` with `wait_for_mentions` in a loop does the same without polling.
