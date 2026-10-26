# OpenCollab blind peer

An always-on peer that keeps encrypted copies of OpenCollab boards online, without being
able to read them. It runs Holepunch's [blind peer](https://github.com/holepunchto/blind-peer)
([`blind-peer-cli`](https://github.com/holepunchto/blind-peer-cli)) on any machine with
Node.js, typically a small VPS.

## Why it's needed

OpenCollab has no server holding the board: every member's device keeps its own copy and
devices sync when they meet. That has one gap. **Two members have to be online at the same
time to sync.** If Alice adds cards on her laptop and closes it, Bob sees nothing until
Alice comes back.

A blind peer fills that gap. Each app registers the board with it, so the blind peer
downloads every change while its author is online and serves them later to whoever opens
the board. In the case above, Bob gets Alice's cards from the blind peer while her laptop
is closed. New members can also join a board while everyone else is offline.

It is _blind_ because it never gets the board secret, which only travels inside the
invite link. It stores and serves bytes it can't decrypt.

|                            | Blind peer                       | `opencollab watch` on a server        |
| -------------------------- | -------------------------------- | ------------------------------------- |
| Can read the board         | No                               | Yes: it's a member holding the invite |
| Boards it covers           | Every board the apps register    | One board per process                 |
| Needs an invite / identity | No                               | Yes                                   |
| Use it for                 | Availability for all your boards | Bots and automations (docs/server.md) |

### What the operator can and can't see

- **Can't see:** card titles, descriptions, comments, labels, the board name, images or
  videos. Board operations are encrypted with the board secret (XSalsa20-Poly1305) and
  attachments are block-encrypted with a key derived from it.
- **Can see:** that a board exists, its size, members' public keys (each operation is
  signed), when operations were made and their kind (for example "comment"), and the IP
  addresses that connect to it.

## Run it

```sh
cd apps/blind-peer
npm install          # standalone, not part of the root workspaces
npm start            # storage in ./storage (git-ignored)
```

On start it logs JSON lines. Copy the `publicKey` from the `Listening` line; that is
the key the apps need:

```json
{ "msg": "Listening", "publicKey": "es4n7ty45odd1udfqyi9xz58mrbheuhdnxgdufsn9gz6e5uhsqco" }
```

The key comes from the storage folder, so keep `storage/` across restarts or the key
changes. Useful flags (pass them after `--`, e.g. `npm start -- --max-storage 20000`):

- `--max-storage|-m <MB>`: disk cap, default 100000 (100 GB)
- `--port|-p <port>`: fixed DHT port; open it for UDP on the firewall
- `--debug|-d`: log every connection and core

### On a VPS (systemd)

```ini
# /etc/systemd/system/opencollab-blind-peer.service
[Unit]
Description=OpenCollab blind peer
After=network-online.target

[Service]
User=opencollab
WorkingDirectory=/opt/opencollab/apps/blind-peer
ExecStart=/usr/bin/npm start -- --port 49737 --max-storage 20000
Restart=always

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now opencollab-blind-peer
journalctl -u opencollab-blind-peer -f      # find the publicKey here
```

A VPS with a public IP works best. Behind a strict NAT it still works, but some members
may fail to hole-punch to it.

## Point the apps at it

Put the key in `BLIND_PEERS` in
[`packages/board-protocol/index.js`](../../packages/board-protocol/index.js):

```js
const BLIND_PEERS = Object.freeze(['es4n7ty45odd1udfqyi9xz58mrbheuhdnxgdufsn9gz6e5uhsqco'])
```

Then ship it: rebuild the mobile worker (`npm run --workspace @opencollab/mobile
bundle:bare`) and release desktop, mobile and CLI as usual. List two or more keys on
different machines for redundancy: each board is mirrored to the two closest.

The CLI can override the list without a release, which is handy for testing:

```sh
OPENCOLLAB_BLIND_PEERS=<key1>,<key2> opencollab watch   # empty value turns mirroring off
```

## How it works in the app

`workers/main.js` (`mirrorBoard()`) creates a
[`blind-peering`](https://github.com/holepunchto/blind-peering) client when a board opens
and registers the board's multi-writer log and this device's attachment store. Each member
registers their own attachments, so the blind peer ends up with all of them.

A joiner learns which members' logs the blind peer holds through the wakeup protocol. The
board's Autobee and the blind-peering client share one `protomux-wakeup` instance for this.
Without it the joiner would connect but receive nothing.

`npm run test:blind-peer` checks the whole path end to end over the public DHT. It starts a
blind peer, has a member create a board and go offline, then has a second member join and
read the board from the blind peer alone.
