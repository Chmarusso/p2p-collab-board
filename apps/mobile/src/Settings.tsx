// App settings that belong to this device, not to a board: where the recovery
// words are kept, the notification sound and the appearance.
import React from 'react'
import { Alert, Platform, Text, View } from 'react-native'
import { Button, colors, mono, themed } from './ui'
import { Sheet } from './board/Panels'
import { Chip } from './board/CardSheet'
import { SOUND_OPTIONS, SoundName } from './sounds'
import { THEME_TEMPLATES } from '@opencollab/board-protocol'
import type { ThemeMode } from '@opencollab/board-protocol'

const MODE_OPTIONS: Array<{ id: ThemeMode; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
]

// 'saved': plain Keychain item; 'protected': needs Face ID / Touch ID to read;
// 'off': the user chose not to keep it; null: never asked.
export type KeychainChoice = 'saved' | 'protected' | 'off' | null

// expo-secure-store writes to the Keychain on iOS and to Keystore-encrypted
// storage on Android; the words people see should name the right one.
export const keychainCopy = Platform.select({
  ios: {
    offer: 'Save recovery words in the iOS Keychain?',
    saved: 'Saved in the iOS Keychain on this device.',
    protected:
      'Saved in the iOS Keychain on this device, unlocked with Face ID or Touch ID. If the enrolled faces or fingerprints change, you enter the words once more.',
    save: 'Save in Keychain',
    forget: 'Forget from Keychain',
    refused: 'The Keychain refused the phrase.'
  },
  default: {
    offer: 'Save recovery words on this device?',
    saved: 'Saved in encrypted storage on this device.',
    protected:
      'Saved in encrypted storage on this device, unlocked with your fingerprint or face. If the enrolled fingerprints or faces change, you enter the words once more.',
    save: 'Save on this device',
    forget: 'Forget from this device',
    refused: 'Secure storage refused the phrase.'
  }
})

export function SettingsSheet({
  keychain,
  canSave,
  onSavePhrase,
  onForgetPhrase,
  sound,
  onSound,
  themeMode,
  onThemeMode,
  themeOverride,
  onThemeOverride,
  onClose
}: {
  keychain: KeychainChoice
  canSave: boolean
  onSavePhrase: () => void
  onForgetPhrase: () => void
  sound: SoundName
  onSound: (sound: SoundName) => void
  themeMode: ThemeMode
  onThemeMode: (mode: ThemeMode) => void
  themeOverride: string
  onThemeOverride: (template: string) => void
  onClose: () => void
}) {
  const saved = keychain === 'saved' || keychain === 'protected'
  return (
    <Sheet title='Settings' onClose={onClose}>
      <Text style={styles.sectionLabel}>Recovery words</Text>
      <Text style={styles.muted}>
        {keychain === 'protected'
          ? keychainCopy.protected
          : saved
            ? keychainCopy.saved
            : 'Not saved on this device. You enter them each time you open OpenCollab.'}
      </Text>
      {saved ? (
        <Button
          title={keychainCopy.forget}
          icon='trash-2'
          variant='secondary'
          onPress={() =>
            Alert.alert(
              'Forget recovery words?',
              'They are removed from this device. Make sure you have them written down: you will need them to open OpenCollab again.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Forget', style: 'destructive', onPress: onForgetPhrase }
              ]
            )
          }
        />
      ) : canSave ? (
        <Button title={keychainCopy.save} icon='lock' variant='secondary' onPress={onSavePhrase} />
      ) : null}

      <Text style={styles.sectionLabel}>Appearance</Text>
      <View style={styles.chips}>
        {MODE_OPTIONS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={themeMode === option.id}
            onPress={() => onThemeMode(option.id)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>Your theme</Text>
      <Text style={styles.muted}>
        Changes how boards look on this device only. Others keep the board’s theme.
      </Text>
      <View style={styles.chips}>
        <Chip label='Board default' selected={!themeOverride} onPress={() => onThemeOverride('')} />
        {THEME_TEMPLATES.map((template) => (
          <Chip
            key={template.id}
            label={template.name}
            selected={themeOverride === template.id}
            onPress={() => onThemeOverride(template.id)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>Notification sound</Text>
      <Text style={styles.muted}>Plays when new notifications arrive while the app is open.</Text>
      <View style={styles.chips}>
        {SOUND_OPTIONS.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={sound === option.id}
            onPress={() => onSound(option.id)}
          />
        ))}
      </View>
    </Sheet>
  )
}

const styles = themed(() => ({
  muted: { color: colors.muted, lineHeight: 20 },
  sectionLabel: {
    color: colors.muted,
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 6
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
}))
