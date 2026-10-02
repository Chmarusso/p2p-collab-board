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
