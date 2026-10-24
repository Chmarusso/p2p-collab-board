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
      'info',
      'image',
      'vote',
      'comment',
      'profile',
      'checklist',
      'reaction',
      'link',
      'estimate',
      'assign',
      'rule',
      'wip'
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
    } else if (kind === 'checklist') {
      ops.push(
        op(identity, {
          type: 'card:checklist',
          ts,
          objectId,
          itemId: pick(['i1', 'i2', 'i3']),
          ...pick([{ text: `item ${i}` }, { done: random() > 0.5 }, { deleted: true }]),
          ...(random() > 0.5 && { position: pick(['H', 'V', 'k']) })
        })
      )
    } else if (kind === 'reaction') {
      ops.push(
        op(identity, {
          type: 'reaction',
          ts,
          objectId,
          emoji: pick(['👍', '🎉', '🔥']),
          on: random() > 0.4
        })
      )
    } else if (kind === 'link') {
      ops.push(
        op(identity, {
          type: 'card:link',
          ts,
          objectId,
          targetId: pick(cards),
          kind: pick(['blocks', 'relates']),
          linked: random() > 0.3
        })
      )
    } else if (kind === 'estimate') {
      ops.push(op(identity, { type: 'estimate', ts, objectId, value: pick([1, 2, 3, 5, 8, null]) }))
    } else if (kind === 'assign') {
      ops.push(
        op(identity, {
          type: 'card:update',
          ts,
          objectId,
          assignees: shuffle(people).slice(0, Math.floor(random() * 3)),
          points: pick([null, 3, 5]),
          revealEstimates: random() > 0.5
        })
      )
    } else if (kind === 'rule') {
      ops.push(
        op(identity, {
          type: pick(['rule:upsert', 'rule:upsert', 'rule:delete']),
          ts,
          ruleId: pick(['r1', 'r2']),
          rule: {
            name: `rule ${i}`,
            trigger: { kind: 'enter', columnId: pick(columns) },
            actions: { archive: random() > 0.5, dueInDays: 2 }
          }
        })
      )
    } else if (kind === 'wip') {
      ops.push(
        op(identity, {
          type: 'column:upsert',
          ts,
          columnId: pick(columns),
          wipLimit: pick([null, 2, 5])
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
    } else if (kind === 'info') {
      ops.push(op(identity, { type: 'board:info', ts, description: `About ${i}` }))
    } else if (kind === 'image') {
      const ref = {
        core: identity,
        id: { blockOffset: i, blockLength: 1, byteOffset: 0, byteLength: 9 },
        type: 'image/png'
      }
      ops.push(op(identity, { type: 'card:image', ts, objectId, images: [ref] }))
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

// Concurrent image uploads all survive (add-only set), in a stable order.
{
  const ref = (n) => ({
    core: 'c'.repeat(64),
    id: { blockOffset: n, blockLength: 1 },
    type: 'image/png'
  })
  const ops = [
    card(alice, 'c1', 1),
    op(alice, { type: 'card:image', ts: 5, objectId: 'c1', images: [ref(1), ref(2)] }),
    op(bob, { type: 'card:image', ts: 5, objectId: 'c1', images: [ref(3)] }),
    op(carol, { type: 'card:image', ts: 4, objectId: 'c1', images: [ref(1)] }),
    op(bob, { type: 'board:info', ts: 3, description: 'old' }),
    op(alice, { type: 'board:info', ts: 6, description: 'Launch board for Q4' })
  ]
  const expected = JSON.stringify(deriveBoard(ops))
  for (let run = 0; run < 20; run++) {
    assert.equal(JSON.stringify(deriveBoard(shuffle(ops))), expected)
  }
  const state = deriveBoard(ops)
  assert.deepEqual(
    state.objects[0].images.map((image) => image.id.blockOffset),
    [1, 2, 3],
    'all three uploads kept, duplicates merged'
  )
  assert.equal(state.info.description, 'Launch board for Q4')
  console.log('✓ concurrent image uploads all survive; board description is last-writer-wins')
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
  assert.deepEqual(
    state.theme,
    { background: null, accent: null, backgroundImage: null },
    'theme accepts colors only'
  )
  assert.equal(state.columns[0].color, null)
  console.log('✓ defaults, legacy posts, deletes and invalid values behave')
}

// Moderation: roles from the owner only, bans from the owner and admins, and a
// banned member's ops dropped except the ones the ban keeps.
{
  const dave = 'd'.repeat(64)
  const signed = (identity, id, payload) => ({ id, identity, payload })
  const ops = [
    signed(alice, 'a1', { type: 'board:claim', ts: 1 }),
    signed(carol, 'c1', card(carol, 'carol-old', 2).payload),
    signed(alice, 'a2', { type: 'member:role', identity: bob, role: 'admin', ts: 3 }),
    signed(carol, 'c2', { type: 'member:role', identity: carol, role: 'admin', ts: 4 }),
    signed(bob, 'b1', { type: 'member:ban', identity: carol, banned: true, keep: ['c1'], ts: 5 }),
    // Backdated, but not in the ban's keep list.
    signed(carol, 'c3', card(carol, 'carol-backdated', 1).payload),
    signed(carol, 'c4', card(carol, 'carol-new', 6).payload),
    signed(bob, 'b2', { type: 'member:ban', identity: alice, banned: true, keep: [], ts: 7 }),
    signed(alice, 'a3', { type: 'member:role', identity: dave, role: 'admin', ts: 8 }),
    signed(bob, 'b3', { type: 'member:ban', identity: dave, banned: true, keep: [], ts: 9 }),
    signed(dave, 'd1', card(dave, 'dave-card', 10).payload)
  ]
  const expected = JSON.stringify(deriveBoard(ops, { owner: alice }))
  for (let run = 0; run < 50; run++) {
    assert.equal(JSON.stringify(deriveBoard(shuffle(ops), { owner: alice })), expected)
  }
  const state = deriveBoard(ops, { owner: alice })
  const role = (identity) => state.members.find((m) => m.identity === identity)
  assert.equal(state.owner, alice)
  assert.equal(role(alice).role, 'owner')
  assert.equal(role(bob).role, 'admin', 'the owner grants admin')
  assert.equal(role(carol).role, 'member', 'a member cannot grant roles')
  assert.equal(role(carol).banned, true, 'an admin bans a member')
  assert.equal(role(carol).bannedBy, bob)
  assert.equal(role(alice).banned, false, 'nobody bans the owner')
  assert.equal(role(dave).banned, false, 'an admin cannot ban an admin')
  assert.deepEqual(
    state.objects.map((o) => o.id),
    ['carol-old', 'dave-card'],
    'kept ops stay, later and backdated ones go'
  )
  const unbanned = deriveBoard(
    [
      ...ops,
      signed(alice, 'a4', { type: 'member:ban', identity: carol, banned: false, keep: [], ts: 11 })
    ],
    { owner: alice }
  )
  assert.equal(unbanned.members.find((m) => m.identity === carol).banned, false)
  assert.equal(unbanned.objects.length, 4, 'unban brings their ops back')
  const ownerless = deriveBoard(ops)
  assert.equal(ownerless.owner, null)
  assert.ok(
    ownerless.members.every((m) => !m.banned && m.role === 'member'),
    'no owner, no moderation'
  )
  console.log('✓ roles and bans follow the owner, converge, and keep only listed ops')
}

// Board icon and background image: image refs only, last writer wins.
{
  const ref = (type) => ({
    core: 'e'.repeat(64),
    id: { byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 10 },
    type
  })
  const ops = [
    op(alice, { type: 'board:info', icon: ref('image/png'), ts: 1 }),
    op(bob, { type: 'board:theme', backgroundImage: ref('image/jpeg'), ts: 2 }),
    op(carol, { type: 'board:info', icon: ref('video/mp4'), ts: 3 }),
    op(carol, { type: 'board:theme', backgroundImage: 'image:evil', ts: 4 })
  ]
  const state = deriveBoard(ops)
  assert.equal(state.info.icon.type, 'image/png', 'a video is not an icon')
  assert.equal(state.theme.backgroundImage.type, 'image/jpeg')
  assert.equal(state.info.description, '', 'an icon op leaves the description alone')
  const cleared = deriveBoard([...ops, op(bob, { type: 'board:info', icon: null, ts: 5 })])
  assert.equal(cleared.info.icon, null)
  console.log('✓ board icon and background image accept image refs only')
}

// Avatars: set apart from the name, image refs only, null clears.
{
  const ref = (type) => ({
    core: 'e'.repeat(64),
    id: { byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 10 },
    type
  })
  const ops = [
    op(alice, { type: 'profile', displayName: 'Alice', ts: 1 }),
    op(alice, { type: 'profile', avatar: ref('image/png'), ts: 2 }),
    op(bob, { type: 'profile', avatar: ref('image/webp'), ts: 3 }),
    op(carol, { type: 'profile', avatar: ref('video/mp4'), ts: 4 })
  ]
  const state = deriveBoard(ops)
  const member = (identity) => state.members.find((m) => m.identity === identity)
  assert.equal(member(alice).name, 'Alice', 'an avatar op leaves the name alone')
  assert.equal(member(alice).avatar.type, 'image/png')
  assert.equal(member(bob).name, null)
  assert.equal(member(bob).avatar.type, 'image/webp')
  assert.equal(member(carol).avatar, null, 'a video is not an avatar')
  assert.deepEqual(Object.keys(state.profiles), [alice], 'only named members are profiles')
  const cleared = deriveBoard([...ops, op(alice, { type: 'profile', avatar: null, ts: 5 })])
  assert.equal(cleared.members.find((m) => m.identity === alice).avatar, null)
  console.log('✓ avatars accept image refs only and leave names alone')
}

// Checklists, reactions, links, estimates, assignees, rules and WIP limits.
{
  const {
    boardActivity,
    boardStats,
    boardAlerts,
    myCards,
    cleanRule
  } = require('@opencollab/board-protocol')
  const base = [card(alice, 'c1', 1), card(alice, 'c2', 2), card(bob, 'c3', 3)]
  const ops = [
    ...base,
    op(alice, {
      type: 'card:checklist',
      ts: 10,
      objectId: 'c1',
      itemId: 'i1',
      text: 'one',
      position: 'H'
    }),
    op(alice, {
      type: 'card:checklist',
      ts: 11,
      objectId: 'c1',
      itemId: 'i2',
      text: 'two',
      position: 'V'
    }),
    // Bob ticks one item while Alice renames it: both survive.
    op(bob, { type: 'card:checklist', ts: 12, objectId: 'c1', itemId: 'i1', done: true }),
    op(alice, { type: 'card:checklist', ts: 12, objectId: 'c1', itemId: 'i1', text: 'one!' }),
    op(bob, { type: 'card:checklist', ts: 13, objectId: 'c1', itemId: 'i2', deleted: true }),
    op(bob, { type: 'reaction', ts: 14, objectId: 'c1', emoji: '🎉', on: true }),
    op(carol, { type: 'reaction', ts: 14, objectId: 'c1', emoji: '🎉', on: true }),
    op(carol, { type: 'reaction', ts: 15, objectId: 'c1', emoji: '🎉', on: false }),
    op(alice, { type: 'reaction', ts: 15, objectId: 'c1', emoji: '💩', on: true }),
    op(alice, {
      type: 'card:link',
      ts: 16,
      objectId: 'c2',
      targetId: 'c1',
      kind: 'blocks',
      linked: true
    }),
    op(alice, {
      type: 'card:link',
      ts: 16,
      objectId: 'c3',
      targetId: 'c1',
      kind: 'relates',
      linked: true
    }),
    op(alice, {
      type: 'card:link',
      ts: 16,
      objectId: 'c3',
      targetId: 'missing',
      kind: 'blocks',
      linked: true
    }),
    op(alice, { type: 'estimate', ts: 17, objectId: 'c1', value: 3 }),
    op(bob, { type: 'estimate', ts: 17, objectId: 'c1', value: 5 }),
    op(bob, { type: 'estimate', ts: 18, objectId: 'c1', value: -1 }),
    op(alice, { type: 'card:update', ts: 19, objectId: 'c1', assignees: [bob, 'nope'], points: 5 }),
    op(alice, { type: 'column:upsert', ts: 20, columnId: 'col:doing', wipLimit: 3 }),
    op(alice, { type: 'column:upsert', ts: 21, columnId: 'col:new', wipLimit: 0 }),
    op(alice, {
      type: 'rule:upsert',
      ts: 22,
      ruleId: 'rule:aaaaaaaaaaaa',
      rule: { trigger: { kind: 'enter', columnId: 'col:done' }, actions: { archive: true } }
    }),
    op(alice, { type: 'rule:upsert', ts: 22, ruleId: 'rule:bbbbbbbbbbbb', rule: { trigger: {} } })
  ]
  const orders = Array.from({ length: 20 }, () => deriveBoard(shuffle(ops)))
  for (const state of orders) assert.deepEqual(state, orders[0])
  const state = orders[0]
  const c1 = state.objects.find((o) => o.id === 'c1')
  assert.deepEqual(
    c1.checklist.map(({ id, text, done }) => ({ id, text, done })),
    [{ id: 'i1', text: 'one!', done: true }]
  )
  assert.deepEqual(c1.reactions, { '🎉': [bob] }, 'toggle off removes; unknown emoji dropped')
  assert.deepEqual(c1.blockedBy, ['c2'])
  assert.deepEqual(state.objects.find((o) => o.id === 'c3').links, [
    { cardId: 'c1', kind: 'relates' }
  ])
  assert.deepEqual(c1.estimates, { [alice]: 3, [bob]: 5 }, 'invalid estimate ignored')
  assert.deepEqual(c1.assignees, [bob])
  assert.equal(c1.points, 5)
  assert.ok(c1.updatedAt >= 19, 'updatedAt follows the latest change')
  assert.equal(state.columns.find((c) => c.id === 'col:doing').wipLimit, 3)
  assert.equal(state.columns.find((c) => c.id === 'col:new').wipLimit, null, '0 is not a limit')
  assert.deepEqual(
    state.rules.map((r) => r.id),
    ['rule:aaaaaaaaaaaa'],
    'invalid rule ignored'
  )
  assert.equal(cleanRule({ trigger: { kind: 'schedule', every: 'week' }, card: {} }), null)

  // A blocker that reaches Done stops blocking.
  const unblocked = deriveBoard([
    ...ops,
    op(alice, { type: 'card:move', ts: 30, objectId: 'c2', columnId: 'col:done', position: 'V' })
  ])
  assert.deepEqual(unblocked.objects.find((o) => o.id === 'c1').blockedBy, [])

  // Two members creating the same scheduled card keep one, everywhere.
  const twins = [
    card(alice, 'recur:x:2026-10-23', 40, { title: 'from alice' }),
    card(bob, 'recur:x:2026-10-23', 41, { title: 'from bob' })
  ]
  for (let i = 0; i < 10; i++) {
    const objects = deriveBoard(shuffle(twins)).objects
    assert.equal(objects.length, 1)
    assert.equal(objects[0].author, alice)
  }

  // Activity, stats, my work, assignment alerts.
  const withIds = ops.map((message, i) => ({ ...message, id: `op${i}` }))
  const feed = boardActivity(withIds, state)
  assert.ok(feed.some((entry) => entry.kind === 'checklist'))
  assert.ok(feed.some((entry) => entry.kind === 'linked'))
  assert.ok(boardActivity(withIds, state, { cardId: 'c3' }).every((e) => e.cardId === 'c3'))
  const done = deriveBoard([
    ...ops,
    op(alice, {
      type: 'card:move',
      ts: Date.now() - 1000,
      objectId: 'c1',
      columnId: 'col:done',
      position: 'V'
    })
  ])
  const stats = boardStats(
    [
      ...withIds,
      {
        id: 'm',
        identity: alice,
        payload: {
          type: 'card:move',
          ts: Date.now() - 1000,
          objectId: 'c1',
          columnId: 'col:done',
          position: 'V'
        }
      }
    ],
    done
  )
  assert.equal(stats.weeks.at(-1).done, 1)
  assert.equal(stats.weeks.at(-1).points, 5)
  assert.equal(stats.cycleTime.count, 1)
  assert.equal(stats.totals.done, 1)
  assert.deepEqual(
    myCards(state, bob).map((c) => c.id),
    ['c1']
  )
  assert.deepEqual(myCards(done, bob), [], 'done cards are not my work')
  const assigned = boardAlerts(
    [
      ...withIds,
      {
        id: 'again',
        identity: alice,
        payload: { type: 'card:update', ts: 25, objectId: 'c1', assignees: [bob] }
      }
    ],
    state,
    bob,
    { now: 100, since: 0 }
  ).filter((alert) => alert.kind === 'assigned')
  assert.equal(assigned.length, 1, 're-saving the same assignees is not news')
  console.log(
    '✓ checklists, reactions, links, estimates, rules converge; activity and stats add up'
  )
}
