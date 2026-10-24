# Plan: releasing OpenCollab on Linux, macOS, Windows, Android and iOS

Status: **draft**. Nothing here has been run.

## Where we start

- **Updates already work over P2P** for the desktop app, the CLI and the iOS app
  (JavaScript and worker only on iOS). Each build follows the `pear://` link in its
  `package.json#upgrade`. Apps installed from a store still need the store for
  their first install, and on mobile for any native change.
- **The CI job `build-release.yml` builds and signs desktop packages** (macOS arm64 +
  x64 DMG, Windows MSIX, Linux AppImage / Flatpak / Snap) from a manual run. The
  signing secrets live in the GitHub `release` environment. `pear build`, staging
  and seeding are manual (`docs/development.md` → Peer-to-Peer Deployments).
- **The template's placeholders are still in place, so there is no production
  release line yet:**
  - `pear.json`: `multisig.publicKeys` are `<PUBKEY_HERE>` and the namespace is
    `holepunchto/hello-pear-electron`. This decides the production key, and any
    change gives a new key.
  - `build/AppxManifest.xml`: `Identity Name="HelloPear"`, `Publisher="CN=My Publisher"`.
  - `flatpak/com.pears.HelloPear.yml` and its metainfo use the `HelloPear` id.
- **There is no Android project yet.** `bare-pack` already builds the worker for
  `android-arm64`, and `pear-runtime-react-native` supports Android through Expo
  prebuild.
- **The fork is 4 commits behind upstream** `holepunchto/hello-pear-electron`:
  packaging icon fixes (#94), inline worker + `bare-sidecar` bump (#96), the Mac App
  Store variant (#95), and Flathub update notes (#93).

## Decisions needed first

1. **Who holds the release keys.** Multisig needs three key holders with quorum 2,
   **and three machines**: `pear multisig` refuses to commit unless two other machines
   are seeding (`agent_docs/releases.md`). Who are the three?
2. **Where the always-on seeders run.** At least 2 hosts with a public address or
   cone NAT, running `pear seed` for every link plus `opencollab watch` as a board
   relay. A firewalled seeder silently serves nothing.
3. **Accounts and certificates:**
   - Apple Developer Program ($99/yr): Developer ID for the DMG, plus App Store
     Connect for iOS.
   - Google Play Console ($25 once).
   - Windows code signing: an OV/EV certificate, or Azure Trusted Signing. Its
     subject CN must equal `AppxManifest` `Publisher` and stay the same forever,
     or Windows refuses OTA updates.
   - Snapcraft and Flathub accounts for Linux store listings.
4. **App ids**, fixed once: desktop `com.opencollab.desktop`, mobile
   `com.opencollab.mobile` (already in `app.json`), Flatpak `com.opencollab.OpenCollab`.
5. **Store vs direct download per platform** (recommendation in each section below).

## Phase 0 — Clean up and catch up (1–2 days)

- Merge upstream `origin/main` into the fork (icons, Mac App Store variant, sidecar
  bump), then rerun `npm run test:kanban`, `test:board-spaces` and a packaged
  check outside the repo.
- Rebrand the leftovers **(ask-first files, per AGENTS.md)**: `AppxManifest.xml`
  Identity and Publisher, the Flatpak id and metainfo, the Snap name. Keep
  `productName` free of spaces and punctuation, because the CI Linux jobs look up
  artifacts by it.
- Add the test suites to CI: `integrate.yml` runs lint only today. Add
  `test:kanban` and `test:board-spaces`, plus `tsc` for `apps/mobile`.
- Decide what to do with the room channel (`chatSwarm`, which never joins a topic),
  and the 1,000-card performance note from the Kanban plan. Neither blocks a
  release.

## Phase 1 — Production release line (2–3 days, needs the three key holders)

Following `docs/development.md` → Peer-to-Peer Deployments:

1. Each key holder runs `pear multisig keys get`. Put the three public keys and an
   `opencollab/…` namespace into `pear.json`. **This is the production key: do it
   once.**
2. Create the links: production desktop, CLI and mobile OTA. Point
   `package.json#upgrade` (desktop), `apps/cli/package.json#upgrade` and
   `apps/mobile/package.json#upgrade` at their production links. Today's links
   become staging.
3. Run the pipeline per release: `pear build` → `pear stage` (staging link) → test
   → `pear provision` → `pear multisig request/verify/commit` with 2 of 3 keys,
   while two other machines seed.
4. Start the seeders and the board relay on the always-on hosts, and check
   `pear seed --json` shows `firewalled: false` and uploads above 0.
5. Version policy: one version for desktop + CLI + mobile JS, bumped with
   `npm version`. **Pushing a `v*` tag publishes to npm (`publish.yml`)**, so only
   tag real releases. Rollback means staging a higher version; there's no downgrade.

## Phase 2 — Desktop (macOS, Windows, Linux) (2–4 days)

| Platform        | Build (exists in CI)                              | Distribution (recommended)                                       | To do                                                                                                                                              |
| --------------- | ------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS           | DMG, arm64 + x64, Developer ID signed + notarized | **Direct download** (website / GitHub Releases) + `pear://` link | Add `CERTIFICATE_P12`, `MAC_CODESIGN_IDENTITY`, `APPLE_*` secrets; test the notarized DMG on a clean Mac                                           |
| macOS App Store | Upstream variant (#95)                            | Later, optional                                                  | App Review and sandboxing of P2P sockets + OTA are a risk; ship Developer ID first                                                                 |
| Windows         | MSIX, signed                                      | **Direct MSIX / App Installer** + `pear://` link                 | Certificate whose CN matches `Publisher`; test install, OTA update and uninstall on Windows 10 and 11                                              |
| Microsoft Store | Same MSIX                                         | Later, optional                                                  | The Store re-signs, so `Publisher` must match Partner Center                                                                                       |
| Linux           | AppImage, Flatpak, Snap                           | **AppImage + Flathub + Snap Store**                              | Flathub submission (manifest URLs/sha512 per release, version in 3 places), Snapcraft name registration; deb/rpm makers exist but are unconfigured |

Each desktop release: run `build-release.yml` → attach the artifacts to a GitHub
release → stage/provision the same version on the pear link, so the downloaded
build and its OTA line match.

## Phase 3 — iOS (1–2 weeks including review)

- **Build:** Release builds through Xcode or EAS Build on a macOS runner, with
  `app.json` `version` / `CFBundleShortVersionString` above every published OTA
  (`apps/mobile/README.md`).
- **TestFlight first:** internal testers on real phones. Test:
  - sync with desktop and CLI
  - the local-network permission prompt
  - the photo picker
  - backgrounding (iOS suspends sockets; sync resumes in the foreground)
  - an OTA update from the pear link
- **App Review risks to prepare for:**
  - Guideline 2.5.2 / 3.3.1 on downloading code: the P2P OTA updates JavaScript run
    by Bare. Describe it as content and bug-fix updates within the app's stated
    purpose, and keep native changes going through review.
  - The local network usage string is already set. Encryption export compliance:
    the app uses standard crypto. Answer the questionnaire; it likely qualifies
    for the exemption. Check `ITSAppUsesNonExemptEncryption`.
  - A privacy policy page and a demo board / invite link for the reviewer.
- **After release:** JS/worker changes ship over Pear. Native changes ship through
  the App Store, after raising `apps/mobile/pear.json` `updates.minver`.

## Phase 4 — Android (1–2 weeks including review)

- `npx expo prebuild --platform android` to generate `android/`. Raise
  `minSdkVersion` as `pear-runtime-react-native` requires, and check the plugin's
  `jsBundleFilePath` patch won (there must be exactly one bundle owner).
- Check that the worker bundle includes `android-arm64` (it does) and decide on
  `x86_64` for emulators.
- Test on real devices: the image picker, LAN discovery, backgrounding (Android
  may kill the process; consider a foreground service only if users need
  background sync), and OTA. Android applies an OTA only after a full process
  restart.
- Signing: an upload keystore plus Play App Signing. Ship an AAB to the **Internal
  testing** track, then closed testing (new personal accounts need 12+ testers for
  14 days), then production.
- Play policy: same JS OTA question as iOS (the Device and Network Abuse policy
  allows interpreted JS updates). Data safety form: no data collected by us; it
  stays on devices.

## Phase 5 — CLI

Already documented in `apps/cli/README.md`: `node apps/cli/scripts/dist.js`,
`pear build`, then stage on the CLI link. Add it to the same release run so the
CLI and the apps share a version.

## Release checklist (each version)

1. `npm run lint`, `npm run test:kanban`, `npm run test:board-spaces`, mobile `tsc`.
2. Packaged desktop check from a copy **outside the repo** (`agent_docs/packaging.md`).
3. Cross-client sync: desktop ↔ iOS ↔ Android ↔ CLI on one board, with a relay
   running.
4. Upgrade test: open a board created by the previous version, including a legacy
   (pre-namespace) board.
5. Stage → test the staging link → provision → multisig commit; seeders show
   uploads.
6. Store builds (TestFlight / Play internal) for native changes; raise mobile
   `minver` when needed.
7. Release notes, plus "update all devices" whenever the board protocol gains ops.

## Suggested order

1. Phase 0 + 1 → an **internal release**: desktop + CLI over pear links on the
   team's machines.
2. Phase 2 → **public desktop**: signed DMG / MSIX / AppImage, then Flathub and Snap.
3. Phase 3 + 4 in parallel → **TestFlight + Play internal**, then store production.
