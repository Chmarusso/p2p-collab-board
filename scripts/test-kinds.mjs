// Board types: the renderer's ESM copy matches packages/board-protocol/kinds.js,
// and the reducer only takes a type from the board's owner.
//
//   node scripts/test-kinds.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// renderer/*.js are browser ES modules in a CommonJS package: load the source as one.
const rendererSource = fs.readFileSync(new URL('../renderer/kinds.js', import.meta.url), 'utf8')
const renderer = await import(
  `data:text/javascript;base64,${Buffer.from(rendererSource).toString('base64')}`
)
const protocol = require('../packages/board-protocol/kinds.js')
const { deriveBoard } = require('../packages/board-protocol')

for (const name of Object.keys(protocol)) {
  const ours = protocol[name]
  const theirs = renderer[name]
  if (typeof ours === 'function') {
    for (const input of [...protocol.BOARD_KIND_IDS, 'nope', undefined, null]) {
      assert.deepEqual(theirs(input, 'due'), ours(input, 'due'), `${name}(${input})`)
    }
  } else assert.deepEqual(theirs, ours, name)
}
console.log('✓ renderer/kinds.js matches the protocol copy')

const owner = 'a'.repeat(64)
const other = 'b'.repeat(64)
const op = (identity, payload, ts) => ({
  identity,
  id: `${identity}${ts}`,
  payload: { ...payload, ts }
})
const kindOf = (ops) => deriveBoard(ops, { owner }).info.kind
assert.equal(kindOf([]), 'kanban')
assert.equal(kindOf([op(owner, { type: 'board:info', kind: 'recipes' }, 1)]), 'recipes')
assert.equal(
  kindOf([
    op(owner, { type: 'board:info', kind: 'recipes' }, 1),
    op(other, { type: 'board:info', kind: 'feed' }, 2)
  ]),
  'recipes'
)
assert.equal(kindOf([op(owner, { type: 'board:info', kind: 'spreadsheet' }, 1)]), 'kanban')
assert.equal(
  kindOf([
    op(owner, { type: 'board:info', kind: 'feed' }, 1),
    op(owner, { type: 'board:info', description: 'hi' }, 2)
  ]),
  'feed'
)
console.log('✓ only the owner sets the board type; unknown types read as Kanban')

// Cover text is large and bold: keep it readable on both ends of the gradient.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
for (const cover of protocol.FEED_COVERS) {
  for (const end of [cover.from, cover.to]) {
    assert.ok(contrast(end, cover.ink) >= 4, `${cover.ink} on ${end}`)
  }
}
assert.deepEqual(protocol.feedCover('card-1'), protocol.feedCover('card-1'))
console.log('✓ feed covers are readable and stable per card')
