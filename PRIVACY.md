# Privacy policy

_Last updated: 11 November 2026_

OpenCollab is a peer-to-peer app. There is no OpenCollab server, no account and no cloud
database. We, the developers, do not collect, receive or store any of your data. This policy
covers the desktop, iOS, Android and command-line apps. OpenCollab is maintained by the
OpenCollab maintainer ("we"), reachable at **CONTACT_EMAIL**.

## What stays on your device

- **Your identity** is a key pair created on your device and backed up as a 24-word recovery
  phrase. If you choose to save the phrase on the device, it is kept in the system's secure
  storage (the iOS Keychain or Android encrypted storage). It never leaves the device.
- **Your boards**, including cards, comments, images and your display name, are stored on your
  device.
- **Photos** are read only when you pick one to attach to a card. The app does not browse or
  upload your photo library.
- Settings such as theme and notification sound stay on the device.

## What is shared, and with whom

- **Board members.** A board's content is shared only with devices that hold its invite. It
  travels directly between those devices over encrypted connections, and is stored encrypted
  with the board's secret.
- **Your IP address.** To find each other, devices use a public peer-to-peer network (the
  Hyperswarm DHT). Like any direct connection, the peers you connect to and the network nodes
  that help set up the connection can see your IP address. They cannot read your boards.
- **Blind peers (optional).** If your team adds a blind peer, it keeps an encrypted copy of the
  board online so members can sync while others are offline. It cannot read the content, but
  its operator can see that a board exists, its size, members' public keys, when changes were
  made and the IP addresses that connect to it. None is set up by default; if a release turns
  one on, this policy will say so and name who runs it.
- **Bots your team adds (optional).** A team can run a bot, such as the example slide and
  recipe bots in the command-line app, as a member of its board. A bot reads the board like
  any member and may send card titles, descriptions, links and comments to the services it
  is set up with (for example an AI model or a web-reading service). Whoever runs the bot is
  responsible for it; the board's members can see it in the member list and remove it.
- **App updates.** The desktop and iOS apps download updates from other peers that have them.
  This reveals your IP address to those peers, as above.

## What we don't do

- No analytics, tracking, advertising or crash reporting.
- No selling or sharing of data, because we never have it.
- No location, contacts, camera or microphone access.

## Deleting your data

Uninstalling the app deletes everything it stored on your device. Copies of a board held by
other members stay on their devices until they uninstall the app. Because there is no server,
we cannot delete or restore data for you, and a lost recovery phrase cannot be recovered.

## Children

OpenCollab is meant for teams and is not directed at children under 13.

## Your rights

Because we don't hold your data, there is normally nothing for us to give you, correct or
delete. If you think we do hold personal data about you (for example in an abuse report you
sent), email **CONTACT_EMAIL** and we'll answer under the GDPR. You can also complain to your
data protection authority; in Poland that is the UODO (Prezes Urzędu Ochrony Danych
Osobowych).

## Changes and contact

Changes to this policy are published in this file; its history is in the repository. For
privacy questions, email **CONTACT_EMAIL**. For bugs, [open an issue on
GitHub](https://github.com/Chmarusso/p2p-collab-board/issues). See also the [terms of
use](TERMS.md).
