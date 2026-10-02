# OpenCollab Mobile

This Expo/React Native client uses the same OpenCollab Bare worker as the Electron app. It shares board invites, encrypted board state, profiles, votes, and comments.

```sh
npm install
npm run --workspace @opencollab/mobile bundle:bare
npm run --workspace @opencollab/mobile ios
# or: npm run --workspace @opencollab/mobile android
```

The Pear Mobile runtime requires a native development build; Expo Go is not sufficient. Re-run `bundle:bare` after changing `workers/main.js`.

## Clipboard integration test

With Electron running using `--remote-debugging-port 9222` and an iOS Simulator booted, run:

```sh
npm run test:clipboard
```

The test verifies Electron ↔ macOS clipboard transfer and the simulator pasteboard roundtrip. In the mobile app, use **Paste invitation** on the board join screen to read the simulator pasteboard directly; simulator and macOS pasteboards are separate when controlled with `simctl`.

## P2P OTA updates (iOS)

Release builds update their JavaScript and the embedded Bare worker from the `upgrade`
link in `package.json`, without a new binary. The worker downloads a newer version,
applies it into `Application Support/pear-runtime/ota`, and the app shows "Update
installed"; the next launch boots it (boot control from `pear-runtime-react-native`).
Debug builds always load from Metro, so test OTA with Release builds.

```sh
npm pkg set version=1.0.4 --workspace @opencollab/mobile  # higher than binary + every OTA
npm run --workspace @opencollab/mobile ota                 # → ../opencollab-deploy/mobile-1.0.4
pear stage <upgrade link> ../opencollab-deploy/mobile-1.0.4
pear seed <upgrade link>                                    # keep running somewhere reachable
```

- Only JS/worker changes can ship this way. New native modules, permissions, Pods or
  React Native/Expo upgrades need a new binary; raise `pear.json` `updates.minver` so
  older binaries skip updates they cannot run.
- `package.json` `version` is the OTA version. A new binary must carry a version higher
  than every published OTA (`app.json` `version` → `CFBundleShortVersionString`).
- Updates are checked at launch, immediately during the first 60 s, later after a random
  delay of up to an hour.
