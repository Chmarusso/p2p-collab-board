---
name: opencollab-mcp
description: Connect an AI client (Claude Code, Claude Desktop, Cursor, Codex, ChatGPT or a custom agent) to an OpenCollab peer-to-peer Kanban board through the `opencollab mcp` server — create the AI's own identity, join the board, register the server with the client, pick read-only or write access, run it over HTTP on a server, and use the tools (including `wait_for_mentions` for bots). Use when asked to connect, integrate, plug in or give an AI or agent access to an OpenCollab board, or to debug that connection.
---

# Connect an AI to an OpenCollab board (MCP)

OpenCollab has no API server: every client runs the board's backend itself.
`opencollab mcp` is that backend wrapped as a [Model Context Protocol](https://modelcontextprotocol.io)
server. It opens one board as a member, stays online, and answers tool calls in
milliseconds. Nobody hosts it centrally: the AI client launches it locally (stdio), or you
run it on your own machine or server (HTTP).

The AI is a board member like any other. It gets its own identity, is invited with a
normal invite link, shows up under Members, and is cut off by removing it there.

## 1. Find the CLI

Use the first that works and remember the absolute command for the config files. GUI
clients (Claude Desktop, Cursor) don't inherit your shell's `PATH`, so write absolute paths.

```sh
command -v opencollab                       # installed from Pear (see the root README)
node /abs/path/to/repo/apps/cli/bin.js --help   # from a clone, after npm install
```

In the steps below `opencollab` stands for that command.

## 2. Give the AI its own identity

Ask the user for an invite link (desktop or phone: board menu → Invite) and a password for
the AI's identity. Don't reuse the user's own storage: one storage can be open by one
process at a time, and a separate identity lets them see and revoke what the AI does.

```sh
export OPENCOLLAB_PASSWORD='…'              # the AI identity's password
opencollab identity new -s ~/.opencollab-ai # prints a recovery phrase: tell the user to keep it
opencollab join '<invite>' -s ~/.opencollab-ai
opencollab name "Claude" -s ~/.opencollab-ai  # how teammates @mention it
```

Joining needs a member online (or a blind peer) to let the AI in. If `join` times out,
ask the user to open the board on a device and run it again.

## 3. Register the server with the client

Pick the client. Replace the storage path and password; add flags from step 4 to `args`.

**Claude Code**

```sh
claude mcp add opencollab -s user -e OPENCOLLAB_PASSWORD='…' -- opencollab mcp -s ~/.opencollab-ai
```

**Codex**

```sh
codex mcp add opencollab --env OPENCOLLAB_PASSWORD='…' -- opencollab mcp -s ~/.opencollab-ai
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows), **Cursor** (`~/.cursor/mcp.json`)
and most other clients take the same JSON:

```json
{
  "mcpServers": {
    "opencollab": {
      "command": "/usr/local/bin/opencollab",
      "args": ["mcp", "-s", "/Users/me/.opencollab-ai"],
      "env": { "OPENCOLLAB_PASSWORD": "…" }
    }
  }
}
```

From a clone use `"command": "node"` and put `/abs/path/to/repo/apps/cli/bin.js` first in
`args`. Restart the client after editing its config.

**Remote clients (ChatGPT, hosted agents, several clients sharing one board)**: run the
HTTP transport on a machine you control and point the client at it.

```sh
OPENCOLLAB_PASSWORD='…' OPENCOLLAB_MCP_TOKEN="$(openssl rand -hex 32)" \
  opencollab mcp -s ~/.opencollab-ai --port 8787
claude mcp add --transport http opencollab http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer <token>"
```

It listens on 127.0.0.1 unless `--host` is given. To reach it from the internet, put a TLS
reverse proxy in front (systemd unit: `docs/server.md`). Every request needs the bearer
token; without `OPENCOLLAB_MCP_TOKEN` a random one is printed to stderr at start.

## 4. Choose what the AI may do

| Flag              | Effect                                                                      |
| ----------------- | --------------------------------------------------------------------------- |
| (none)            | read tools and write tools (cards, comments, moves, labels, checklists …)   |
| `--read-only`     | read tools only. Use for assistants that only summarize or answer questions |
| `--allow-archive` | adds `archive_card`. Off by default                                         |
| `-b <board>`      | open this board (name or number from `opencollab boards`), not the latest   |

Anyone on the board can write text the model reads. The server tells the model to treat
card and comment text as content, not instructions; for untrusted boards still prefer
`--read-only`.

## 5. Check it works

Before telling the user it's done, run the server by hand and call one tool:

```sh
(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"board_overview","arguments":{}}}'
 sleep 8) | OPENCOLLAB_PASSWORD='…' opencollab mcp -s ~/.opencollab-ai 2>/dev/null
```

Two JSON lines come back; the second holds the board's name and columns. Then check the
client: `claude mcp list` / `codex mcp list` should show `opencollab` connected, and in
other clients the tools appear in the tool list. Stop the hand-run server first: the
storage can't be open twice.

## Using the tools

- Start with `board_overview` (columns, labels, members, who you are), then `list_cards`
  with filters and `get_card` for one card and its whole comment thread.
- Refer to cards by the `id` the tools return.
- `agenda` groups open cards by due date; `activity` is the board or card history.
- Writes: `create_card`, `update_card`, `move_card`, `add_comment`, `update_checklist`,
  `set_labels`, `set_assignees`, `react`, `link_cards`. To mention someone, write
  `@Name` with their display name from `board_overview`; they get notified.
- `list_boards` / `open_board` switch boards the identity has joined.
- The resource `opencollab://board` is the whole board as JSON; subscribing gets a
  notification when it changes.

**Bots.** `wait_for_mentions` blocks until someone @mentions the AI or assigns it a card,
then returns the events and a `cursor`. Loop: call it with `after: <last cursor>`, read the
card with `get_card`, reply with `add_comment`, repeat. `include: "mine"` adds comments on
the AI's own cards; `include: "all"` returns all new activity. Calls return after at most
55 seconds with no events, so just call again.

Behave like a teammate: read the whole thread before replying, answer in the thread,
don't move, archive or relabel other people's cards or assign people unless asked, and
don't send board content anywhere the user didn't ask for.

## Troubleshooting

| Symptom                                    | Cause and fix                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `Set OPENCOLLAB_PASSWORD` and exit         | The env var is missing from the client config                                                                  |
| `File descriptor could not be locked`      | Another process uses the storage (`opencollab watch`, a CLI command, a second client). One process per storage |
| Writes refused: board has not synced yet   | The AI joined but no member has been online since. Open the board on a device                                  |
| Client shows the server failed / not found | Relative command or `PATH`: use the absolute path to `opencollab` or `node` + `bin.js`                         |
| HTTP 401                                   | Missing or wrong `Authorization: Bearer` header                                                                |
| HTTP 403                                   | `Host` isn't local. Connect via 127.0.0.1/localhost; behind Caddy add `header_up Host {upstream_hostport}`     |
| Server logs                                | They go to stderr (stdout is the protocol). Add `--verbose` for more                                           |

The `opencollab-cli` skill covers the one-shot CLI commands (rules, stats, templates,
estimates) that the MCP tools don't expose.
