# Privacy policy

_Last updated: 26 October 2026_

OpenCollab is a peer-to-peer app. There is no OpenCollab server, no account and no cloud
database. We, the developers, do not collect, receive or store any of your data. This policy
covers the desktop, iOS, Android and command-line apps.

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
  board online so members can sync while others are offline. It cannot read the content. None
  is set up by default.
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

## Changes and contact

Changes to this policy are published in this file; its history is in the repository. For
questions, [open an issue on GitHub](https://github.com/Chmarusso/p2p-collab-board/issues).
