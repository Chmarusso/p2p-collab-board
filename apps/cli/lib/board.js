// Board helpers shared by the CLI commands and the MCP server: finding cards,
// columns, members and checklist items in a Session's state, and sending changes
// to the worker and waiting for them to land.
const crypto = require('crypto')
const { messageTypes, LIMITS, REACTIONS } = require('@opencollab/board-protocol')

const shortKey = (key = '') => (key.length > 10 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key)

const newestFirst = (objects) =>
  [...objects].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))

function findPost(objects, selector) {
  const value = String(selector).replace(/^#/, '')
  const exact = objects.find((post) => post.id === value)
  if (exact) return exact
  const posts = newestFirst(objects)
  const index = Number(value)
  if (Number.isInteger(index) && index >= 1 && index <= posts.length) return posts[index - 1]
  // Then an id prefix, the exact title, and a unique part of a title.
  const lower = value.toLowerCase()
  const byId = posts.filter((post) => post.id.startsWith(value))
  const byTitle = posts.filter((post) => post.title.toLowerCase() === lower)
  const byPart = posts.filter((post) => post.title.toLowerCase().includes(lower))
  const matches = [byId, byTitle, byPart].find((list) => list.length) || []
  if (matches.length === 1) return matches[0]
  throw new Error(matches.length ? `"${selector}" matches several posts` : `No post "${selector}"`)
}

const labelNames = (session, post) =>
  (post.labelIds || [])
    .map((id) => session.state.labels.find((label) => label.id === id)?.name)
    .filter(Boolean)

// Date-only due dates are due at the end of that day, local time.
function deadlineOf(dueDate) {
  if (!dueDate) return null
  const [year, month, day] = dueDate.split('-').map(Number)
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
    ? new Date(year, month - 1, day, 23, 59, 59)
    : new Date(dueDate)
  return Number.isNaN(deadline.getTime()) ? null : deadline
}

const DAY = 86400000

// "Done" is the last column on every board.
function doneColumnId(session) {
  const { columns } = session.state
  return columns.length > 1 ? columns[columns.length - 1].id : null
}

const memberName = (session, identity) =>
  session.state.profiles[identity] ||
  session.state.members.find((member) => member.identity === identity)?.name ||
  shortKey(identity)

// Everyone on the board who isn't banned: members plus anyone with a profile.
function boardMembers(session) {
  const { members, profiles } = session.state
  const banned = new Set(members.filter((entry) => entry.banned).map((entry) => entry.identity))
  return [...new Set([...members.map((entry) => entry.identity), ...Object.keys(profiles)])].filter(
    (identity) => !banned.has(identity)
  )
}

// A member by display name, identity prefix or "me"; banned members are skipped.
function findMember(session, selector) {
  const value = String(selector).trim().toLowerCase()
  if (value === 'me') return session.state.publicKey
  const people = boardMembers(session)
  const byName = people.filter((identity) => memberName(session, identity).toLowerCase() === value)
  const matches = byName.length ? byName : people.filter((identity) => identity.startsWith(value))
  if (matches.length === 1) return matches[0]
  if (matches.length) throw new Error(`"${selector}" matches several members`)
  throw new Error(
    `No member "${selector}". Members: ${people.map((identity) => memberName(session, identity)).join(', ')}`
  )
}

// Comma-separated or repeated member selectors.
const findMembers = (session, selectors) =>
  []
    .concat(selectors || [])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => findMember(session, value))

// Columns by number (1-based, board order), name or id.
function findColumn(columns, selector) {
  const value = String(selector)
  const index = Number(value)
  if (Number.isInteger(index) && index >= 1 && index <= columns.length) return columns[index - 1]
  const match =
    columns.find((column) => column.id === value) ||
    columns.find((column) => column.name.toLowerCase() === value.toLowerCase())
  if (!match) {
    throw new Error(
      `No column "${selector}". Columns: ${columns.map((column, i) => `${i + 1} ${column.name}`).join(', ')}`
    )
  }
  return match
}

const LABEL_COLORS = ['#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef']
LABEL_COLORS.push('#579dff', '#6cc3e0', '#94c748', '#e774bb', '#8590a2')
const newLabelId = () => `label:${crypto.randomBytes(6).toString('hex')}`

// The worker answers a refused action with board-action-error.
const refused = (reply, message) =>
  reply.type === 'board-action-error' && reply.action === message.type && new Error(reply.error)

// Sends `message`, then waits for a board-state where `check(state)` holds.
async function apply(session, message, check, label) {
  session.send(message)
  await session.wait(
    (reply, state) =>
      refused(reply, message) || (reply.type === messageTypes.boardState && check(state)),
    { label }
  )
}

// Sends a request the worker answers with its own reply type.
function request(session, message, replyType, label) {
  const requestId = crypto.randomBytes(6).toString('hex')
  session.send({ ...message, requestId })
  return session.wait(
    (reply) =>
      refused(reply, message) || (reply.type === replyType && reply.requestId === requestId),
    { label }
  )
}

// Rules run in the worker after the op that triggered them; let them land
// before the command leaves the board.
async function quiet(session, ms = 1500) {
  if (!session.state.rules.some((rule) => rule.enabled)) return
  let last = Date.now()
  const touch = (message) => {
    if (message.type === messageTypes.boardState) last = Date.now()
  }
  session.waiters.add(touch)
  while (Date.now() - last < ms) await session.sleep(100)
  session.waiters.delete(touch)
}

// Finds a label by name, creating it (with a free color) when it is new.
const findLabel = (session, name) =>
  session.state.labels.find((entry) => entry.name.toLowerCase() === String(name).toLowerCase())

async function ensureLabel(session, labelName, color) {
  const name = String(labelName).trim().slice(0, LIMITS.labelName)
  const existing = findLabel(session, name)
  if (existing) return existing
  const labelId = newLabelId()
  await apply(
    session,
    {
      type: messageTypes.labelUpsert,
      labelId,
      name,
      color:
        color ||
        LABEL_COLORS.find(
          (value) => !session.state.labels.some((entry) => entry.color === value)
        ) ||
        LABEL_COLORS[0]
    },
    (state) => state.labels.some((entry) => entry.id === labelId),
    'label to be created'
  )
  return { id: labelId, name }
}

const cardOf = (state, id) => state.objects.find((entry) => entry.id === id)
const isOpen = (session, card) =>
  !card.archived && !card.template && card.columnId !== doneColumnId(session)

function findItem(card, selector) {
  const items = card.checklist || []
  const value = String(selector)
  const index = Number(value)
  if (Number.isInteger(index) && index >= 1 && index <= items.length) return items[index - 1]
  const matches = items.filter(
    (item) => item.id.startsWith(value) || item.text.toLowerCase() === value.toLowerCase()
  )
  if (matches.length === 1) return matches[0]
  throw new Error(
    matches.length
      ? `"${selector}" matches several items`
      : `No checklist item "${selector}" on "${card.title}" (see \`opencollab show\`)`
  )
}

const EMOJI_NAMES = {
  '+1': '👍',
  thumbsup: '👍',
  heart: '❤️',
  tada: '🎉',
  laugh: '😂',
  joy: '😂',
  wow: '😮',
  rocket: '🚀',
  eyes: '👀',
  fire: '🔥'
}

function reactionOf(value) {
  const text = String(value).trim()
  const emoji = EMOJI_NAMES[text.toLowerCase()] || text
  if (REACTIONS.includes(emoji)) return emoji
  if (REACTIONS.includes(`${emoji}️`)) return `${emoji}️`
  throw new Error(`Use one of ${REACTIONS.join(' ')} (or ${Object.keys(EMOJI_NAMES).join(', ')})`)
}

// Comments by number in `opencollab show` (oldest first) or by id suffix/prefix.
function findComment(card, selector) {
  const comments = [...(card.comments || [])].sort(
    (a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
  )
  const value = String(selector)
  const index = Number(value)
  if (Number.isInteger(index) && index >= 1 && index <= comments.length) return comments[index - 1]
  const matches = comments.filter((entry) => entry.id.startsWith(value) || entry.id.endsWith(value))
  if (matches.length === 1) return matches[0]
  throw new Error(
    matches.length ? `"${selector}" matches several comments` : `No comment "${selector}"`
  )
}

// A remembered board by number (1-based) or name; the latest by default.
function selectBoard(boards, selector, hint = 'See `opencollab boards`.') {
  if (!boards.length) {
    throw new Error('No boards yet. Use `opencollab create` or `opencollab join`.')
  }
  if (!selector) return boards[0]
  const index = Number(selector)
  if (Number.isInteger(index) && index >= 1 && index <= boards.length) return boards[index - 1]
  const match = boards.find((board) => board.name.toLowerCase() === String(selector).toLowerCase())
  if (!match) throw new Error(`No remembered board "${selector}". ${hint}`)
  return match
}

// Why moving `card` into `column` deserves a second look: WIP limit, open blockers.
function moveWarnings(session, card, column) {
  const live = session.state.objects.filter(
    (entry) =>
      entry.columnId === column.id && entry.id !== card.id && !entry.archived && !entry.template
  )
  const warnings = []
  if (column.wipLimit && card.columnId !== column.id && live.length >= column.wipLimit) {
    warnings.push(`${column.name} is at its WIP limit (${live.length}/${column.wipLimit}).`)
  }
  if (column.id === doneColumnId(session) && card.blockedBy?.length) {
    const blockers = card.blockedBy.map(
      (id) => session.state.objects.find((entry) => entry.id === id)?.title || id
    )
    warnings.push(`"${card.title}" is still blocked by: ${blockers.join(', ')}`)
  }
  return warnings
}

// Open cards with a due date in Overdue / Today / This week / Later, each sorted
// by deadline, plus how many open cards have no date.
function agendaGroups(session) {
  const now = new Date()
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const groups = { overdue: [], today: [], thisWeek: [], later: [] }
  let noDate = 0
  for (const card of session.state.objects.filter((entry) => isOpen(session, entry))) {
    const deadline = deadlineOf(card.dueDate)
    if (!deadline) {
      noDate++
      continue
    }
    const group =
      deadline < now
        ? 'overdue'
        : deadline <= endOfToday
          ? 'today'
          : deadline - endOfToday <= 6 * DAY
            ? 'thisWeek'
            : 'later'
    groups[group].push({ card, deadline })
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.deadline - b.deadline)
  return { ...groups, noDate }
}

// Identities @mentioned in `text`, matched against display names (longest first,
// so "@Ann Lee" wins over "@Ann"). Same rules as the desktop and mobile editors.
function findMentions(text, profiles) {
  const found = new Set()
  let rest = text || ''
  const members = Object.entries(profiles).sort((a, b) => b[1].length - a[1].length)
  for (const [identity, name] of members) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|[^\\w])@${escaped}(?![\\w])`, 'g')
    if (!pattern.test(rest)) continue
    found.add(identity)
    rest = rest.replace(pattern, '$1 ')
  }
  return [...found]
}

module.exports = {
  DAY,
  EMOJI_NAMES,
  agendaGroups,
  apply,
  boardMembers,
  cardOf,
  deadlineOf,
  doneColumnId,
  ensureLabel,
  findColumn,
  findComment,
  findItem,
  findLabel,
  findMember,
  findMembers,
  findMentions,
  findPost,
  isOpen,
  labelNames,
  memberName,
  moveWarnings,
  newestFirst,
  quiet,
  reactionOf,
  refused,
  request,
  selectBoard,
  shortKey
}
