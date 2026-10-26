// Theme templates: every palette passes WCAG AA, and the renderer's ESM copy
// matches packages/board-protocol/themes.js.
//
//   node scripts/test-themes.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// renderer/*.js are browser ES modules in a CommonJS package: load the source as one.
const rendererSource = fs.readFileSync(new URL('../renderer/themes.js', import.meta.url), 'utf8')
const rendererThemes = await import(
  `data:text/javascript;base64,${Buffer.from(rendererSource).toString('base64')}`
)
const {
  THEME_TEMPLATES,
  THEME_MODES,
  DEFAULT_TEMPLATE,
  themeTemplate
} = require('../packages/board-protocol/themes.js')

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground, background, minimum ratio]
const PAIRS = [
  ['text', 'bg', 7],
  ['text', 'surface', 7],
  ['text', 'surfaceRaised', 7],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['accent', 'surface', 4.5],
  ['accentInk', 'accent', 4.5],
  ['info', 'surface', 4.5],
  ['error', 'surface', 4.5],
  ['danger', 'surface', 4.5],
  ['warn', 'surface', 4.5],
  ['success', 'surface', 4.5]
]
const KEYS = Object.keys(THEME_TEMPLATES[0].dark).sort()

let failures = 0
for (const template of THEME_TEMPLATES) {
  for (const mode of ['dark', 'light']) {
    const colors = template[mode]
    assert.deepEqual(Object.keys(colors).sort(), KEYS, `${template.id} ${mode} keys`)
    for (const value of Object.values(colors)) assert.match(value, /^#[0-9a-f]{6}$/)
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(colors[fg], colors[bg])
      if (ratio < min) {
        failures++
        console.error(`✗ ${template.id} ${mode}: ${fg} on ${bg} ${ratio.toFixed(2)} < ${min}`)
      }
    }
  }
}
assert.equal(failures, 0, `${failures} contrast failures`)
console.log(`✓ ${THEME_TEMPLATES.length} templates × 2 modes pass AA contrast`)

assert.deepEqual(
  JSON.parse(JSON.stringify(rendererThemes.THEME_TEMPLATES)),
  JSON.parse(JSON.stringify(THEME_TEMPLATES))
)
assert.deepEqual(rendererThemes.THEME_MODES, [...THEME_MODES])
assert.equal(rendererThemes.DEFAULT_TEMPLATE, DEFAULT_TEMPLATE)
console.log('✓ renderer/themes.js matches the protocol copy')

assert.equal(themeTemplate('nope').id, DEFAULT_TEMPLATE)
assert.equal(themeTemplate(null).id, DEFAULT_TEMPLATE)
assert.equal(themeTemplate('ocean').id, 'ocean')
console.log('✓ unknown template ids fall back to the default')
