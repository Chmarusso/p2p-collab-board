// Kanban state must come out the same on every peer whatever order the ops
// arrive in. Exercises the pure reducer shared by all clients; signatures are
// checked by the worker before ops get here, so plain messages are enough.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  deriveBoard,
  positionBetween,
  positionAt,
  isPosition,
  DEFAULT_COLUMNS
} = require('@opencollab/board-protocol')

let seed = 42
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
const pick = (list) => list[Math.floor(random() * list.length)]
const shuffle = (list) => {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const alice = 'a'.repeat(64)
const bob = 'b'.repeat(64)
const carol = 'c'.repeat(64)
const op = (identity, payload) => ({ identity, payload })
const card = (identity, id, ts, extra = {}) =>
  op(identity, {
    type: 'create',
    ts,
    object: {
      id,
      title: id,
      body: '',
      createdAt: new Date(1e12 + ts).toISOString(),
      votes: {},
      comments: [],
      ...extra
    }
  })

// Positions: always valid and strictly ordered, at both ends and in between.
{
  assert.equal(isPosition(positionBetween()), true)
  const list = []
  for (let i = 0; i < 2000; i++) {
    const index = i % 3 === 0 ? 0 : i % 3 === 1 ? list.length : Math.floor(random() * list.length)
    const position = positionAt(
      list.map((p) => ({ position: p })),
      index
    )
    assert.equal(isPosition(position), true, `invalid position ${position}`)
    list.splice(index, 0, position)
  }
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1] < list[i], 'positions out of order')
  assert.ok(Math.max(...list.map((p) => p.length)) <= 128, 'positions grew too long')
  // Concurrent inserts can produce equal neighbours; inserting still works.
  const tied = [{ position: 'V' }, { position: 'V' }, { position: 'k' }]
  const between = positionAt(tied, 1)
  assert.ok(between > 'V' && between < 'k')
  assert.throws(() => positionBetween('k', 'V'))
  console.log('✓ positions stay valid and ordered over 2000 inserts')
}

// Convergence: random concurrent ops from three members, many arrival orders.
{
  const people = [alice, bob, carol]
  const cards = ['c1', 'c2', 'c3', 'c4', 'c5']
  const columns = ['col:new', 'col:doing', 'col:done', 'col:x', 'col:y']
  const ops = cards.map((id, i) => card(pick(people), id, i + 1))
  for (let i = 0; i < 300; i++) {
    const identity = pick(people)
    const ts = Math.floor(random() * 50) + 10
    const kind = pick([
      'move',
      'update',
      'archive',
      'column',
      'delete',
      'label',
      'unlabel',
      'theme',
      'vote',
      'comment',
      'profile'
    ])
    const objectId = pick(cards)
    if (kind === 'move') {
      ops.push(
        op(identity, {
          type: 'card:move',
          ts,
          objectId,
          columnId: pick(columns),
          position: pick(['H', 'V', 'V', 'k', 'V5'])
        })
      )
    } else if (kind === 'update') {
      ops.push(
        op(identity, {
          type: 'card:update',
          ts,
          objectId,
          title: `t${i}`,
          dueDate: pick([null, '2026-11-01']),
          labelIds: [pick(['l1', 'l2'])]
        })
      )
    } else if (kind === 'archive') {
      ops.push(op(identity, { type: 'card:archive', ts, objectId, archived: random() > 0.5 }))
    } else if (kind === 'column') {
      ops.push(
        op(identity, {
          type: 'column:upsert',
          ts,
          columnId: pick(columns),
          name: `n${i}`,
          color: '#336699'
        })
      )
    } else if (kind === 'delete') {
      ops.push(op(identity, { type: 'column:delete', ts, columnId: pick(columns) }))
    } else if (kind === 'label') {
      ops.push(
        op(identity, {
          type: 'label:upsert',
          ts,
          labelId: pick(['l1', 'l2']),
          name: `L${i}`,
          color: '#aa0000'
        })
      )
    } else if (kind === 'unlabel') {
      ops.push(op(identity, { type: 'label:delete', ts, labelId: pick(['l1', 'l2']) }))
    } else if (kind === 'theme') {
      ops.push(
        op(identity, { type: 'board:theme', ts, background: pick(['#112233', 'preset:dusk']) })
      )
    } else if (kind === 'vote') {
      ops.push(op(identity, { type: 'vote', ts, objectId, value: pick([1, -1, 0]) }))
    } else if (kind === 'comment') {
      const comment = { id: `m${i}`, text: `hi ${i}`, createdAt: new Date(1e12 + ts).toISOString() }
      ops.push(op(identity, { type: 'comment', ts, objectId, text: comment.text, comment }))
    } else {
      ops.push(op(identity, { type: 'profile', ts, displayName: `name${i}` }))
    }
  }

  const expected = JSON.stringify(deriveBoard(ops))
  for (let run = 0; run < 50; run++) {
    assert.equal(JSON.stringify(deriveBoard(shuffle(ops))), expected, `order ${run} diverged`)
  }
  console.log(`✓ ${ops.length} concurrent ops converge across 50 arrival orders`)
}

// Last writer wins, ties broken by identity; ops before their card still apply.
{
  const state = deriveBoard([
    op(bob, { type: 'card:move', ts: 20, objectId: 'c1', columnId: 'col:done', position: 'V' }),
    op(alice, { type: 'card:move', ts: 30, objectId: 'c1', columnId: 'col:doing', position: 'V' }),
    op(carol, { type: 'card:update', ts: 30, objectId: 'c1', title: 'carol' }),
    op(alice, { type: 'card:update', ts: 30, objectId: 'c1', title: 'alice' }),
    card(alice, 'c1', 1)
  ])
  assert.equal(state.objects[0].columnId, 'col:doing')
  assert.equal(state.objects[0].title, 'carol')
  console.log('✓ newest edit wins, equal stamps resolve the same way everywhere')
}

// Defaults, back-compat and deletes.
{
  const legacyA = card(alice, 'old-a', 5)
  const legacyB = card(bob, 'old-b', 2)
  delete legacyA.payload.ts
  delete legacyB.payload.ts
  let state = deriveBoard([legacyA, legacyB])
  assert.deepEqual(
    state.columns.map((column) => column.name),
    DEFAULT_COLUMNS.map((column) => column.name)
  )
  assert.deepEqual(
    state.objects.map((object) => [object.id, object.columnId]),
    [
      ['old-b', 'col:new'],
      ['old-a', 'col:new']
    ],
    'posts from before Kanban sit in New, oldest first'
  )

  // Legacy votes keep their log-order meaning: the voter's last vote counts.
  const vote = (value) => op(bob, { type: 'vote', objectId: 'old-a', value })
  state = deriveBoard([legacyA, vote(1), vote(-1), vote(0), vote(1)])
  assert.deepEqual(state.objects[0].votes, { [bob]: 1 })

  state = deriveBoard([
    card(alice, 'c1', 1, { columnId: 'col:done', labelIds: ['l1'] }),
    op(alice, { type: 'label:upsert', ts: 2, labelId: 'l1', name: 'bug', color: '#ff0000' }),
    op(bob, { type: 'label:delete', ts: 3, labelId: 'l1' }),
    op(bob, { type: 'column:delete', ts: 3, columnId: 'col:done' })
  ])
  assert.equal(state.objects[0].columnId, 'col:new', 'card of a deleted column moves to the first')
  assert.deepEqual(state.objects[0].labelIds, [], 'deleted labels drop off cards')

  state = deriveBoard(
    DEFAULT_COLUMNS.map((column, i) =>
      op(pick([alice, bob]), { type: 'column:delete', ts: i + 1, columnId: column.id })
    )
  )
  assert.deepEqual(
    state.columns.map((column) => column.id),
    ['col:new'],
    'a board never ends up with no columns'
  )

  state = deriveBoard([
    card(alice, 'c1', 1),
    op(bob, { type: 'card:update', ts: 2, objectId: 'c1', title: '  ', dueDate: 'soon' }),
    op(bob, { type: 'card:move', ts: 2, objectId: 'c1', columnId: 'col:done', position: 'x0' }),
    op(bob, { type: 'board:theme', ts: 2, background: 'url(evil)', accent: 'red' }),
    op(bob, { type: 'column:upsert', ts: 2, columnId: 'col:new', color: 'javascript:' })
  ])
  assert.equal(state.objects[0].title, 'c1', 'blank titles are ignored')
  assert.equal(state.objects[0].dueDate, null, 'unparseable due dates are ignored')
  assert.equal(state.objects[0].columnId, 'col:new', 'invalid positions are ignored')
  assert.deepEqual(state.theme, { background: null, accent: null }, 'theme accepts colors only')
  assert.equal(state.columns[0].color, null)
  console.log('✓ defaults, legacy posts, deletes and invalid values behave')
}
