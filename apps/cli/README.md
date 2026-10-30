# OpenCollab CLI

Command-line client for OpenCollab boards. It runs the same Bare backend as the
desktop and mobile apps (`workers/main.js`), so boards, posts, comments, votes and
encrypted images are shared with them.

```sh
npm run cli -- --help            # from the repo root
npx opencollab --help            # after npm install (workspace bin)
```

## Quick start

```sh
opencollab identity new          # prints your recovery phrase — keep it offline
opencollab create "Team board"   # prints the invitation link
opencollab create --sample       # or a board of sample cards that show the features
opencollab create "Meals" --kind recipes   # board type: kanban (default), todo, feed, recipes
opencollab join <invite>         # or join someone else's board
opencollab name Alice            # display name on the current board
opencollab avatar me.png         # avatar on the current board ("clear" removes it)
opencollab post "Idea" --body "Details" --image photo.jpg
opencollab posts --comments
opencollab comment 1 "Agreed"   # or `comment 1 -` to read the text from stdin
opencollab vote 1 up             # up | down | clear
opencollab images 1 --out ./downloads
opencollab attach 1 shot.png -i demo.mp4    # add images or videos to an existing card
opencollab watch                 # stay online and print new activity
```

## Kanban

Cards are picked by their `#N` number from `opencollab posts`/`board`, an id prefix,
or their title (a unique part of it works); columns by number, name or id.

```sh
opencollab board                 # columns with their cards (--archived, --json)
opencollab column add Review     # also: column rename <col> <name>, move <col> <pos>, delete <col>
opencollab move 3 Review         # to the bottom of Review (--top for the top)
opencollab edit 3 --title "New title" --body "Markdown **works**"
opencollab label 3 add bug       # creates the label if it is new (--color #f87168)
opencollab label 3 remove bug
opencollab labels
opencollab due 3 2026-12-31 --time 17:00   # or: opencollab due 3 clear
opencollab archive 3             # restore 3 brings it back
opencollab describe "What this board is for"
opencollab kind                  # board type; owner: `kind recipes --sections` changes it
opencollab notifications         # mentions, due dates and activity across your boards
```

Planning and tracking:

```sh
opencollab add "Fix login" --column "To do" --assign me --item Repro --due 2026-12-31
echo "Call the bank" | opencollab add -   # quick capture: one card per stdin line
opencollab show "Fix login"      # checklist, assignees, links, estimates, reactions, comments
opencollab cards --sort due      # table; --sort due|updated|points|title|column,
                                 # --assignee me, --label bug, --column Review, --json
opencollab due                   # agenda: Overdue, Today, This week, Later
opencollab checklist add 3 "Write tests"   # also: check/uncheck/rename/rm <card> <item>
opencollab assign 3 Alice        # name, identity prefix or "me"; comma-separated; unassign
opencollab mine                  # open cards assigned to you, across your boards
opencollab react 3 rocket        # 👍 ❤️ 🎉 😂 😮 🚀 👀 🔥 or +1/heart/tada/…; --comment <n>; unreact
opencollab link 3 blocks 5       # or: link 3 relates 5; unlink 3 5 (--kind blocks)
opencollab wip Review 3          # WIP limit (off clears); listings warn at/over it
opencollab estimate 3 5          # planning-poker vote, hidden until `reveal 3`
opencollab points 3 5            # agreed points (off clears)
opencollab activity [card]       # board or card history (-n 50, --json)
opencollab stats                 # throughput per week, cycle time, columns, members
opencollab rules add "Triage" --when create --column Backlog --label bug --due-in 3
opencollab rules add "Standup" --when schedule --every day --title "Standup" --item Today
opencollab rules list            # also: enable/disable/rm <rule>
opencollab template apply sprint --yes     # or bugs | personal: renames/adds columns, adds labels
opencollab template mark 3       # card template; `add "New bug" --from-template 3` copies it
```

Listings mark cards `blocked` (an open card blocks them), `stale Nd` (untouched for 7+
days, not in Done), with checklist progress `☑ 2/5`, assignees and points. The last
column is always Done. Template cards are listed under "Templates", not in columns.

`--board|-b` picks a remembered board by name or number (`opencollab boards`); the
latest is used by default. `--wait|-w` sets how long to wait for peers (default 10s).

## Install from pear and OTA updates

The CLI ships as a self-contained bundle on its own pear link
(`upgrade` in `apps/cli/package.json`). It needs Node.js on the machine.

```sh
pear install --to ~/.local/share pear://q1huw5ozxk8j36pcb8sicfr4dtgf9154r5aj3yzqa14ngxxq1kmy
ln -s ~/.local/share/opencollab/bin.js /usr/local/bin/opencollab
opencollab version
```

An installed CLI checks its link whenever it runs. A newer version is downloaded and
swapped into the install folder in the background and takes effect on the next run;
`opencollab update` waits for it explicitly. Running from the repo never self-updates.

Releasing a new CLI version (from the repo root; keep the bundle outside the repo):

```sh
npm pkg set version=1.0.4 --workspace @opencollab/cli   # strictly higher than the last one
node apps/cli/scripts/dist.js /tmp/opencollab-cli-build/opencollab
pear build --package /tmp/opencollab-cli-build/opencollab/package.json \
  --darwin-arm64-app /tmp/opencollab-cli-build/opencollab --target ../opencollab-deploy/cli-1.0.4
pear stage <cli-link> ../opencollab-deploy/cli-1.0.4
pear seed <cli-link>   # keep running somewhere reachable
```

The bundle folder must be named `opencollab`: `pear install` and the updater look for
`/by-arch/<host>/app/opencollab`. Bundles are per platform (native prebuilds for other
hosts are pruned), so build one per OS/arch you ship.

## Storage and secrets

- Default storage: `~/.opencollab-cli` (`--storage|-s` to change). One identity per
  storage directory.
- The identity is encrypted with your password by the worker; remembered invitations
  are encrypted with the same password. Set `OPENCOLLAB_PASSWORD` (and
  `OPENCOLLAB_MNEMONIC` for `identity import`) to run without prompts.
- Creating or importing a different identity forgets remembered boards.

## How sync works

Each command opens the board, waits for peers, acts and leaves. Changes made while no
other member is online are saved locally and sync the next time the CLI runs with a
peer online. Run `opencollab watch` on an always-on machine to keep a board (and the
images its members have viewed) available, or a [blind peer](../blind-peer/README.md)
to keep every board available without giving the server the invite.
`OPENCOLLAB_BLIND_PEERS=<key>,<key>` overrides the built-in blind peer list.

## AI clients (MCP)

`opencollab mcp` serves a board to any [Model Context Protocol](https://modelcontextprotocol.io)
client (Claude Desktop, Claude Code, ChatGPT, Cursor, local agents) as a member with this
storage's identity. Unlike the other commands it opens the board once and stays online, so
tool calls answer in milliseconds. Give the AI its own storage and identity, invite it like
a teammate, and remove it in Members to cut it off.

```sh
opencollab identity new -s ~/.opencollab-ai && opencollab join '<invite>' -s ~/.opencollab-ai
opencollab name Robo -s ~/.opencollab-ai
OPENCOLLAB_PASSWORD=… opencollab mcp -s ~/.opencollab-ai            # stdio
OPENCOLLAB_PASSWORD=… OPENCOLLAB_MCP_TOKEN=… opencollab mcp -s ~/.opencollab-ai --port 8787
```

Register it with your client:

```sh
claude mcp add opencollab -s user -e OPENCOLLAB_PASSWORD=… -- opencollab mcp -s ~/.opencollab-ai
codex mcp add opencollab --env OPENCOLLAB_PASSWORD=… -- opencollab mcp -s ~/.opencollab-ai
```

Claude Desktop (`claude_desktop_config.json`), Cursor (`~/.cursor/mcp.json`) and most
other clients take this JSON. GUI clients don't see your shell's `PATH`, so use absolute
paths; from a clone, use `"command": "node"` with `apps/cli/bin.js` as the first argument.

```json
{
  "mcpServers": {
    "opencollab": {
      "command": "/usr/local/bin/opencollab",
      "args": ["mcp", "-s", "/home/me/.opencollab-ai"],
      "env": { "OPENCOLLAB_PASSWORD": "…" }
    }
  }
}
```

With `--port` it serves Streamable HTTP at `/mcp` and requires `Authorization: Bearer
<token>` (`OPENCOLLAB_MCP_TOKEN`, or a random token printed at start). It listens on
127.0.0.1 unless `--host` says otherwise; put a TLS proxy in front before exposing it.

| Tools                                                                                                                              |                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `list_boards`, `open_board`, `board_overview`, `list_cards`, `get_card`, `agenda`, `activity`                                      | read                                                                      |
| `wait_for_mentions`                                                                                                                | long-poll: @mentions and assignments (or all new activity) since a cursor |
| `create_card`, `update_card`, `move_card`, `add_comment`, `update_checklist`, `set_labels`, `set_assignees`, `react`, `link_cards` | write; left out with `--read-only`                                        |
| `archive_card`                                                                                                                     | only with `--allow-archive`                                               |

`board_overview` reports the board's type (Kanban, To-do list, Feed, Recipes) and the card
fields its members see; `create_card` and `update_card` take a `source` link ("View
original") for cards made from a web page or a shared post.

The resource `opencollab://board` holds the overview and every active card; subscribed
clients hear when it changes. The server's instructions tell the model to treat card and
comment text as other people's content, not as instructions. Still, anyone on the board
can write text the model reads: use `--read-only` for assistants that only need to read.

Coding agents can do the whole setup for you: the
[`opencollab-mcp` skill](../../.claude/skills/opencollab-mcp/SKILL.md) walks through the
identity, the client config, a working check and troubleshooting. Ask Claude Code to
"connect Claude to my OpenCollab board".

## Servers and bots

[docs/server.md](../../docs/server.md) covers running the CLI on a VPS as its own
member: systemd units, scripting with `--json`, and an example AI bot
([`examples/board-bot.mjs`](examples/board-bot.mjs)) that answers `@mentions`. Agents
such as Claude Code can drive the CLI with the
[`opencollab-cli` skill](../../.claude/skills/opencollab-cli/SKILL.md), or connect to
`opencollab mcp` (above).

[`examples/recipe-enricher.mjs`](examples/recipe-enricher.mjs) turns shared recipe posts
into recipes: for every card with a link that isn't labelled `enriched`, it fetches the
post's transcript and caption through [treg](https://treg.to) (TikTok, Instagram, YouTube,
X posts and articles, Spotify podcast episodes, or the page's text), asks a model command (`claude -p` by default) for ingredients and
steps, writes them into the description and labels the card. About $0.003 of treg calls per
video post; `--dry-run` shows the result without writing.

```sh
OPENCOLLAB_PASSWORD=… ENRICH_BOARD="Family recipes" node apps/cli/examples/recipe-enricher.mjs --dry-run
```

[`examples/feed-slides.mjs`](examples/feed-slides.mjs) turns shared posts into short stories
of key points that members watch in the app like Instagram stories (slides advance on
their own; tap, hold to pause, swipe for the next post). Per post it reads the caption or
article, the video's transcript and the card's comments, has a model write a hook and one
idea per slide, writes the deck into the description (slides
separated by `---`) and labels the card `slides`. About $0.002 of treg calls per post.

Spotify sells no transcripts, so a Spotify episode is read cheapest source first: the
title, show and length from Spotify's embed page, the show notes from Apple Podcasts, and
the transcript from the podcast's own RSS feed when the host publishes one (all free);
otherwise from the same episode on YouTube (about $0.003; it must come from the same show and
have the same length, so clips and recaps are skipped). Treg's Spotify scraper is the last resort, only for show notes nothing else had.
An episode with no transcript anywhere gets its slides from the show notes.

A card without a picture gets the post's own: for a Spotify episode its video thumbnail
or the show's cover, otherwise the page's link-preview image (`opencollab attach <card>
<image>` does the same by hand).

```sh
OPENCOLLAB_PASSWORD=… SLIDES_BOARD="To watch" node apps/cli/examples/feed-slides.mjs --dry-run
```

[`examples/feed-shorts.mjs`](examples/feed-shorts.mjs) turns new posts on a Feed board into
vertical shorts (≤ 90 s) that members watch one after another in the app's **Shorts**
player. Per post it gathers the caption, transcript, comments and web facts through treg,
has a model write a scene-by-scene script, records a voiceover, picks or generates a
picture per scene and renders a 1080×1920 video with captions using ffmpeg. The video is
posted as a card labelled `short`, linked to its post. About $0.07 of treg calls per short;
needs ffmpeg.

```sh
OPENCOLLAB_PASSWORD=… SHORTS_BOARD="Family news" node apps/cli/examples/feed-shorts.mjs --dry-run
```
