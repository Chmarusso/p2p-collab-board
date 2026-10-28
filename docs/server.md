# Running OpenCollab on a server

The CLI runs the same backend as the desktop and mobile apps, so a server can be a full
board member: it keeps a board online, posts updates, or answers questions as a bot. This
guide covers a Linux VPS. Anything that runs Node.js works the same way.

Two kinds of server process exist, and they do different jobs:

- **Blind peer** ([`apps/blind-peer`](../apps/blind-peer/README.md)): keeps _every_ board
  available while members are offline. It never joins a board and can't read it.
- **CLI member** (this guide): a real member of _one_ board, with its own identity. It
  reads and writes cards and comments. Use it for bots, automations and integrations.

## 1. Install the CLI

```sh
# Node.js first, then:
npx pear install --to ~/.local/share pear://q1huw5ozxk8j36pcb8sicfr4dtgf9154r5aj3yzqa14ngxxq1kmy
sudo ln -s ~/.local/share/opencollab/bin.js /usr/local/bin/opencollab
opencollab version
```

Installed this way, the CLI updates itself from peers. From a checkout, use
`node apps/cli/bin.js` instead of `opencollab`.

## 2. Give the server its own identity

Every server is a member with its own key, so its posts show under its own name. Never
copy your personal identity to a server.

```sh
export OPENCOLLAB_PASSWORD='long random password'   # encrypts the identity on disk
opencollab identity new -s /var/lib/opencollab/bot  # prints a recovery phrase: store it offline
opencollab join '<invite link>' -s /var/lib/opencollab/bot
opencollab name 'Robo' -s /var/lib/opencollab/bot
opencollab avatar robo.png -s /var/lib/opencollab/bot
```

`join` needs an existing member online once, to let the new member write. After that the
server works on its own.

Commands that run without prompts, for scripts:

- `OPENCOLLAB_PASSWORD` unlocks the identity.
- `OPENCOLLAB_MNEMONIC` supplies the phrase for `identity import`.
- `OPENCOLLAB_BLIND_PEERS=<key>,<key>` overrides the built-in blind peers.

## 3. Keep a board online

`opencollab watch` stays connected, so other members can sync with the server. It also
prints activity as it happens:

```ini
# /etc/systemd/system/opencollab-watch.service
[Unit]
Description=OpenCollab board peer
After=network-online.target

[Service]
User=opencollab
Environment=OPENCOLLAB_PASSWORD=change-me
ExecStart=/usr/local/bin/opencollab watch -s /var/lib/opencollab/peer
Restart=always

[Install]
WantedBy=multi-user.target
```

If you run a blind peer you don't need this just for availability.

## 4. Scripts and bots

Each CLI command is a short session: open the board, wait for peers (`--wait`, default
10s), act, leave. The useful building blocks:

| Command                              | Output                                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| `opencollab posts --json`            | `{ board, profiles, posts }`; each post has its `comments[]` |
| `opencollab board --json`            | columns with their cards                                     |
| `opencollab post "Title" --body "…"` | a new card in the first column                               |
| `opencollab comment <id> -`          | comment text from stdin (multi-line, may start with `-`)     |
| `opencollab move <id> <column>`      | moves a card                                                 |
| `opencollab label <id> add <name>`   | labels a card                                                |
| `opencollab notifications`           | mentions, due dates and activity                             |

Use card **ids** from the JSON, not the `#N` numbers. The numbers shift when cards are
added.

**One process per storage folder.** A storage folder is locked while a command or `watch`
uses it; a second process on the same folder fails with "File descriptor could not be
locked". So a bot polls with short commands instead of running `watch` on its own
storage. If you also want `watch`, give it a separate storage, which is a separate member.

### Example: an AI bot that answers mentions

[`apps/cli/examples/board-bot.mjs`](../apps/cli/examples/board-bot.mjs) polls the board.
When a card or comment mentions `@BotName`, it pipes the card, the thread and the message
into any command you choose, and posts what that command prints as a comment. It works
with any model: `claude -p`, `llm`, `ollama run …`, or your own script.

```sh
export OPENCOLLAB_PASSWORD=change-me
BOT_NAME=Robo \
BOT_STORAGE=/var/lib/opencollab/bot \
BOT_COMMAND='claude -p' \
node apps/cli/examples/board-bot.mjs
```

- On its first run it treats everything already on the board as answered.
- It records what it has handled in `bot-seen.json` in the storage folder.
- Set `BOT_BOARD` to pick a board and `BOT_INTERVAL` to change the poll (seconds).
- Run it under systemd like the `watch` unit above.

What it sends to the model is board content. Use a model or API you trust with that data:
the board is end-to-end encrypted, but the bot decrypts it.

### Connecting an AI client over MCP

`opencollab mcp` keeps the board open and serves it to any MCP client, which is faster
than polling and doesn't need a shell: every tool call answers in milliseconds, and
`wait_for_mentions` returns as soon as someone mentions the bot or assigns it a card. Run
it on the bot's storage instead of `board-bot.mjs` (both can't use the same storage):

```ini
[Service]
User=opencollab
Environment=OPENCOLLAB_PASSWORD=change-me
Environment=OPENCOLLAB_MCP_TOKEN=a-long-random-token
ExecStart=/usr/local/bin/opencollab mcp -s /var/lib/opencollab/bot --port 8787
Restart=always
```

It listens on 127.0.0.1; to reach it from elsewhere, put a reverse proxy with TLS in front
(or `--host 0.0.0.0` on a private network) and keep the token secret: whoever has it acts
as the bot's identity. Add `--read-only` for assistants that only read. See the
[CLI README](../apps/cli/README.md#ai-clients-mcp) for the tool list and client config.

On 127.0.0.1 the server only accepts requests whose `Host` is local (DNS rebinding
protection), so the proxy must send the upstream address as `Host`. nginx does by
default; Caddy needs it spelled out:

```
mcp.example.com {
	reverse_proxy 127.0.0.1:8787 {
		header_up Host {upstream_hostport}
	}
}
```

### Driving the CLI from an AI agent

[`.claude/skills/opencollab-cli/SKILL.md`](../.claude/skills/opencollab-cli/SKILL.md)
teaches an agent such as Claude Code to use the CLI: reading the board as JSON, posting,
commenting, moving cards and the storage-lock rule. Copy it into the agent's skills folder
on the server.

## Security notes

- The storage folder holds the encrypted identity and the remembered invites. Keep it
  `chmod 700` and owned by the service user.
- Anyone with the invite can read the board. Give a server only the boards it needs.
- To revoke a server, an owner or admin removes it in Members. It can still read what it
  already has, but its changes are ignored from then on.
