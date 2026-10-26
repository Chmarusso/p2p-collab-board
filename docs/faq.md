# FAQ: how OpenCollab works without servers

### Where is my board stored if there's no server?

On every member's device. Each device keeps a full copy, as a set of signed append-only
logs ([Hypercore](https://github.com/holepunchto/hypercore)): one per member, merged into
one board ([Autobee](https://github.com/holepunchto/autobee)). Opening a board reads your
local copy, so it works offline and opens instantly. Syncing just exchanges the entries
the other side is missing.

### How do devices find each other without a server?

Through a distributed hash table, [HyperDHT](https://github.com/holepunchto/hyperdht),
which every running Holepunch app helps run. Each board has a topic derived from its key.
Members announce themselves under that topic and look up who else is there. Think of it
as a phone book that thousands of computers each hold a page of.

The only fixed addresses are three bootstrap nodes. A device uses them once, to find its
first DHT neighbours. DHT nodes only ever see a hash of a board's key, never the board or
your data. The bootstrap nodes can be swapped for your own.

### How do they connect if both are behind home routers?

With UDP hole punching. Both devices learn their public address from the DHT, then
send packets to each other at the same moment, so both routers open a path. That covers
most home, office and mobile networks. Every connection is end-to-end encrypted (Noise
protocol), and the DHT nodes that help with the introduction can't read it.

A few strict networks (some corporate firewalls, some carrier NATs) block hole punching.
A peer with a public IP, such as a [blind peer](../apps/blind-peer/README.md) on a VPS, is
reachable from anywhere and bridges the gap.

### What happens when nobody else is online?

You keep working. Your changes go into your own log on your device. They sync the next
time you and another member are online together, and every device then computes the same
board. Live sync needs two members online at the same time. For teams that aren't, run a
[blind peer](../apps/blind-peer/README.md): it keeps an encrypted copy available around
the clock.

### Who can read my board?

Only people holding the invite link. The link contains the board secret, which never
leaves it: card text, comments, the board name and attachments are encrypted with keys
derived from it. Blind peers and DHT nodes only ever handle ciphertext. Every change is
also signed by its author's key, so nobody can forge or rewrite someone else's edits.

### Two people edited the same card offline. Who wins?

Each change carries a timestamp, and for each field (title, column, labels…) the
newest change wins. Ties are broken the same way on every device. Comments, votes and
images are additions, so nothing is overwritten. Every device applies the same rules to the
same set of signed changes and ends up with the same board, whatever order they arrive in.

### Where does my account live? What if I lose my phone?

There's no account. Your identity is a key pair made on your device and backed up as a
recovery phrase. Enter the phrase on a new device and you're back, as the same member
of your boards. Without the phrase nobody, including us, can restore it.

### How do app updates arrive without a download server?

Through [Pear](https://docs.pears.com). A release is published to a peer-to-peer drive,
and installed apps fetch new versions from whoever has them, then verify them against the
publisher's key. The iPhone app gets JavaScript updates this way. Native changes still go
through the App Store.

### So there's really zero infrastructure?

Close to it. What remains:

- the DHT bootstrap nodes, used only to join the network
- optionally, a blind peer or an `opencollab watch` server for availability and bots
- the App Store, for the iPhone binary

None of these sees your board's content.
