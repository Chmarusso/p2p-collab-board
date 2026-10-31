// SecureStore keys the app and the background board check (backgroundCheck.ts)
// both read.

// The recovery phrase is kept in the Keychain only if the user agreed to it;
// the choice is remembered. A phrase saved before the choice existed counts as
// 'saved'.
export const identityPhraseKey = 'opencollab.identity'
export const keychainChoiceKey = 'opencollab.identity-keychain'
// Logged in with saved recovery words: the next launch logs in by itself, until
// "Log out".
export const sessionKey = 'opencollab.session'
// Boards this identity joined, newest first: [{ invite, name, joinedAt }].
export const recentBoardsKey = (identity: string) => `opencollab.recent-boards.${identity}`
// Members whose activity this identity muted.
export const blockedKey = (identity: string) => `opencollab.blocked.${identity}`
