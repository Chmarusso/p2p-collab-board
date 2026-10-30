// The notification sound. Players are created on first use and reused; the
// audio session mixes with other apps and respects the silent switch.
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio'
import { t } from './i18n'

export type SoundName = 'off' | 'chime' | 'pop' | 'ding'
// Labels are getters so they follow a language change.
export const SOUND_OPTIONS: { id: SoundName; readonly label: string }[] = [
  {
    id: 'off',
    get label() {
      return t('Off')
    }
  },
  {
    id: 'chime',
    get label() {
      return t('Chime')
    }
  },
  {
    id: 'pop',
    get label() {
      return t('Pop')
    }
  },
  {
    id: 'ding',
    get label() {
      return t('Ding')
    }
  }
]
export const DEFAULT_SOUND: SoundName = 'chime'
export const soundPrefKey = 'opencollab.notification-sound'
export const isSoundName = (value: unknown): value is SoundName =>
  SOUND_OPTIONS.some((option) => option.id === value)

const sources = {
  chime: require('../assets/sounds/chime.wav'),
  pop: require('../assets/sounds/pop.wav'),
  ding: require('../assets/sounds/ding.wav')
}
const players: Partial<Record<Exclude<SoundName, 'off'>, AudioPlayer>> = {}
let audioMode: Promise<void> | null = null

export function playSound(name: SoundName) {
  if (name === 'off') return
  audioMode ||= setAudioModeAsync({
    playsInSilentMode: false,
    interruptionMode: 'mixWithOthers'
  }).catch(() => {})
  void audioMode.then(() => {
    const player = (players[name] ||= createAudioPlayer(sources[name]))
    void player.seekTo(0).catch(() => {})
    player.play()
  })
}
