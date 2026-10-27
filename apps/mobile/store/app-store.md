# App Store listing

Drafts for App Store Connect, in the order it asks for them. The Google Play pack is
[`play-listing.md`](play-listing.md); answers that match it are kept in step.

## Before the first upload

- Apple Developer Program membership, and the bundle ID `com.opencollab.mobile`
  registered under your team.
- Signing: open `ios/OpenCollab.xcworkspace`, pick your team under Signing &
  Capabilities, then Product → Archive and upload from the Organizer.
- Version: `app.json` `expo.version` becomes `CFBundleShortVersionString` and must stay
  higher than every published OTA (`package.json` `version`). Each upload also needs a
  new build number.
- `supportsTablet` is `true`, so the app also runs on iPad: App Review tests it there
  and the listing needs 13" iPad screenshots. Set it to `false` in `app.json` to ship
  iPhone only.

## App information

**Name** (30 max): `OpenCollab`

**Subtitle** (30 max): `Team boards, peer to peer`

**Category:** Productivity; secondary: Business

**Privacy policy URL:** `https://github.com/Chmarusso/p2p-collab-board/blob/main/PRIVACY.md`

**Support URL** (required): `https://github.com/Chmarusso/p2p-collab-board/issues`

**Marketing URL** (optional): `https://github.com/Chmarusso/p2p-collab-board`

**Copyright:** `2026 Artur Chmaro`

## Version page

**Promotional text** (170 max, can change without a new build):

```text
Kanban boards that sync straight between your team's devices. No servers, no accounts, end-to-end encrypted.
```

**Keywords** (100 max, comma-separated, no spaces needed; the name and subtitle are
already indexed):

```text
kanban,tasks,team,project,todo,planner,offline,private,encrypted,p2p,agile,sprint,checklist
```

**Description** (4000 max):

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
• Optionally keep the recovery words in the iOS Keychain, unlocked with Face ID

ONE BOARD, EVERY DEVICE
OpenCollab also runs on macOS, Windows, Linux, Android and the command line, all sharing the same boards. It's open source: github.com/Chmarusso/p2p-collab-board

Because there is no server, a board is only reachable while at least one member who has it is online. Teams that want a board available around the clock can run an always-on peer, which stores it encrypted.
```

**Screenshots:** PNG or JPEG, no transparency, up to 10 per size. If the UI is the same
across sizes, the largest is enough and App Store Connect scales it down.

| Device           | Size (portrait) | Simulator                |
| ---------------- | --------------- | ------------------------ |
| iPhone 6.9"      | 1320 × 2868     | iPhone 17 Pro Max        |
| iPad 13" (if on) | 2064 × 2752     | iPad Pro 13-inch (M4/M5) |

```sh
xcrun simctl io booted screenshot board.png                 # one per screen
sips -s format jpeg board.png --out board.jpg               # drops the alpha channel
```

Reuse the Play screens (board, card, agenda, stats), from a board with real-looking
content rather than the near-empty sample board.

## App Privacy

**Data collection:** _No, we do not collect data from this app._

Apple: "Collect" means "transmitting data off the device in a way that allows you and/or
your third-party partners to access it for a period longer than what is necessary to
service the transmitted request in real time", and "data that is processed only on
device is not collected". OpenCollab has no server. Board content goes only to the
board's members, end-to-end encrypted, and neither the developer nor any third party
can read it. The app has no analytics, crash reporting or ad SDKs.

Apple's page has no explicit carve-out for end-to-end encrypted data, and it asks apps
with in-app messaging to declare messages. That rule applies to data the developer can
access; here nobody but the members can. If App Review disagrees, the fallback is to
declare "Other user content" and "Photos or videos" as collected for App Functionality,
not linked to identity, not used for tracking.

**Tracking:** No. There is no `NSUserTrackingUsageDescription` and no tracking SDK.

## Age rating

| Question                          | Answer |
| --------------------------------- | ------ |
| Parental controls, age assurance  | No     |
| User-generated content            | Yes    |
| Messaging and chat                | Yes    |
| Advertising                       | No     |
| Social media (feed or discovery)  | No     |
| Unrestricted web access           | No     |
| Mature themes, medical, sexuality | None   |
| Violence, chance-based activities | None   |

Expected rating: **4+**. User-generated content and messaging alone don't raise it;
"social media" means a feed that spreads content to many users, and boards are private
and invite-only.

## Export compliance

OpenCollab encrypts with standard algorithms that it bundles itself (libsodium via the
Holepunch stack), not only Apple's. In App Store Connect:

1. Uses encryption: **Yes**.
2. Type: **Standard encryption algorithms instead of, or in addition to, using or
   accessing the encryption within Apple's operating system**.
3. France: distributing there needs a French encryption declaration (ANSSI) uploaded to
   App Store Connect. Without one, untick France under Pricing and Availability.
4. The U.S. mass-market rules (EAR §740.17(b)(1)) may require a year-end
   self-classification report to BIS and the NSA, due 1 February.

This is a summary, not legal advice. `ITSAppUsesNonExemptEncryption` is not set, so App
Store Connect asks these questions for each build; once the answers are settled, set it
in `app.json` `expo.ios.infoPlist`.

## App Review information

**Sign-in required:** No.

**Notes for the reviewer:**

```text
OpenCollab needs no account. On first launch, tap "Create new identity" (a key pair kept on the device), then "Try a sample board" to try every feature.

Sync is peer to peer with no server: boards are shared by invite link and sync only while another member's device is online. To see sync, open this invite link on the device while our always-on demo peer is running: [INVITE LINK]

The local network permission lets devices on the same Wi-Fi find each other for faster sync. The camera is used only to scan invitation QR codes (Join, then Scan QR code); nothing is recorded or sent.

User-generated content: boards are private and invite-only; content is visible only to people the owner invited. Owners and admins can remove a member, which revokes their access. Any member can block another member (hides their comments and notifications on that device) and report them (in the member's menu: opens a prefilled report at github.com/Chmarusso/p2p-collab-board/issues). We review reports within 24 hours.

Identity: there is no server account to delete. All data lives on the device; logging out and deleting the app removes it.

Updates: the app may download new JavaScript (Hermes bytecode) peer to peer, like CodePush; native code never changes outside App Store builds.
```

Replace `[INVITE LINK]` with a board run by an always-on peer
(`apps/blind-peer` or a desktop left open), or remove that paragraph. Promise only a
response time you can keep.

## Review risks

- **Guideline 1.2 asks for a "method for filtering objectionable material from being
  posted"**. There is no server to filter on. The answer is that boards are private
  spaces among invited people, with owner removal, block and report. Expect a question
  from App Review; private-group apps usually pass with that explanation.
- **Account deletion (5.1.1(v))** applies to apps that support account creation. The
  identity is a local key pair with no server side; the review note says so. If App
  Review asks, the in-app path is Log out, then delete the app.
- **OTA updates (2.5.2, 3.3.1(B))**: downloading interpreted code is allowed if it
  doesn't change the app's primary purpose. Keep OTA releases to fixes and features of
  the same app.
