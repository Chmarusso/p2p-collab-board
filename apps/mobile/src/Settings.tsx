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
import { LanguageChoice, t } from './i18n'

const MODE_OPTIONS: Array<{ id: ThemeMode; label: () => string }> = [
  { id: 'system', label: () => t('System') },
  { id: 'light', label: () => t('Light') },
  { id: 'dark', label: () => t('Dark') }
]

// Language names stay in their own language, so anyone can find theirs.
const LANGUAGE_OPTIONS: Array<{ id: LanguageChoice; label: () => string }> = [
  { id: 'system', label: () => t('System') },
  { id: 'en', label: () => 'English' },
  { id: 'pl', label: () => 'Polski' }
]

// SOUND_OPTIONS labels, listed so the translation check sees them.
const soundLabel = (label: string) =>
  ({ Off: t('Off'), Chime: t('Chime'), Pop: t('Pop'), Ding: t('Ding') })[label] ?? label

// 'saved': plain Keychain item; 'protected': needs Face ID / Touch ID to read
// (older versions; turned into 'saved' at the next login);
// 'off': the user chose not to keep it; null: never asked.
export type KeychainChoice = 'saved' | 'protected' | 'off' | null

// expo-secure-store writes to the Keychain on iOS and to Keystore-encrypted
// storage on Android; the words people see should name the right one.
// A function, so the words follow the current language.
export const keychainCopy = () =>
  Platform.select({
    ios: {
      offer: t('Save recovery words in the iOS Keychain?'),
      saved: t('Saved in the iOS Keychain on this device.'),
      protected: t(
        'Saved in the iOS Keychain on this device, unlocked with Face ID or Touch ID. If the enrolled faces or fingerprints change, you enter the words once more.'
      ),
      save: t('Save in Keychain'),
      forget: t('Forget from Keychain'),
      refused: t('The Keychain refused the phrase.')
    },
    default: {
      offer: t('Save recovery words on this device?'),
      saved: t('Saved in encrypted storage on this device.'),
      protected: t(
        'Saved in encrypted storage on this device, unlocked with your fingerprint or face. If the enrolled fingerprints or faces change, you enter the words once more.'
      ),
      save: t('Save on this device'),
      forget: t('Forget from this device'),
      refused: t('Secure storage refused the phrase.')
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
  languageChoice,
  onLanguage,
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
  languageChoice: LanguageChoice
  onLanguage: (choice: LanguageChoice) => void
  onClose: () => void
}) {
  const saved = keychain === 'saved' || keychain === 'protected'
  const copy = keychainCopy()
  return (
    <Sheet title={t('Settings')} onClose={onClose}>
      <Text style={styles.sectionLabel}>{t('Recovery words')}</Text>
      <Text style={styles.muted}>
        {keychain === 'protected'
          ? copy.protected
          : saved
            ? copy.saved
            : t('Not saved on this device. You enter them each time you open OpenCollab.')}
      </Text>
      {saved ? (
        <Button
          title={copy.forget}
          icon='trash-2'
          variant='secondary'
          onPress={() =>
            Alert.alert(
              t('Forget recovery words?'),
              t(
                'They are removed from this device. Make sure you have them written down: you will need them to open OpenCollab again.'
              ),
              [
                { text: t('Cancel'), style: 'cancel' },
                { text: t('Forget'), style: 'destructive', onPress: onForgetPhrase }
              ]
            )
          }
        />
      ) : canSave ? (
        <Button title={copy.save} icon='lock' variant='secondary' onPress={onSavePhrase} />
      ) : null}

      <Text style={styles.sectionLabel}>{t('Appearance')}</Text>
      <View style={styles.chips}>
        {MODE_OPTIONS.map((option) => (
          <Chip
            key={option.id}
            label={option.label()}
            selected={themeMode === option.id}
            onPress={() => onThemeMode(option.id)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t('Language')}</Text>
      <View style={styles.chips}>
        {LANGUAGE_OPTIONS.map((option) => (
          <Chip
            key={option.id}
            label={option.label()}
            selected={languageChoice === option.id}
            onPress={() => onLanguage(option.id)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t('Your theme')}</Text>
      <Text style={styles.muted}>
        {t('Changes how boards look on this device only. Others keep the board’s theme.')}
      </Text>
      <View style={styles.chips}>
        <Chip
          label={t('Board default')}
          selected={!themeOverride}
          onPress={() => onThemeOverride('')}
        />
        {THEME_TEMPLATES.map((template) => (
          <Chip
            key={template.id}
            label={template.name}
            selected={themeOverride === template.id}
            onPress={() => onThemeOverride(template.id)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t('Notification sound')}</Text>
      <Text style={styles.muted}>
        {t('Plays when new notifications arrive while the app is open.')}
      </Text>
      <View style={styles.chips}>
        {SOUND_OPTIONS.map((option) => (
          <Chip
            key={option.id}
            label={soundLabel(option.label)}
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
