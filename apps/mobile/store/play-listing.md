# Google Play listing

Drafts for the Play Console, in the order the console asks for them. Graphics live next
to this file; `scripts/store-graphics.sh` re-renders the icon and feature graphic from
their `.html` sources.

## Main store listing

**App name** (30 max): `OpenCollab`

**Short description** (80 max):

> Kanban boards for your team that sync device to device. No servers, no accounts.

**Full description** (4000 max):

Copy as is; line breaks are kept by Play.

```text
OpenCollab is a Kanban board for teams that runs without a server. Boards live on your team's phones and computers and sync directly between them, end-to-end encrypted. There is no account to create and nothing to sign up for.

PLAN THE WORK
• Columns and cards you drag between them
• Checklists, due dates, labels and assignees on every card
• Comments with @mentions, reactions and photo attachments
• My work: every card assigned to you, across all your boards
• Agenda view of what's due, and stats on what got done
• Templates for cards you create often, and simple automation rules

WORK TOGETHER, PEER TO PEER
• Invite teammates with a link, or a QR code they scan with their phone
• Changes sync between members as soon as they're online together
• Works offline: keep working and it catches up when a teammate is reachable
• Owners and admins can remove members; anyone can block or report a member

PRIVATE BY DESIGN
• No servers, no analytics, no ads, no tracking
• Your identity is a key pair created on your phone, backed up as 24 recovery words
• Optionally keep the recovery words in Android's secure storage, unlocked with your fingerprint

ONE BOARD, EVERY DEVICE
OpenCollab also runs on macOS, Windows, Linux, iPhone and the command line, all sharing the same boards. It's open source: github.com/Chmarusso/p2p-collab-board

Because there is no server, a board is only reachable while at least one member who has it is online. Teams that want a board available around the clock can run an always-on peer, which stores it encrypted.
```

**App icon:** `icon-512.png` (512×512)

**Feature graphic:** `feature-graphic.png` (1024×500)

**Phone screenshots:** `screenshots/*.png`: board, card, comments, agenda, invite QR (1080×1920; Play rejects sides more than 2:1,
so the default 1080×2400 emulator screen is not accepted)

## Store settings

- **App category:** Productivity
- **Tags:** Task management, Team collaboration (pick the closest the console offers)
- **Contact email:** required and shown publicly; use an address you're happy to publish
- **Website:** `https://github.com/Chmarusso/p2p-collab-board`

## App content

**Privacy policy:** `https://github.com/Chmarusso/p2p-collab-board/blob/main/PRIVACY.md`

**Ads:** No, the app contains no ads.

**App access:** All functionality is available without special access. There is no
login; the reviewer creates an identity on first launch and can open the sample board.

**Target audience:** 13–15, 16–17 and 18 and over. Not directed at children under 13
(see PRIVACY.md); picking an under-13 group brings in the Families policy.

**Content rating** (IARC questionnaire), category _All other app types_:

| Question                                    | Answer |
| ------------------------------------------- | ------ |
| Violence, fear, sexuality, language, drugs  | No     |
| Gambling or simulated gambling              | No     |
| Users can interact or exchange content      | Yes    |
| Shares the user's current physical location | No     |
| Allows purchases of digital goods           | No     |
| Unrestricted internet access (web browser)  | No     |

Expected result: Everyone / PEGI 3 with the "Users Interact" notice.

**Data safety:**

| Question                                               | Answer |
| ------------------------------------------------------ | ------ |
| Does your app collect or share any required user data? | **No** |

Why "No" holds, per Google's definitions (collect = sent off the device to you or a third
party):

- Board content goes only to the board's members, end-to-end encrypted with the board's
  key. Google exempts data "unreadable by you or anyone other than the sender and
  recipient as a result of end-to-end encryption".
- Identity, recovery words, settings and blocked members stay on the device.
- Photos are read only when the user picks one to attach, a user-initiated action.
- The app has no analytics, crash reporting or ad SDKs.
- An optional blind peer is set up by the team itself and stores the board encrypted.

Peers and DHT nodes see the device's IP address when connecting, as with any direct
connection; OpenCollab doesn't receive it or derive location from it. If a reviewer asks
about it, point to the "What is shared" section of the privacy policy.

**Government, financial, health, news apps:** No to each.

## Before production

New personal developer accounts must run a closed test with at least 12 testers for 14
days before applying for production access. Upload the AAB from
`npm run release:android` to the closed testing track.
