// The app's own words in the user's language: English is the source text, and
// each language maps English strings to its own. Board content (titles, cards,
// comments) is never translated. Pick: the phone's language, or Settings.
import { I18nManager, Platform, Settings } from 'react-native'
import pl from './pl'

export type Language = 'en' | 'pl'
export type LanguageChoice = 'system' | Language
export const LANGUAGE_CHOICES: LanguageChoice[] = ['system', 'en', 'pl']
export const languageKey = 'opencollab.language'

const dictionaries: Record<Language, Record<string, string>> = { en: {}, pl }

// The phone's preferred language, as iOS and Android report it to React Native;
// Intl is the fallback (Hermes may answer with its own default).
function deviceLocale() {
  try {
    const native =
      Platform.OS === 'ios'
        ? Settings.get('AppleLanguages')?.[0] || Settings.get('AppleLocale')
        : I18nManager.getConstants?.().localeIdentifier
    return String(native || Intl.DateTimeFormat().resolvedOptions().locale)
  } catch {
    return 'en'
  }
}

const deviceLanguage = (): Language => (deviceLocale().toLowerCase().startsWith('pl') ? 'pl' : 'en')

let current: Language = deviceLanguage()

export function setLanguage(choice: LanguageChoice) {
  current = choice === 'system' ? deviceLanguage() : choice
}

export const language = () => current

// For toLocaleDateString and friends: undefined keeps the phone's own format.
export const locale = () => (current === 'pl' ? 'pl-PL' : current === 'en' ? 'en-GB' : undefined)

// t('Added to {board}', { board }) — the English text is the key.
export function t(text: string, vars?: Record<string, string | number>) {
  const template = dictionaries[current][text] ?? text
  return vars
    ? template.replace(/\{(\w+)\}/g, (match, key: string) =>
        key in vars ? String(vars[key]) : match
      )
    : template
}

// The same English word that needs different words in Polish (a button vs a
// past-tense verb): tx('activity', 'archived') looks up 'activity|archived'.
export function tx(context: string, text: string, vars?: Record<string, string | number>) {
  const key = `${context}|${text}`
  return key in dictionaries[current] ? t(key, vars) : t(text, vars)
}

// Counted words: English one/other, Polish one/few/many (1 karta, 2 karty, 5 kart).
// plural(n, ['{n} card', '{n} cards'], ['{n} karta', '{n} karty', '{n} kart'])
export function plural(n: number, en: [string, string], pl: [string, string, string]) {
  let form: string
  if (current === 'pl') {
    const tens = n % 100
    const ones = n % 10
    form = n === 1 ? pl[0] : ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? pl[1] : pl[2]
  } else form = n === 1 ? en[0] : en[1]
  return form.replace(/\{n\}/g, String(n))
}
