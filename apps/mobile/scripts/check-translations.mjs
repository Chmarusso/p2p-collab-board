// Lists every t('…') and plural(…) English string in src/ that has no Polish
// entry. Exit code 1 when something is missing.
//
//   node apps/mobile/scripts/check-translations.mjs
import fs from 'node:fs'
import path from 'node:path'

const src = path.join(import.meta.dirname, '..', 'src')
const files = fs
  .readdirSync(src, { recursive: true })
  .filter((file) => /\.(tsx?)$/.test(file) && !file.startsWith('i18n'))
  .map((file) => path.join(src, file))

// The Polish dictionary files are plain object literals: read their keys.
const dictionary = new Set()
for (const file of fs.readdirSync(path.join(src, 'i18n', 'pl'))) {
  const text = fs.readFileSync(path.join(src, 'i18n', 'pl', file), 'utf8')
  // Quoted keys, and one-word keys prettier leaves unquoted (Cancel: …).
  for (const match of text.matchAll(
    /^\s*(?:(['"`])((?:\\.|(?!\1).)*)\1|([A-Za-z_$][\w$]*))\s*:/gm
  )) {
    dictionary.add(match[3] ?? match[2].replace(/\\(['"`\\])/g, '$1'))
  }
}

const missing = new Map()
let used = 0
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
    used++
    const key = match[2].replace(/\\(['"`\\])/g, '$1')
    if (!dictionary.has(key)) missing.set(key, path.relative(src, file))
  }
  // tx('context', 'text'): a context entry, or the plain text, will do.
  for (const match of text.matchAll(/\btx\(\s*'([^']+)',\s*(['"`])((?:\\.|(?!\2).)*)\2/g)) {
    used++
    const key = match[3].replace(/\\(['"`\\])/g, '$1')
    if (!dictionary.has(`${match[1]}|${key}`) && !dictionary.has(key)) {
      missing.set(`${match[1]}|${key}`, path.relative(src, file))
    }
  }
}
for (const [key, file] of missing) console.log(`missing  ${file}: ${key}`)
console.log(`${used} t() calls · ${dictionary.size} Polish entries · ${missing.size} missing`)
process.exit(missing.size ? 1 : 0)
