// opencollab — command-line client for OpenCollab boards. It drives the same
// Bare backend as the desktop and mobile apps (workers/main.js), so boards,
// cards, columns, labels, comments, votes and encrypted images are fully
// interoperable.
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const readline = require('readline')
const Identity = require('keet-identity-key')
const { command, flag, arg, summary, description, header, footer } = require('paparam')
const {
  messageTypes,
  normalizeInvite,
  inviteLink,
  LIMITS,
  REACTIONS
} = require('@opencollab/board-protocol')
const { Session } = require('./lib/session')
const {
  DAY,
  EMOJI_NAMES,
  apply,
  cardOf,
  deadlineOf,
  doneColumnId,
  ensureLabel,
  findColumn,
  findComment,
  findItem,
  findMember,
  findMembers,
  findLabel,
  moveWarnings,
  agendaGroups,
  selectBoard,
  findMentions,
  findPost,
  isOpen,
  labelNames,
  memberName,
  newestFirst,
  quiet,
  reactionOf,
  refused,
  request,
  shortKey
} = require('./lib/board')
const runtime = require('./lib/runtime')
const store = require('./lib/store')
const { MAX_IMAGE_BYTES, imageType, imageSize, imageKey, extensions } = require('./lib/images')

const defaultStorage = path.join(os.homedir(), '.opencollab-cli')

const commonFlags = () => [
  flag('--storage|-s [dir]', `storage directory (default ${defaultStorage})`),
  flag('--verbose', 'print worker logs')
]
const boardFlags = () => [
  ...commonFlags(),
  flag('--board|-b [board]', 'board name or number from `opencollab boards` (default: latest)'),
  flag('--wait|-w [seconds]', 'how long to wait for peers (default 10)')
]

const storageOf = (flags) => path.resolve(flags.storage || defaultStorage)
const waitOf = (flags) => Math.max(0, Number(flags.wait ?? 10) || 0)
const say = (...lines) => console.log(lines.join('\n'))
const warn = (text) => console.error(`! ${text}`)

// Takes an ISO string or a ms timestamp.
function relativeTime(when) {
  const time = typeof when === 'number' ? when : Date.parse(when || '')
  const seconds = Math.max(0, (Date.now() - time) / 1000)
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error(`${question.trim()} needs a terminal (or the matching env variable)`))
      return
    }
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    })
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) rl.output.write(text)
        else if (text.includes('\n')) rl.output.write('\n')
      }
    }
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function password({ confirm = false } = {}) {
  if (process.env.OPENCOLLAB_PASSWORD) return process.env.OPENCOLLAB_PASSWORD
  const value = await ask('Password: ', { hidden: true })
  if (confirm && (await ask('Repeat password: ', { hidden: true })) !== value) {
    throw new Error('Passwords do not match')
  }
  return value
}

function action(fn) {
  return async (context) => {
    try {
      await fn(context)
    } catch (err) {
      if (/could not be locked/i.test(err.message)) {
        err.message =
          'This storage is in use by another opencollab process (e.g. `watch`).\n' +
          'Stop it first, or use a different --storage.'
      }
      console.error(`error: ${err.message}`)
      process.exitCode = 1
    }
  }
}

async function withSession(flags, fn) {
  const session = new Session(storageOf(flags), { verbose: !!flags.verbose })
  try {
    return await fn(session)
  } finally {
    await session.close()
    if (session.state.update === 'applied') {
      warn(`opencollab updated to v${runtime.manifest().version}; the new version runs next time.`)
    }
  }
}

// Unlock, open the selected (or given) board, remember it and wait for peers.
async function openBoard(session, flags, { invite, name } = {}) {
  const storage = storageOf(flags)
  const secret = await password()
  await session.unlock(secret)
  const target = invite
    ? { invite, name: '' }
    : selectBoard(await store.readBoards(storage, secret), flags.board)
  const room = await session.openBoard(target.invite, invite ? undefined : target.name || name)
  const online = await session.settle(waitOf(flags))
  const boardName =
    session.state.room?.boardName || room.boardName || target.name || 'Unnamed board'
  await store.rememberBoard(storage, secret, { invite: room.invite, name: boardName })
  if (!online && waitOf(flags) > 0) {
    warn(`No peers reachable within ${waitOf(flags)}s — using the local copy.`)
  }
  return { room, boardName, online }
}

// Refuse writes on a board that has never synced: Autobee keeps a joiner's
// writes in memory until it first meets an existing member, so a CLI that
// exits before that would silently drop them.
function assertWritable(session, room) {
  if (room.writable || session.state.synced) return
  throw new Error(
    'This board has not synced yet: no member has been online since you joined.\n' +
      'Try again when another member is online (or keep `opencollab watch` running).'
  )
}

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

function author(session, identity) {
  const name = session.state.profiles[identity]
  return name ? `${name} (${shortKey(identity)})` : shortKey(identity)
}

// After a write: give connected peers a moment to replicate it.
async function finishWrite(session) {
  if (session.state.peers > 0) {
    await session.sleep(3000)
    say(`Synced with ${session.state.peers} peer${session.state.peers === 1 ? '' : 's'}.`)
  } else {
    warn('Saved locally. No peer is online, so it reaches others the next time this CLI')
    warn('(or `opencollab watch`) runs while another member is online.')
  }
}

function printPost(session, post, index, { comments = false } = {}) {
  const score = Object.values(post.votes || {}).reduce((sum, vote) => sum + vote, 0)
  const own = post.votes?.[session.state.publicKey]
  const column = session.state.columns.find((entry) => entry.id === post.columnId)
  const labels = labelNames(session, post)
  const extras = [
    column ? `in ${column.name}` : null,
    labels.length ? `[${labels.join(', ')}]` : null,
    dueText(post.dueDate),
    post.archived ? 'archived' : null,
    `${score >= 0 ? '▲' : '▼'} ${score}${own ? (own > 0 ? ' (you ▲)' : ' (you ▼)') : ''}`,
    `${(post.comments || []).length} comments`,
    post.images?.length
      ? `${post.images.length} attachment${post.images.length === 1 ? '' : 's'}`
      : null,
    post.template ? 'template' : null,
    ...cardBadges(session, post)
  ].filter(Boolean)
  say(
    `#${index}  ${post.title}`,
    `    ${author(session, post.author)} · ${relativeTime(post.createdAt)} · ${extras.join(' · ')} · id ${post.id}`
  )
  if (post.body) say(...post.body.split('\n').map((line) => `    ${line}`))
  if (comments) {
    const sorted = [...(post.comments || [])].sort(
      (a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
    )
    for (const comment of sorted) {
      say(
        `    └ ${author(session, comment.author)}: ${comment.text}  (${relativeTime(comment.createdAt)})`
      )
    }
  }
}

const dueWhen = (dueDate) =>
  /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : deadlineOf(dueDate).toLocaleString()

function dueText(dueDate) {
  const deadline = deadlineOf(dueDate)
  if (!deadline) return null
  const left = deadline - Date.now()
  const when = dueWhen(dueDate)
  return left < 0 ? `overdue ${when}` : left < DAY ? `due soon ${when}` : `due ${when}`
}

const STALE_DAYS = 7

const daysSince = (ms) => (ms ? Math.floor((Date.now() - ms) / DAY) : 0)

// Kanban markers shared by every card listing.
function cardBadges(session, card) {
  const checklist = card.checklist || []
  const age = daysSince(card.updatedAt)
  const reactions = Object.entries(card.reactions || {})
    .filter(([, who]) => who.length)
    .map(([emoji, who]) => `${emoji} ${who.length}`)
  return [
    card.blockedBy?.length ? 'blocked' : null,
    card.assignees?.length
      ? card.assignees.map((identity) => `@${memberName(session, identity)}`).join(' ')
      : null,
    checklist.length
      ? `☑ ${checklist.filter((item) => item.done).length}/${checklist.length}`
      : null,
    typeof card.points === 'number' ? `${card.points} pts` : null,
    reactions.length ? reactions.join(' ') : null,
    !card.archived && card.columnId !== doneColumnId(session) && age >= STALE_DAYS
      ? `stale ${age}d`
      : null
  ].filter(Boolean)
}

function columnHeader(column, cards) {
  const live = cards.filter((card) => !card.archived)
  const limit = column.wipLimit
  const points = live.reduce((sum, card) => sum + (card.points || 0), 0)
  const count = limit ? `${live.length}/${limit}` : `${live.length}`
  const warning =
    limit && live.length > limit
      ? ' — over WIP limit'
      : limit && live.length === limit
        ? ' — at WIP limit'
        : ''
  return `## ${column.name} (${count}${points ? ` · ${points} pts` : ''})${warning}`
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—'
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  if (ms < DAY) return `${(ms / 3600000).toFixed(1)}h`
  return `${(ms / DAY).toFixed(1)}d`
}

function table(headers, rows) {
  const widths = headers.map((head, i) =>
    Math.max(head.length, ...rows.map((row) => row[i].length))
  )
  const line = (cells) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd()
  say(line(headers), line(widths.map((width) => '─'.repeat(width))), ...rows.map(line))
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// Opens the board for a write on one card and returns it.
async function openCard(session, flags, selector) {
  const opened = await openBoard(session, flags)
  assertWritable(session, opened.room)
  return { ...opened, card: findPost(session.state.objects, selector) }
}

async function saveIdentity(flags, mnemonic, { force }) {
  const storage = storageOf(flags)
  if ((await store.hasIdentity(storage)) && !force) {
    throw new Error(`An identity already exists in ${storage}. Pass --force to replace it.`)
  }
  await Identity.from({ mnemonic })
  const secret = await password({ confirm: true })
  if (secret.length < 8) throw new Error('Use a password with at least 8 characters')
  await store.removeIdentity(storage)
  await store.stageMnemonic(storage, mnemonic)
  // Invites are tied to the identity that joined, so a new identity starts clean.
  await store.forgetBoards(storage)
  return withSession(flags, (session) => session.unlock(secret, { create: true }))
}

const identityNew = command(
  'new',
  summary('Create a new identity and print its recovery phrase'),
  ...commonFlags(),
  flag('--force', 'replace an existing identity'),
  action(async ({ flags }) => {
    const mnemonic = Identity.generateMnemonic()
    const publicKey = await saveIdentity(flags, mnemonic, { force: !!flags.force })
    say(
      `Identity ${publicKey}`,
      '',
      'Recovery phrase — write it down and keep it offline:',
      '',
      `  ${mnemonic}`
    )
  })
)

const identityImport = command(
  'import',
  summary('Use an existing identity from its recovery phrase'),
  description('Reads the phrase from OPENCOLLAB_MNEMONIC or prompts for it.'),
  ...commonFlags(),
  flag('--force', 'replace an existing identity'),
  action(async ({ flags }) => {
    const phrase =
      process.env.OPENCOLLAB_MNEMONIC || (await ask('Recovery phrase: ', { hidden: true }))
    const mnemonic = phrase.trim().replace(/\s+/g, ' ')
    const publicKey = await saveIdentity(flags, mnemonic, { force: !!flags.force })
    say(`Identity ${publicKey} imported.`)
  })
)

const identityShow = command(
  'show',
  summary('Print the identity public key'),
  ...commonFlags(),
  action(async ({ flags }) => {
    const secret = await password()
    const publicKey = await withSession(flags, (session) => session.unlock(secret))
    say(`Identity ${publicKey}`, `Storage  ${storageOf(flags)}`)
  })
)

const identity = command(
  'identity',
  summary('Create, import or show your identity'),
  identityNew,
  identityImport,
  identityShow
)

const boards = command(
  'boards',
  summary('List remembered boards'),
  ...commonFlags(),
  action(async ({ flags }) => {
    const list = await store.readBoards(storageOf(flags), await password())
    if (!list.length) return say('No boards yet. Use `opencollab create` or `opencollab join`.')
    list.forEach((board, index) => say(`${index + 1}. ${board.name}`))
  })
)

const create = command(
  'create',
  summary('Create a private board and print its invitation'),
  arg('[name]', 'board name'),
  flag('--sample', 'Fill the board with sample cards that show the features'),
  ...commonFlags(),
  action(async ({ args, flags }) => {
    if (!args.name && !flags.sample) throw new Error('Name the board, or pass --sample.')
    await withSession(flags, async (session) => {
      const storage = storageOf(flags)
      const secret = await password()
      await session.unlock(secret)
      const room = await session.openBoard(null, args.name, { sample: !!flags.sample })
      await store.rememberBoard(storage, secret, {
        invite: room.invite,
        name: room.boardName || args.name
      })
      say(
        `Created "${room.boardName || args.name}".`,
        '',
        'Invitation:',
        `  ${inviteLink(room.invite)}`
      )
    })
  })
)

const join = command(
  'join',
  summary('Join a board with an invitation'),
  arg('<invite>', 'invitation link or code'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const { boardName, room } = await openBoard(session, flags, {
        invite: normalizeInvite(args.invite)
      })
      if (room.writable || session.state.synced) {
        say(`Joined "${boardName}" · ${session.state.objects.length} posts.`)
      } else {
        say(
          "Joined, but no board member is online yet. Boards live only on members' devices,",
          'so this one fills in once another member opens it. Run `opencollab watch` to',
          'wait and finish joining automatically.'
        )
      }
    })
  })
)

const forget = command(
  'forget',
  summary('Remove a board from the remembered list'),
  arg('<board>', 'board name or number'),
  ...commonFlags(),
  action(async ({ args, flags }) => {
    const storage = storageOf(flags)
    const secret = await password()
    const list = await store.readBoards(storage, secret)
    const board = selectBoard(list, args.board)
    await store.writeBoards(
      storage,
      secret,
      list.filter((entry) => entry !== board)
    )
    say(`Forgot "${board.name}".`)
  })
)

const invite = command(
  'invite',
  summary('Print the invitation link for a board'),
  ...commonFlags(),
  flag('--board|-b [board]', 'board name or number (default: latest)'),
  action(async ({ flags }) => {
    const board = selectBoard(
      await store.readBoards(storageOf(flags), await password()),
      flags.board
    )
    say(inviteLink(board.invite))
  })
)

const name = command(
  'name',
  summary('Set your display name on a board'),
  arg('<displayName>', 'name other members see'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      session.send({ type: messageTypes.profileSet, displayName: args.displayName })
      await session.wait((message) => message.type === messageTypes.profileStatus, {
        label: 'display name'
      })
      say(`You are "${session.state.displayName}" on this board.`)
      await finishWrite(session)
    })
  })
)

const avatar = command(
  'avatar',
  summary('Set your avatar on a board ("clear" removes it)'),
  arg('<file>', '.jpg, .png, .gif or .webp image up to 5 MB, or "clear"'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    let image = null
    if (args.file !== 'clear') {
      const type = imageType(args.file)
      if (!type) throw new Error(`${args.file}: use a .jpg, .png, .gif or .webp image`)
      const data = await fs.readFile(args.file)
      if (data.length > MAX_IMAGE_BYTES) throw new Error(`${args.file}: larger than 5 MB`)
      image = { data: data.toString('base64'), type, ...imageSize(data, type) }
    }
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const mine = (state) =>
        state.members.find((member) => member.identity === state.publicKey)?.avatar || null
      const before = mine(session.state)
      session.send({ type: messageTypes.profileAvatarSet, image })
      await session.wait(
        (reply, state) => {
          if (
            reply.type === 'board-action-error' &&
            reply.action === messageTypes.profileAvatarSet
          ) {
            return new Error(reply.error)
          }
          if (reply.type !== messageTypes.boardState) return false
          const now = mine(state)
          return image ? now && (!before || imageKey(now) !== imageKey(before)) : !now
        },
        { label: 'avatar to be saved' }
      )
      say(image ? 'Avatar saved.' : 'Avatar removed.')
      await finishWrite(session)
    })
  })
)

const posts = command(
  'posts',
  summary('List posts, newest first'),
  ...boardFlags(),
  flag('--comments|-c', 'include comments'),
  flag('--json', 'print raw JSON'),
  action(async ({ flags }) => {
    await withSession(flags, async (session) => {
      const { boardName } = await openBoard(session, flags)
      const list = newestFirst(session.state.objects)
      if (flags.json) {
        return say(
          JSON.stringify(
            { board: boardName, profiles: session.state.profiles, posts: list },
            null,
            2
          )
        )
      }
      say(`${boardName} · ${list.length} posts · ${session.state.peers} peers`, '')
      if (!list.length) say('No posts yet. Add one with `opencollab post "Title"`.')
      list.forEach((post, index) => {
        printPost(session, post, index + 1, { comments: !!flags.comments })
        say('')
      })
    })
  })
)

const post = command(
  'post',
  summary('Add a post, optionally with images'),
  arg('<title>', 'post title'),
  ...boardFlags(),
  flag('--body [text]', 'post description'),
  flag('--image|-i [file]', 'attach an image (repeat up to 4 times)').multiple(),
  action(async ({ args, flags }) => {
    const images = []
    for (const file of [].concat(flags.image || []).slice(0, 4)) {
      const type = imageType(file)
      if (!type) throw new Error(`${file}: use a .jpg, .png, .gif or .webp image`)
      const data = await fs.readFile(file)
      if (data.length > MAX_IMAGE_BYTES) throw new Error(`${file}: larger than 5 MB`)
      images.push({ data: data.toString('base64'), type, ...imageSize(data, type) })
    }
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const startedAt = Date.now()
      session.send({
        type: messageTypes.boardCreate,
        title: args.title,
        body: flags.body || '',
        mentions: findMentions(flags.body, session.state.profiles),
        images
      })
      await session.wait(
        (message, state) =>
          message.type === messageTypes.boardState &&
          state.objects.some(
            (object) =>
              object.author === state.publicKey &&
              object.title === args.title.trim() &&
              Date.parse(object.createdAt) >= startedAt - 1000
          ),
        { label: 'post to be saved' }
      )
      say(`Posted "${args.title.trim()}"${images.length ? ` with ${images.length} image(s)` : ''}.`)
      await finishWrite(session)
    })
  })
)

const comment = command(
  'comment',
  summary('Comment on a post'),
  arg('<post>', 'post number from `opencollab posts` or id prefix'),
  arg('<text>', 'comment text, or - to read it from stdin'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    // stdin suits scripts: multi-line text, or text that starts with "-".
    const text = args.text === '-' ? await readStdin() : args.text
    if (!text.trim()) throw new Error('The comment is empty')
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const target = findPost(session.state.objects, args.post)
      session.send({
        type: messageTypes.boardComment,
        objectId: target.id,
        text,
        mentions: findMentions(text, session.state.profiles)
      })
      await session.wait(
        (message, state) =>
          message.type === messageTypes.boardState &&
          state.objects
            .find((object) => object.id === target.id)
            ?.comments?.some(
              (entry) => entry.author === state.publicKey && entry.text === text.trim()
            ),
        { label: 'comment to be saved' }
      )
      say(`Commented on "${target.title}".`)
      await finishWrite(session)
    })
  })
)

const vote = command(
  'vote',
  summary('Vote on a post: up, down or clear'),
  arg('<post>', 'post number from `opencollab posts` or id prefix'),
  arg('<direction>', 'up | down | clear'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    const value = { up: 1, down: -1, clear: 0 }[String(args.direction).toLowerCase()]
    if (value === undefined) throw new Error('Direction must be up, down or clear')
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const target = findPost(session.state.objects, args.post)
      session.send({ type: messageTypes.boardVote, objectId: target.id, value })
      await session.wait(
        (message, state) => {
          if (message.type !== messageTypes.boardState) return false
          const votes = state.objects.find((object) => object.id === target.id)?.votes || {}
          return (votes[state.publicKey] || 0) === value
        },
        { label: 'vote to be saved' }
      )
      say(`Vote on "${target.title}": ${String(args.direction).toLowerCase()}.`)
      await finishWrite(session)
    })
  })
)

const images = command(
  'images',
  summary("Download a post's images and videos"),
  arg('<post>', 'post number from `opencollab posts` or id prefix'),
  ...boardFlags(),
  flag('--out|-o [dir]', 'output directory (default: current directory)'),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      await openBoard(session, flags)
      const target = findPost(session.state.objects, args.post)
      if (!target.images?.length) return say(`"${target.title}" has no images.`)
      const out = path.resolve(flags.out || '.')
      await fs.mkdir(out, { recursive: true })
      for (const [index, ref] of target.images.entries()) {
        const file = path.join(out, `${target.id}-${index + 1}${extensions[ref.type] || ''}`)
        // Videos come back as a path to a decrypted copy, not as bytes.
        if (ref.type.startsWith('video/')) {
          session.send({ type: messageTypes.boardMedia, ref })
          const result = await session.wait(
            (message) => message.type === 'board-media' && message.key === imageKey(ref),
            { timeout: 120000, label: 'video download' }
          )
          if (!result.path) {
            warn(`Video ${index + 1} unavailable (${result.error}) — its author must be online.`)
            continue
          }
          await fs.copyFile(result.path, file)
          say(`Saved ${file}`)
          continue
        }
        session.send({ type: 'board:image', ref })
        const result = await session.wait(
          (message) => message.type === 'board-image' && message.key === imageKey(ref),
          { timeout: 30000, label: 'image download' }
        )
        if (!result.data) {
          warn(
            `Image ${index + 1} unavailable (${result.error}) — its author or a viewer must be online.`
          )
          continue
        }
        await fs.writeFile(file, Buffer.from(result.data, 'base64'))
        say(`Saved ${file}`)
      }
    })
  })
)

const watch = command(
  'watch',
  summary('Stay online for a board and print new activity'),
  description(
    'Keeps the board online so other members can sync with it (including images you\n' +
      'have viewed). Stop with Ctrl+C.'
  ),
  ...boardFlags(),
  action(async ({ flags }) => {
    await withSession(flags, async (session) => {
      const { boardName, room } = await openBoard(session, { ...flags, wait: 0 })
      let synced = room.writable || session.state.synced
      const seen = new Set()
      const remember = () => {
        for (const object of session.state.objects) {
          seen.add(object.id)
          for (const entry of object.comments || []) seen.add(entry.id)
        }
      }
      remember()
      let peers = session.state.peers
      say(`Watching "${boardName}" · ${session.state.objects.length} posts · Ctrl+C to stop`)
      if (!synced) say('· waiting for a board member to come online to finish joining…')
      session.waiters.add((message) => {
        if (message.type === messageTypes.boardSynced && !synced) {
          synced = true
          const name = session.state.room?.boardName
          say(`· synced with the board${name ? ` "${name}"` : ''} — you can post now`)
        }
        if (message.type === 'peer-count' && session.state.peers !== peers) {
          peers = session.state.peers
          say(`· ${peers} peer${peers === 1 ? '' : 's'} connected`)
        }
        if (message.type !== messageTypes.boardState) return
        for (const object of session.state.objects) {
          if (!seen.has(object.id)) {
            say(`+ post   ${author(session, object.author)}: ${object.title}`)
          }
          for (const entry of object.comments || []) {
            if (!seen.has(entry.id)) {
              say(`+ comment ${author(session, entry.author)} on "${object.title}": ${entry.text}`)
            }
          }
        }
        remember()
      })
      // Ctrl+C in a terminal, SIGTERM from service managers.
      await new Promise((resolve) => {
        process.once('SIGINT', resolve)
        process.once('SIGTERM', resolve)
      })
      say('', 'Leaving board…')
    })
  })
)

const version = command(
  'version',
  summary('Print the CLI version and how it is updated'),
  action(() => {
    const { version: current, upgrade } = runtime.manifest()
    say(
      `opencollab ${current}`,
      runtime.bundled
        ? `Installed bundle at ${runtime.root}\nOTA updates from ${upgrade}`
        : 'Running from source (no OTA updates; use git pull)'
    )
  })
)

const update = command(
  'update',
  summary('Check the pear link for a newer CLI and install it'),
  ...commonFlags(),
  flag('--wait|-w [seconds]', 'how long to look for an update (default 60)'),
  action(async ({ flags }) => {
    if (!runtime.bundled) {
      return say('Running from source — update this checkout with git pull instead.')
    }
    const before = runtime.manifest().version
    const seconds = Math.max(1, Number(flags.wait ?? 60) || 60)
    await withSession(flags, async (session) => {
      await session.ready()
      say(`Checking for updates (current v${before})…`)
      await session
        .wait(
          (message, state) => {
            if (message.type === 'updater' && state.update === 'downloading') say('Downloading…')
            return state.update === 'applied'
          },
          { timeout: seconds * 1000, label: 'update' }
        )
        .catch(() => {})
      if (session.state.update === null) say(`No newer version found within ${seconds}s.`)
    })
  })
)

const board = command(
  'board',
  summary('Show the board: columns and their cards'),
  ...boardFlags(),
  flag('--archived|-a', 'include archived cards'),
  flag('--json', 'print raw JSON'),
  action(async ({ flags }) => {
    await withSession(flags, async (session) => {
      const { boardName } = await openBoard(session, flags)
      const { columns, objects, labels, rules, theme, info, profiles } = session.state
      if (flags.json) {
        return say(
          JSON.stringify(
            { board: boardName, info, theme, columns, labels, rules, profiles, cards: objects },
            null,
            2
          )
        )
      }
      // Card numbers match `opencollab posts`, so either list can be used to pick one.
      const numbers = new Map(newestFirst(objects).map((post, index) => [post.id, index + 1]))
      say(`${boardName} · ${objects.length} cards · ${session.state.peers} peers`)
      if (info.description) say(...info.description.split('\n').map((line) => `  ${line}`))
      const line = (card) => {
        const extras = [
          labelNames(session, card).length ? `[${labelNames(session, card).join(', ')}]` : null,
          dueText(card.dueDate),
          Object.keys(card.votes || {}).length
            ? `▲ ${Object.values(card.votes).reduce((sum, vote) => sum + vote, 0)}`
            : null,
          card.comments?.length ? `${card.comments.length} comments` : null,
          ...cardBadges(session, card),
          card.archived ? 'archived' : null
        ].filter(Boolean)
        say(
          `  #${numbers.get(card.id)}  ${card.title}${extras.length ? `  · ${extras.join(' · ')}` : ''}`
        )
      }
      // Template cards stay out of the columns; `add --from-template` uses them.
      for (const column of columns) {
        const cards = objects.filter(
          (card) =>
            card.columnId === column.id && !card.template && (flags.archived || !card.archived)
        )
        say('', columnHeader(column, cards))
        cards.forEach(line)
      }
      const templates = objects.filter((card) => card.template && !card.archived)
      if (templates.length) {
        say('', `## Templates (${templates.length})`)
        templates.forEach(line)
      }
    })
  })
)

const columnAdd = command(
  'add',
  summary('Add a column at the end'),
  arg('<name>', 'column name'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const before = session.state.columns.length
      await apply(
        session,
        { type: messageTypes.columnCreate, name: args.name },
        (state) => state.columns.length > before,
        'column to be added'
      )
      say(`Added column "${args.name.trim()}".`)
      await finishWrite(session)
    })
  })
)

const columnRename = command(
  'rename',
  summary('Rename a column'),
  arg('<column>', 'column number, name or id'),
  arg('<name>', 'new name'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const column = findColumn(session.state.columns, args.column)
      const name = args.name.trim().slice(0, LIMITS.columnName)
      await apply(
        session,
        { type: messageTypes.columnUpdate, columnId: column.id, name },
        (state) => state.columns.find((entry) => entry.id === column.id)?.name === name,
        'column to be renamed'
      )
      say(`Renamed "${column.name}" to "${name}".`)
      await finishWrite(session)
    })
  })
)

const columnMove = command(
  'move',
  summary('Move a column to a position (1 = first)'),
  arg('<column>', 'column number, name or id'),
  arg('<position>', 'new position, 1-based'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    const position = Number(args.position)
    if (!Number.isInteger(position) || position < 1) throw new Error('Position must be 1 or more')
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const column = findColumn(session.state.columns, args.column)
      const target = Math.min(position, session.state.columns.length) - 1
      await apply(
        session,
        { type: messageTypes.columnUpdate, columnId: column.id, index: target },
        (state) => state.columns.findIndex((entry) => entry.id === column.id) === target,
        'column to be moved'
      )
      say(`Moved "${column.name}" to position ${target + 1}.`)
      await finishWrite(session)
    })
  })
)

const columnDelete = command(
  'delete',
  summary('Delete a column; its cards move to the first remaining column'),
  arg('<column>', 'column number, name or id'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      if (session.state.columns.length < 2) throw new Error('A board keeps at least one column')
      const column = findColumn(session.state.columns, args.column)
      await apply(
        session,
        { type: messageTypes.columnDelete, columnId: column.id },
        (state) => !state.columns.some((entry) => entry.id === column.id),
        'column to be deleted'
      )
      say(`Deleted column "${column.name}".`)
      await finishWrite(session)
    })
  })
)

const column = command(
  'column',
  summary('Add, rename, move or delete columns'),
  columnAdd,
  columnRename,
  columnMove,
  columnDelete
)

const move = command(
  'move',
  summary('Move a card to a column (to the bottom, or --top)'),
  arg('<card>', 'card number from `opencollab board`/`posts` or id prefix'),
  arg('<column>', 'column number, name or id'),
  ...boardFlags(),
  flag('--top', 'put it at the top of the column'),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const { card } = await openCard(session, flags, args.card)
      const column = findColumn(session.state.columns, args.column)
      const others = session.state.objects.filter(
        (entry) => entry.columnId === column.id && entry.id !== card.id
      )
      moveWarnings(session, card, column).forEach(warn)
      const index = flags.top ? 0 : others.length
      await apply(
        session,
        { type: messageTypes.cardMove, objectId: card.id, columnId: column.id, index },
        (state) => {
          const cards = state.objects.filter((entry) => entry.columnId === column.id)
          const at = cards.findIndex((entry) => entry.id === card.id)
          return at !== -1 && (flags.top ? at === 0 : at === cards.length - 1)
        },
        'card to be moved'
      )
      say(`Moved "${card.title}" to ${column.name}${flags.top ? ' (top)' : ''}.`)
      await quiet(session)
      await finishWrite(session)
    })
  })
)

const edit = command(
  'edit',
  summary("Change a card's title or description"),
  arg('<card>', 'card number, id prefix or title'),
  ...boardFlags(),
  flag('--title [text]', 'new title'),
  flag('--body [text]', 'new description (Markdown)'),
  action(async ({ args, flags }) => {
    if (flags.title === undefined && flags.body === undefined) {
      throw new Error('Pass --title and/or --body')
    }
    await withSession(flags, async (session) => {
      const { card } = await openCard(session, flags, args.card)
      const change = { type: messageTypes.cardUpdate, objectId: card.id }
      if (flags.title !== undefined) change.title = String(flags.title)
      if (flags.body !== undefined) {
        change.body = String(flags.body)
        change.mentions = findMentions(change.body, session.state.profiles)
      }
      await apply(
        session,
        change,
        (state) => {
          const next = state.objects.find((entry) => entry.id === card.id)
          return (
            (change.title === undefined ||
              next?.title === change.title.trim().slice(0, LIMITS.title)) &&
            (change.body === undefined || next?.body === change.body)
          )
        },
        'card to be updated'
      )
      say(`Updated "${change.title?.trim() || card.title}".`)
      await finishWrite(session)
    })
  })
)

const label = command(
  'label',
  summary('Add or remove a label on a card (creates the label if it is new)'),
  arg('<card>', 'card number, id prefix or title'),
  arg('<action>', 'add | remove'),
  arg('<name>', 'label name'),
  ...boardFlags(),
  flag('--color [hex]', 'color for a new label, e.g. #f87168'),
  action(async ({ args, flags }) => {
    const verb = String(args.action).toLowerCase()
    if (!['add', 'remove'].includes(verb)) throw new Error('Action must be add or remove')
    await withSession(flags, async (session) => {
      const { card } = await openCard(session, flags, args.card)
      const name = args.name.trim().slice(0, LIMITS.labelName)
      if (!findLabel(session, name) && verb === 'remove') {
        throw new Error(`No label "${name}" on this board`)
      }
      const existing = await ensureLabel(session, name, flags.color)
      const current = card.labelIds || []
      const labelIds =
        verb === 'add'
          ? [...new Set([...current, existing.id])]
          : current.filter((id) => id !== existing.id)
      await apply(
        session,
        { type: messageTypes.cardUpdate, objectId: card.id, labelIds },
        (state) =>
          state.objects.find((entry) => entry.id === card.id)?.labelIds.includes(existing.id) ===
          (verb === 'add'),
        'labels to be saved'
      )
      say(
        `${verb === 'add' ? 'Added' : 'Removed'} "${existing.name}" ${verb === 'add' ? 'to' : 'from'} "${card.title}".`
      )
      await finishWrite(session)
    })
  })
)

const labelsList = command(
  'labels',
  summary("List the board's labels"),
  ...boardFlags(),
  action(async ({ flags }) => {
    await withSession(flags, async (session) => {
      await openBoard(session, flags)
      const { labels, objects } = session.state
      if (!labels.length) {
        return say('No labels yet. Add one with `opencollab label <card> add <name>`.')
      }
      for (const entry of labels) {
        const used = objects.filter((card) => card.labelIds?.includes(entry.id)).length
        say(
          `${entry.color || '#8590a2'}  ${entry.name}  (${used} ${used === 1 ? 'card' : 'cards'})`
        )
      }
    })
  })
)

const due = command(
  'due',
  summary('Set or clear a due date, or list open cards by due date (no arguments)'),
  description(
    'opencollab due                      agenda: Overdue, Today, This week, Later\n' +
      'opencollab due <card> 2026-12-31    set (optionally --time HH:MM)\n' +
      'opencollab due <card> clear         clear'
  ),
  arg('[card]', 'card number, id prefix or title'),
  arg('[date]', 'YYYY-MM-DD | clear'),
  ...boardFlags(),
  flag('--time [HH:MM]', 'time of day, local; without it the card is due at the end of the day'),
  flag('--json', 'print raw JSON (agenda)'),
  action(async ({ args, flags }) => {
    if (args.card === undefined) return agenda(flags)
    if (args.date === undefined) throw new Error('Pass a date (YYYY-MM-DD) or clear')
    let dueDate = null
    if (String(args.date).toLowerCase() !== 'clear') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || Number.isNaN(Date.parse(args.date))) {
        throw new Error('Use a date like 2026-12-31, or clear')
      }
      if (flags.time && !/^\d{1,2}:\d{2}$/.test(flags.time)) {
        throw new Error('Use a time like 17:30')
      }
      dueDate = flags.time
        ? new Date(`${args.date}T${String(flags.time).padStart(5, '0')}`).toISOString()
        : args.date
    }
    await withSession(flags, async (session) => {
      const { card } = await openCard(session, flags, args.card)
      await apply(
        session,
        { type: messageTypes.cardUpdate, objectId: card.id, dueDate },
        (state) => state.objects.find((entry) => entry.id === card.id)?.dueDate === dueDate,
        'due date to be saved'
      )
      say(
        dueDate
          ? `"${card.title}" is ${dueText(dueDate)}.`
          : `Cleared the due date of "${card.title}".`
      )
      await finishWrite(session)
    })
  })
)

const archiveCommand = (archived) =>
  command(
    archived ? 'archive' : 'restore',
    summary(archived ? 'Archive a card' : 'Restore an archived card'),
    arg('<card>', 'card number, id prefix or title'),
    ...boardFlags(),
    action(async ({ args, flags }) => {
      await withSession(flags, async (session) => {
        const { card } = await openCard(session, flags, args.card)
        await apply(
          session,
          { type: messageTypes.cardArchive, objectId: card.id, archived },
          (state) => state.objects.find((entry) => entry.id === card.id)?.archived === archived,
          `card to be ${archived ? 'archived' : 'restored'}`
        )
        say(`${archived ? 'Archived' : 'Restored'} "${card.title}".`)
        await finishWrite(session)
      })
    })
  )

const describe = command(
  'describe',
  summary('Set the board description (Markdown; empty text clears it)'),
  arg('<text>', 'description'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const description = String(args.text).trim().slice(0, LIMITS.description)
      await apply(
        session,
        { type: messageTypes.boardDescribe, description },
        (state) => state.info.description === description,
        'description to be saved'
      )
      say(description ? 'Board description saved.' : 'Board description cleared.')
      await finishWrite(session)
    })
  })
)

const KIND_LABELS = {
  mention: 'mention',
  assigned: 'assigned',
  comment: 'comment',
  moved: 'moved',
  edited: 'edited',
  'new-card': 'new card',
  'due-soon': 'due soon',
  overdue: 'overdue'
}

function alertLine(alert) {
  const who = alert.authorName || shortKey(alert.author || '')
  const card = `"${alert.cardTitle}"`
  const text = {
    mention: `${who} mentioned you ${alert.where === 'comment' ? 'in a comment on' : 'on'} ${card}`,
    assigned: `${who} assigned you to ${card}`,
    comment: `${who} commented on ${card}`,
    moved: `${who} moved ${card}${alert.column ? ` to ${alert.column}` : ''}`,
    edited: `${who} edited ${card}`,
    'new-card': `${who} added ${card}`,
    'due-soon': `${card} is ${dueText(alert.due)}`,
    overdue: `${card} is ${dueText(alert.due)}`
  }[alert.kind]
  return `  ${KIND_LABELS[alert.kind].padEnd(9)} ${text}  (${relativeTime(new Date(alert.at).toISOString())})`
}

const notifications = command(
  'notifications',
  summary('Mentions, due dates and activity on your cards, across remembered boards'),
  ...commonFlags(),
  flag('--wait|-w [seconds]', 'how long to let the boards sync (default 60)'),
  action(async ({ flags }) => {
    await withSession(flags, async (session) => {
      const boards = await checkBoards(session, flags)
      if (!boards) return say('No boards yet. Use `opencollab create` or `opencollab join`.')
      let total = 0
      for (const entry of boards) {
        say('', `${entry.name || 'Board'}${entry.checkedAt ? '' : ' (not checked yet)'}`)
        if (!entry.alerts.length) say('  nothing new')
        for (const alert of entry.alerts) say(alertLine(alert))
        total += entry.alerts.length
      }
      say('', `${total} notification${total === 1 ? '' : 's'} from the last 14 days.`)
    })
  })
)

const progress = (card) =>
  `${card.checklist.filter((item) => item.done).length}/${card.checklist.length} done`

// Opens the board, runs one change on a card and syncs it.
async function onCard(flags, selector, fn) {
  await withSession(flags, async (session) => {
    const { card } = await openCard(session, flags, selector)
    await fn(session, card)
    await finishWrite(session)
  })
}

const show = command(
  'show',
  summary('Show one card: checklist, assignees, links, estimates, reactions, comments'),
  arg('<card>', 'card number, id prefix or title'),
  ...boardFlags(),
  flag('--json', 'print raw JSON'),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      await openBoard(session, flags)
      const card = findPost(session.state.objects, args.card)
      if (flags.json) return say(JSON.stringify(card, null, 2))
      const { objects, columns, publicKey } = session.state
      const titleOf = (id) => `"${cardOf(session.state, id)?.title || id}"`
      const incoming = objects.flatMap((other) =>
        (other.links || [])
          .filter((link) => link.cardId === card.id)
          .map(
            (link) => `${link.kind === 'blocks' ? 'blocked by' : 'related to'} ${titleOf(other.id)}`
          )
      )
      const votes = Object.entries(card.estimates || {})
      const people = (list) => list.map((identity) => memberName(session, identity)).join(', ')
      const reactions = (map) =>
        Object.entries(map || {})
          .filter(([, who]) => who.length)
          .map(([emoji, who]) => `${emoji} ${who.length}${who.includes(publicKey) ? '*' : ''}`)
          .join('  ')
      say(
        card.title,
        `  ${[
          columns.find((column) => column.id === card.columnId)?.name,
          card.template ? 'template' : null,
          card.archived ? 'archived' : null,
          `by ${author(session, card.author)}`,
          `updated ${relativeTime(card.updatedAt)}`,
          `id ${card.id}`
        ]
          .filter(Boolean)
          .join(' · ')}`
      )
      const details = [
        ['Labels', labelNames(session, card).join(', ')],
        ['Assigned', people(card.assignees || [])],
        ['Due', dueText(card.dueDate)],
        ['Points', typeof card.points === 'number' ? String(card.points) : ''],
        [
          'Estimates',
          !votes.length
            ? ''
            : card.revealEstimates
              ? votes
                  .map(([identity, value]) => `${memberName(session, identity)} ${value}`)
                  .join(', ')
              : `${votes.length} vote${votes.length === 1 ? '' : 's'} (${people(votes.map(([identity]) => identity))}) — hidden until revealed`
        ],
        [
          'Links',
          [
            ...(card.links || []).map(
              (link) =>
                `${link.kind === 'blocks' ? 'blocks' : 'relates to'} ${titleOf(link.cardId)}`
            ),
            ...incoming
          ].join('; ')
        ],
        ['Blocked', card.blockedBy?.length ? `by ${card.blockedBy.map(titleOf).join(', ')}` : ''],
        ['Reactions', reactions(card.reactions)]
      ].filter(([, value]) => value)
      for (const [name, value] of details) say(`  ${`${name}:`.padEnd(11)}${value}`)
      if (card.body) say('', ...card.body.split('\n').map((line) => `  ${line}`))
      if (card.checklist?.length) {
        say('', `Checklist (${progress(card)})`)
        card.checklist.forEach((item, index) =>
          say(`  ${index + 1}. [${item.done ? 'x' : ' '}] ${item.text}`)
        )
      }
      const comments = [...(card.comments || [])].sort(
        (a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
      )
      if (comments.length) say('', `Comments (${comments.length})`)
      comments.forEach((entry, index) => {
        const extra = reactions(entry.reactions)
        say(
          `  ${index + 1}. ${author(session, entry.author)}: ${entry.text}  (${relativeTime(entry.createdAt)} · id ${entry.id.slice(-8)}${extra ? ` · ${extra}` : ''})`
        )
      })
    })
  })
)

const checklistAdd = command(
  'add',
  summary("Add items to a card's checklist"),
  arg('<card>', 'card number, id prefix or title'),
  arg('<text>', 'item text, or - to read items from stdin (one per line)'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    const texts = (args.text === '-' ? await readStdin() : args.text)
      .split('\n')
      .map((text) => text.trim())
      .filter(Boolean)
    if (!texts.length) throw new Error('The item is empty')
    await onCard(flags, args.card, async (session, card) => {
      for (const text of texts) {
        const before = new Set(cardOf(session.state, card.id).checklist.map((item) => item.id))
        await apply(
          session,
          { type: messageTypes.checklistSet, objectId: card.id, text },
          (state) => cardOf(state, card.id)?.checklist.some((item) => !before.has(item.id)),
          'checklist item to be added'
        )
      }
      say(
        `Added ${texts.length === 1 ? `"${texts[0]}"` : `${texts.length} items`} to "${card.title}" (${progress(cardOf(session.state, card.id))}).`
      )
    })
  })
)

const checklistToggle = (done) =>
  command(
    done ? 'check' : 'uncheck',
    summary(done ? 'Mark a checklist item done' : 'Mark a checklist item not done'),
    arg('<card>', 'card number, id prefix or title'),
    arg('<item>', 'item number from `opencollab show`, id prefix or exact text'),
    ...boardFlags(),
    action(async ({ args, flags }) => {
      await onCard(flags, args.card, async (session, card) => {
        const item = findItem(card, args.item)
        await apply(
          session,
          { type: messageTypes.checklistSet, objectId: card.id, itemId: item.id, done },
          (state) =>
            cardOf(state, card.id)?.checklist.find((entry) => entry.id === item.id)?.done === done,
          'checklist item to be saved'
        )
        say(
          `${done ? 'Checked' : 'Unchecked'} "${item.text}" (${progress(cardOf(session.state, card.id))}).`
        )
      })
    })
  )

const checklistRename = command(
  'rename',
  summary('Rename a checklist item'),
  arg('<card>', 'card number, id prefix or title'),
  arg('<item>', 'item number, id prefix or exact text'),
  arg('<text>', 'new text'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    const text = String(args.text).trim().slice(0, LIMITS.checklistText)
    if (!text) throw new Error('The item is empty')
    await onCard(flags, args.card, async (session, card) => {
      const item = findItem(card, args.item)
      await apply(
        session,
        { type: messageTypes.checklistSet, objectId: card.id, itemId: item.id, text },
        (state) =>
          cardOf(state, card.id)?.checklist.find((entry) => entry.id === item.id)?.text === text,
        'checklist item to be renamed'
      )
      say(`Renamed "${item.text}" to "${text}".`)
    })
  })
)

const checklistRemove = command(
  'rm',
  summary('Remove a checklist item'),
  arg('<card>', 'card number, id prefix or title'),
  arg('<item>', 'item number, id prefix or exact text'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    await onCard(flags, args.card, async (session, card) => {
      const item = findItem(card, args.item)
      await apply(
        session,
        { type: messageTypes.checklistSet, objectId: card.id, itemId: item.id, deleted: true },
        (state) => !cardOf(state, card.id)?.checklist.some((entry) => entry.id === item.id),
        'checklist item to be removed'
      )
      say(`Removed "${item.text}" from "${card.title}".`)
    })
  })
)

const checklist = command(
  'checklist',
  summary('Add, check, uncheck, rename or remove checklist items'),
  checklistAdd,
  checklistToggle(true),
  checklistToggle(false),
  checklistRename,
  checklistRemove
)

const assignCommand = (on) =>
  command(
    on ? 'assign' : 'unassign',
    summary(on ? 'Assign members to a card' : 'Remove members from a card'),
    arg('<card>', 'card number, id prefix or title'),
    arg('<members>', 'display name, identity prefix or "me"; comma-separated for several'),
    ...boardFlags(),
    action(async ({ args, flags }) => {
      await onCard(flags, args.card, async (session, card) => {
        const people = findMembers(session, args.members)
        const current = card.assignees || []
        const assignees = on
          ? [...new Set([...current, ...people])]
          : current.filter((identity) => !people.includes(identity))
        if (assignees.length > LIMITS.assignees) {
          throw new Error(`A card takes at most ${LIMITS.assignees} assignees`)
        }
        await apply(
          session,
          { type: messageTypes.cardUpdate, objectId: card.id, assignees },
          (state) => {
            const next = cardOf(state, card.id)?.assignees || []
            return people.every((identity) => next.includes(identity) === on)
          },
          'assignees to be saved'
        )
        const names = people.map((identity) => memberName(session, identity)).join(', ')
        say(`${on ? 'Assigned' : 'Unassigned'} ${names} ${on ? 'to' : 'from'} "${card.title}".`)
      })
    })
  )

const assign = assignCommand(true)
const unassign = assignCommand(false)

// The worker checks each remembered board in the background, like the apps do.
// Returns its per-board alerts, or null when no board is remembered.
async function checkBoards(session, flags) {
  const secret = await password()
  const remembered = await store.readBoards(storageOf(flags), secret)
  if (!remembered.length) return null
  const seconds = Math.max(5, Number(flags.wait ?? 60) || 60)
  await session.unlock(secret)
  session.send({
    type: messageTypes.boardsWatch,
    boards: remembered.map(({ invite, name }) => ({ invite, name }))
  })
  await session
    .wait(
      (message, state) =>
        message.type === messageTypes.boardAlerts &&
        state.alerts.length > 0 &&
        state.alerts.every((entry) => entry.checkedAt > 0),
      { timeout: seconds * 1000, label: 'boards to be checked' }
    )
    .catch(() => warn(`Not every board finished syncing within ${seconds}s.`))
  return session.state.alerts
}

const mine = command(
  'mine',
  summary('Open cards assigned to you, across remembered boards'),
  ...commonFlags(),
  flag('--wait|-w [seconds]', 'how long to let the boards sync (default 60)'),
  flag('--json', 'print raw JSON'),
  action(async ({ flags }) => {
    await withSession(flags, async (session) => {
      const boards = await checkBoards(session, flags)
      if (!boards) return say('No boards yet. Use `opencollab create` or `opencollab join`.')
      if (flags.json) {
        return say(
          JSON.stringify(
            boards.map((entry) => ({ board: entry.name, cards: entry.mine || [] })),
            null,
            2
          )
        )
      }
      let total = 0
      for (const entry of boards) {
        const cards = entry.mine || []
        if (!cards.length) continue
        say('', `${entry.name || 'Board'}`)
        for (const card of cards) {
          const extras = [
            card.columnName,
            dueText(card.dueDate),
            card.blocked ? 'blocked' : null,
            card.checklist.total ? `☑ ${card.checklist.done}/${card.checklist.total}` : null,
            `id ${card.id}`
          ].filter(Boolean)
          say(`  ${card.title}  · ${extras.join(' · ')}`)
        }
        total += cards.length
      }
      say(
        total ? '' : 'Nothing assigned to you.',
        `${total} open card${total === 1 ? '' : 's'} assigned to you.`
      )
    })
  })
)

const reactCommand = (on) =>
  command(
    on ? 'react' : 'unreact',
    summary(on ? 'React to a card or comment' : 'Remove your reaction'),
    arg('<card>', 'card number, id prefix or title'),
    arg('<emoji>', `${REACTIONS.join(' ')} or a name: ${Object.keys(EMOJI_NAMES).join(', ')}`),
    ...boardFlags(),
    flag('--comment|-c [comment]', 'comment number from `opencollab show` or id'),
    action(async ({ args, flags }) => {
      const emoji = reactionOf(args.emoji)
      await onCard(flags, args.card, async (session, card) => {
        const target = flags.comment ? findComment(card, flags.comment) : null
        const reactionsOf = (state) => {
          const next = cardOf(state, card.id)
          const holder = target ? next?.comments.find((entry) => entry.id === target.id) : next
          return holder?.reactions?.[emoji] || []
        }
        await apply(
          session,
          {
            type: messageTypes.reactionSet,
            objectId: card.id,
            ...(target && { commentId: target.id }),
            emoji,
            on
          },
          (state) => reactionsOf(state).includes(state.publicKey) === on,
          'reaction to be saved'
        )
        const what = target ? 'the comment' : `"${card.title}"`
        say(on ? `Reacted ${emoji} to ${what}.` : `Removed ${emoji} from ${what}.`)
      })
    })
  )

const react = reactCommand(true)
const unreact = reactCommand(false)

function activityText(entry, subject) {
  const on = subject ? ` ${subject}` : ''
  switch (entry.kind) {
    case 'created':
      return `created${on} ${entry.detail}`
    case 'moved':
      return `moved${on} to ${entry.detail}`
    case 'commented':
      return `commented${subject ? ` on ${subject}` : ''}: ${entry.detail}`
    case 'edited':
      return subject ? `edited ${subject}: ${entry.detail}` : entry.detail
    case 'checklist':
      return `checklist${subject ? ` of ${subject}` : ''}: ${entry.detail}`
    case 'linked':
      return `linked${on}: ${entry.detail}`
    case 'attached':
      return `added an attachment${subject ? ` to ${subject}` : ''}`
    case 'estimated':
      return `voted on the estimate${subject ? ` of ${subject}` : ''}`
    default:
      return `${entry.kind}${on}${entry.detail ? `: ${entry.detail}` : ''}`
  }
}

const activity = command(
  'activity',
  summary('What happened on the board, or on one card, newest first'),
  arg('[card]', 'card number or id prefix (default: the whole board)'),
  ...boardFlags(),
  flag('--limit|-n [count]', 'how many entries (default 30)'),
  flag('--json', 'print raw JSON'),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const { boardName } = await openBoard(session, flags)
      const card = args.card === undefined ? null : findPost(session.state.objects, args.card)
      const limit = Math.max(1, Math.min(500, Number(flags.limit ?? 30) || 30))
      const { entries } = await request(
        session,
        { type: messageTypes.activityGet, cardId: card?.id ?? null, limit },
        messageTypes.boardActivity,
        'activity'
      )
      if (flags.json) return say(JSON.stringify(entries, null, 2))
      say(`${card ? `"${card.title}"` : boardName} · activity`, '')
      if (!entries.length) say('Nothing yet.')
      for (const entry of entries) {
        const who = entry.authorName || shortKey(entry.author)
        say(
          `  ${relativeTime(entry.at).padEnd(9)} ${who}: ${activityText(entry, card ? '' : `"${entry.cardTitle}"`)}`
        )
      }
    })
  })
)

const wip = command(
  'wip',
  summary('Set or clear the work-in-progress limit of a column'),
  arg('<column>', 'column number, name or id'),
  arg('<limit>', `1-${LIMITS.wipLimit} | off`),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    const off = String(args.limit).toLowerCase() === 'off'
    const wipLimit = off ? null : Number(args.limit)
    if (!off && !(Number.isInteger(wipLimit) && wipLimit >= 1 && wipLimit <= LIMITS.wipLimit)) {
      throw new Error(`Use a limit from 1 to ${LIMITS.wipLimit}, or off`)
    }
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const column = findColumn(session.state.columns, args.column)
      await apply(
        session,
        { type: messageTypes.columnUpdate, columnId: column.id, wipLimit },
        (state) =>
          (state.columns.find((entry) => entry.id === column.id)?.wipLimit ?? null) === wipLimit,
        'WIP limit to be saved'
      )
      say(
        off ? `Removed the WIP limit of ${column.name}.` : `${column.name}: WIP limit ${wipLimit}.`
      )
      await finishWrite(session)
    })
  })
)

const SORTS = {
  column: null,
  due: (a, b) =>
    (deadlineOf(a.dueDate)?.getTime() ?? Infinity) - (deadlineOf(b.dueDate)?.getTime() ?? Infinity),
  updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
  points: (a, b) => (b.points ?? -1) - (a.points ?? -1),
  title: (a, b) => a.title.localeCompare(b.title)
}

const cards = command(
  'cards',
  summary('All cards as a table, sortable and filterable'),
  ...boardFlags(),
  flag('--sort [key]', `${Object.keys(SORTS).join(' | ')} (default column)`),
  flag('--assignee [member]', 'only cards assigned to this member ("me" works)'),
  flag('--label [name]', 'only cards with this label'),
  flag('--column [column]', 'only cards in this column'),
  flag('--archived|-a', 'include archived cards'),
  flag('--json', 'print raw JSON'),
  action(async ({ flags }) => {
    const sort = String(flags.sort || 'column').toLowerCase()
    if (!(sort in SORTS)) throw new Error(`Sort by ${Object.keys(SORTS).join(', ')}`)
    await withSession(flags, async (session) => {
      const { boardName } = await openBoard(session, flags)
      const { objects, columns } = session.state
      const numbers = new Map(newestFirst(objects).map((post, index) => [post.id, index + 1]))
      const assignee = flags.assignee ? findMember(session, flags.assignee) : null
      const labelId = flags.label ? findLabel(session, flags.label)?.id || '' : null
      const column = flags.column ? findColumn(columns, flags.column) : null
      const order = new Map(columns.map((entry, index) => [entry.id, index]))
      // objects arrive in board order, so a stable sort keeps positions within a column.
      const list = objects
        .filter(
          (card) =>
            !card.template &&
            (flags.archived || !card.archived) &&
            (!assignee || card.assignees?.includes(assignee)) &&
            (labelId === null || card.labelIds?.includes(labelId)) &&
            (!column || card.columnId === column.id)
        )
        .sort((a, b) => (order.get(a.columnId) ?? 0) - (order.get(b.columnId) ?? 0))
        .sort(SORTS[sort] || (() => 0))
      if (flags.json) return say(JSON.stringify({ board: boardName, cards: list }, null, 2))
      say(`${boardName} · ${list.length} cards`, '')
      if (!list.length) return say('No matching cards.')
      table(
        ['#', 'Title', 'Column', 'Assignees', 'Due', 'Pts', 'Labels', 'Updated', 'Flags'],
        list.map((card) => {
          const age = daysSince(card.updatedAt)
          const deadline = deadlineOf(card.dueDate)
          return [
            `#${numbers.get(card.id)}`,
            clip(card.title, 40),
            clip(columns.find((entry) => entry.id === card.columnId)?.name || '', 16),
            clip((card.assignees || []).map((id) => memberName(session, id)).join(', '), 24),
            card.dueDate
              ? `${card.dueDate.slice(0, 10)}${deadline && deadline < Date.now() && isOpen(session, card) ? ' !' : ''}`
              : '',
            typeof card.points === 'number' ? String(card.points) : '',
            clip(labelNames(session, card).join(', '), 20),
            card.updatedAt ? relativeTime(card.updatedAt) : '',
            [
              card.blockedBy?.length ? 'blocked' : '',
              isOpen(session, card) && age >= STALE_DAYS ? 'stale' : '',
              card.archived ? 'archived' : ''
            ]
              .filter(Boolean)
              .join(' ')
          ]
        })
      )
    })
  })
)

// `opencollab due` without arguments: open cards by deadline.
async function agenda(flags) {
  await withSession(flags, async (session) => {
    const { boardName } = await openBoard(session, flags)
    const numbers = new Map(
      newestFirst(session.state.objects).map((post, index) => [post.id, index + 1])
    )
    const { noDate: undated, ...buckets } = agendaGroups(session)
    const headings = { overdue: 'Overdue', today: 'Today', thisWeek: 'This week', later: 'Later' }
    const groups = Object.fromEntries(
      Object.entries(buckets).map(([key, list]) => [headings[key], list])
    )
    if (flags.json) {
      const plain = Object.fromEntries(
        Object.entries(groups).map(([name, list]) => [name, list.map(({ card }) => card)])
      )
      return say(JSON.stringify({ board: boardName, ...plain, noDate: undated }, null, 2))
    }
    say(`${boardName} · due dates`)
    for (const [name, list] of Object.entries(groups)) {
      if (!list.length) continue
      say('', `## ${name} (${list.length})`)
      for (const { card } of list) {
        const column = session.state.columns.find((entry) => entry.id === card.columnId)
        const extras = [column?.name, ...cardBadges(session, card)].filter(Boolean)
        say(
          `  ${dueWhen(card.dueDate).padEnd(10)}  #${numbers.get(card.id)}  ${card.title}  · ${extras.join(' · ')}`
        )
      }
    }
    say('', `${undated} open card${undated === 1 ? '' : 's'} without a due date.`)
  })
}

const LINK_KINDS = ['blocks', 'relates']

const link = command(
  'link',
  summary('Link two cards: <card> blocks <other>, or <card> relates <other>'),
  arg('<card>', 'card number, id prefix or title'),
  arg('<kind>', 'blocks | relates'),
  arg('<other>', 'card number, id prefix or title'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    const kind = String(args.kind).toLowerCase()
    if (!LINK_KINDS.includes(kind)) throw new Error('Kind must be blocks or relates')
    await onCard(flags, args.card, async (session, card) => {
      const target = findPost(session.state.objects, args.other)
      if (target.id === card.id) throw new Error('A card cannot link to itself')
      await apply(
        session,
        { type: messageTypes.linkSet, objectId: card.id, targetId: target.id, kind, linked: true },
        (state) =>
          cardOf(state, card.id)?.links.some(
            (entry) => entry.cardId === target.id && entry.kind === kind
          ),
        'link to be saved'
      )
      say(`"${card.title}" ${kind === 'blocks' ? 'blocks' : 'relates to'} "${target.title}".`)
    })
  })
)

const unlink = command(
  'unlink',
  summary('Remove the links from one card to another'),
  arg('<card>', 'card number, id prefix or title'),
  arg('<other>', 'card number, id prefix or title'),
  ...boardFlags(),
  flag('--kind [kind]', 'only this kind: blocks | relates'),
  action(async ({ args, flags }) => {
    await onCard(flags, args.card, async (session, card) => {
      const target = findPost(session.state.objects, args.other)
      const kinds = (card.links || [])
        .filter((entry) => entry.cardId === target.id)
        .map((entry) => entry.kind)
        .filter((kind) => !flags.kind || kind === String(flags.kind).toLowerCase())
      if (!kinds.length) throw new Error(`"${card.title}" has no such link to "${target.title}"`)
      for (const kind of kinds) {
        await apply(
          session,
          {
            type: messageTypes.linkSet,
            objectId: card.id,
            targetId: target.id,
            kind,
            linked: false
          },
          (state) =>
            !cardOf(state, card.id)?.links.some(
              (entry) => entry.cardId === target.id && entry.kind === kind
            ),
          'link to be removed'
        )
      }
      say(`Unlinked "${card.title}" from "${target.title}".`)
    })
  })
)

const pointsValue = (value, clear) => {
  if (String(value).toLowerCase() === clear) return null
  const number = Number(value)
  if (!(Number.isFinite(number) && number >= 0 && number <= LIMITS.points)) {
    throw new Error(`Use a number from 0 to ${LIMITS.points}, or ${clear}`)
  }
  return number
}

const estimate = command(
  'estimate',
  summary('Cast your planning-poker vote on a card (hidden until revealed)'),
  arg('<card>', 'card number, id prefix or title'),
  arg('<points>', 'e.g. 0 1 2 3 5 8 13 21, or clear'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    const value = pointsValue(args.points, 'clear')
    await onCard(flags, args.card, async (session, card) => {
      await apply(
        session,
        { type: messageTypes.estimateSet, objectId: card.id, value },
        (state) => (cardOf(state, card.id)?.estimates?.[state.publicKey] ?? null) === value,
        'estimate to be saved'
      )
      const votes = Object.keys(cardOf(session.state, card.id).estimates || {}).length
      say(
        value === null
          ? `Withdrew your estimate on "${card.title}".`
          : `Voted ${value} on "${card.title}" (${votes} vote${votes === 1 ? '' : 's'} so far).`
      )
    })
  })
)

const reveal = command(
  'reveal',
  summary("Reveal everyone's estimates on a card"),
  arg('<card>', 'card number, id prefix or title'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    await onCard(flags, args.card, async (session, card) => {
      await apply(
        session,
        { type: messageTypes.cardUpdate, objectId: card.id, revealEstimates: true },
        (state) => cardOf(state, card.id)?.revealEstimates === true,
        'estimates to be revealed'
      )
      const votes = Object.entries(cardOf(session.state, card.id).estimates || {})
      if (!votes.length) return say(`No estimates on "${card.title}" yet.`)
      say(
        `Estimates on "${card.title}":`,
        ...votes.map(([identity, value]) => `  ${memberName(session, identity)}: ${value}`),
        `Agree on one with \`opencollab points ${card.id.slice(0, 8)} <n>\`.`
      )
    })
  })
)

const points = command(
  'points',
  summary("Set or clear a card's agreed story points"),
  arg('<card>', 'card number, id prefix or title'),
  arg('<points>', `0-${LIMITS.points} | off`),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    const value = pointsValue(args.points, 'off')
    await onCard(flags, args.card, async (session, card) => {
      await apply(
        session,
        { type: messageTypes.cardUpdate, objectId: card.id, points: value },
        (state) => (cardOf(state, card.id)?.points ?? null) === value,
        'points to be saved'
      )
      say(
        value === null ? `Cleared the points of "${card.title}".` : `"${card.title}": ${value} pts.`
      )
    })
  })
)

const stats = command(
  'stats',
  summary('Throughput, cycle time and load per column and member'),
  ...boardFlags(),
  flag('--json', 'print raw JSON'),
  action(async ({ flags }) => {
    await withSession(flags, async (session) => {
      const { boardName } = await openBoard(session, flags)
      const { stats: data } = await request(
        session,
        { type: messageTypes.statsGet },
        messageTypes.boardStats,
        'stats'
      )
      if (flags.json) return say(JSON.stringify(data, null, 2))
      const { totals, cycleTime } = data
      say(
        `${boardName} · stats`,
        '',
        `Open ${totals.open} · done ${totals.done} · archived ${totals.archived} · overdue ${totals.overdue} · blocked ${totals.blocked}`,
        `Points: ${totals.pointsOpen} open, ${totals.pointsDone} done`,
        '',
        'Done per week (created in parentheses)'
      )
      const most = Math.max(1, ...data.weeks.map((week) => week.done))
      for (const week of data.weeks) {
        const label = new Date(week.start).toLocaleDateString('en', {
          month: 'short',
          day: '2-digit'
        })
        const bar = '█'.repeat(Math.round((week.done / most) * 30))
        say(`  ${label}  ${bar}${bar ? ' ' : ''}${week.done}  (${week.created})`)
      }
      say(
        '',
        cycleTime.count
          ? `Cycle time: median ${formatDuration(cycleTime.median)} · p85 ${formatDuration(cycleTime.p85)} (${cycleTime.count} card${cycleTime.count === 1 ? '' : 's'})`
          : 'Cycle time: no finished cards yet',
        '',
        'Columns'
      )
      const width = Math.max(...data.columns.map((column) => column.name.length))
      for (const column of data.columns) {
        const count = column.wipLimit ? `${column.count}/${column.wipLimit}` : `${column.count}`
        const over = column.wipLimit && column.count > column.wipLimit ? '  over WIP limit' : ''
        say(
          `  ${column.name.padEnd(width)}  ${count.padStart(5)} cards${column.points ? ` · ${column.points} pts` : ''}${over}`
        )
      }
      if (data.members.length) say('', 'Members (assigned cards)')
      for (const member of data.members) {
        say(
          `  ${member.name || shortKey(member.identity)}: ${member.open} open · ${member.doneThisWeek} done this week`
        )
      }
    })
  })
)

function findRule(rules, selector) {
  const value = String(selector)
  const index = Number(value)
  if (Number.isInteger(index) && index >= 1 && index <= rules.length) return rules[index - 1]
  const matches = rules.filter(
    (rule) =>
      rule.id === value ||
      rule.id.startsWith(value) ||
      rule.id.slice(5).startsWith(value) ||
      rule.name.toLowerCase() === value.toLowerCase()
  )
  if (matches.length === 1) return matches[0]
  throw new Error(matches.length ? `"${selector}" matches several rules` : `No rule "${selector}"`)
}

function ruleText(session, rule) {
  const columnName = (id) => session.state.columns.find((column) => column.id === id)?.name || '?'
  const { trigger, actions } = rule
  const when =
    trigger.kind === 'enter'
      ? `when a card enters ${columnName(trigger.columnId)}`
      : trigger.kind === 'create'
        ? `when a card is created${trigger.columnId ? ` in ${columnName(trigger.columnId)}` : ''}`
        : `every ${trigger.every}: create "${rule.card?.title}"${trigger.columnId ? ` in ${columnName(trigger.columnId)}` : ''}`
  const labels = actions.labelIds
    .map((id) => session.state.labels.find((entry) => entry.id === id)?.name)
    .filter(Boolean)
  const steps = [
    labels.length ? `label ${labels.join(', ')}` : null,
    actions.assignees.length
      ? `assign ${actions.assignees.map((id) => memberName(session, id)).join(', ')}`
      : null,
    actions.assignActor ? 'assign whoever moved it' : null,
    actions.dueInDays !== null ? `due in ${actions.dueInDays}d` : null,
    actions.completeChecklist ? 'complete the checklist' : null,
    actions.archive ? 'archive' : null
  ].filter(Boolean)
  return `${when}${steps.length ? ` → ${steps.join(', ')}` : ''}`
}

const rulesList = command(
  'list',
  summary("List the board's automation rules"),
  ...boardFlags(),
  flag('--json', 'print raw JSON'),
  action(async ({ flags }) => {
    await withSession(flags, async (session) => {
      await openBoard(session, flags)
      const { rules } = session.state
      if (flags.json) return say(JSON.stringify(rules, null, 2))
      if (!rules.length) return say('No rules yet. Add one with `opencollab rules add`.')
      rules.forEach((rule, index) => {
        say(
          `${index + 1}. [${rule.enabled ? 'on' : 'off'}] ${rule.name || 'Unnamed rule'}  · id ${rule.id}`,
          `   ${ruleText(session, rule)}`
        )
      })
    })
  })
)

const rulesAdd = command(
  'add',
  summary('Add an automation rule'),
  description(
    'Examples:\n' +
      '  opencollab rules add "Review" --when enter --column Review --assign Alice\n' +
      '  opencollab rules add "Bugs" --when create --label bug --due-in 3\n' +
      '  opencollab rules add "Done" --when enter --column Done --complete-checklist\n' +
      '  opencollab rules add "Standup" --when schedule --every day --title "Standup notes" --item Yesterday --item Today'
  ),
  arg('<name>', 'rule name'),
  ...boardFlags(),
  flag('--when [trigger]', 'enter | create | schedule'),
  flag('--column [column]', 'enter: the column (required); create/schedule: optional'),
  flag('--every [period]', 'schedule: day | week | month'),
  flag('--title [text]', 'schedule: title of the card it creates (default: the rule name)'),
  flag('--body [text]', 'schedule: description of the card it creates'),
  flag('--item [text]', 'schedule: checklist item of the card it creates (repeatable)').multiple(),
  flag('--label [name]', 'add this label (repeatable; created if new)').multiple(),
  flag('--assign [member]', 'assign this member (repeatable)').multiple(),
  flag('--assign-actor', 'assign whoever triggered the rule'),
  flag('--due-in [days]', 'set the due date this many days ahead (0-365)'),
  flag('--complete-checklist', 'check every checklist item'),
  flag('--archive', 'archive the card'),
  flag('--disabled', 'add the rule switched off'),
  action(async ({ args, flags }) => {
    const kind = String(flags.when || '').toLowerCase()
    if (!['enter', 'create', 'schedule'].includes(kind)) {
      throw new Error('Pass --when enter, create or schedule')
    }
    if (kind === 'enter' && !flags.column) throw new Error('--when enter needs --column')
    const every = String(flags.every || '').toLowerCase()
    if (kind === 'schedule' && !['day', 'week', 'month'].includes(every)) {
      throw new Error('--when schedule needs --every day, week or month')
    }
    const dueInDays = flags.dueIn === undefined ? null : Number(flags.dueIn)
    if (
      dueInDays !== null &&
      !(Number.isInteger(dueInDays) && dueInDays >= 0 && dueInDays <= 365)
    ) {
      throw new Error('--due-in takes 0 to 365 days')
    }
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const columnId = flags.column ? findColumn(session.state.columns, flags.column).id : null
      const assignees = findMembers(session, flags.assign)
      const labelIds = []
      for (const name of [].concat(flags.label || [])) {
        labelIds.push((await ensureLabel(session, name)).id)
      }
      const rule = {
        name: args.name,
        enabled: !flags.disabled,
        trigger: kind === 'schedule' ? { kind, every, columnId } : { kind, columnId },
        actions: {
          labelIds,
          assignees,
          assignActor: !!flags.assignActor,
          dueInDays,
          completeChecklist: !!flags.completeChecklist,
          archive: !!flags.archive
        },
        ...(kind === 'schedule' && {
          card: {
            title: flags.title || args.name,
            body: flags.body || '',
            checklist: [].concat(flags.item || [])
          }
        })
      }
      const before = new Set(session.state.rules.map((entry) => entry.id))
      await apply(
        session,
        { type: messageTypes.ruleUpsert, rule },
        (state) => state.rules.some((entry) => !before.has(entry.id)),
        'rule to be saved'
      )
      const added = session.state.rules.find((entry) => !before.has(entry.id))
      // A schedule rule creates its first card right away.
      if (kind === 'schedule') await quiet(session)
      say(`Added rule "${added.name}": ${ruleText(session, added)}.`)
      await finishWrite(session)
    })
  })
)

const ruleToggle = (enabled) =>
  command(
    enabled ? 'enable' : 'disable',
    summary(enabled ? 'Switch a rule on' : 'Switch a rule off'),
    arg('<rule>', 'rule number from `opencollab rules list`, id or name'),
    ...boardFlags(),
    action(async ({ args, flags }) => {
      await withSession(flags, async (session) => {
        const { room } = await openBoard(session, flags)
        assertWritable(session, room)
        const { id, ...rule } = findRule(session.state.rules, args.rule)
        await apply(
          session,
          { type: messageTypes.ruleUpsert, ruleId: id, rule: { ...rule, enabled } },
          (state) => state.rules.find((entry) => entry.id === id)?.enabled === enabled,
          'rule to be saved'
        )
        say(`Rule "${rule.name}" is ${enabled ? 'on' : 'off'}.`)
        await finishWrite(session)
      })
    })
  )

const rulesRemove = command(
  'rm',
  summary('Delete a rule'),
  arg('<rule>', 'rule number, id or name'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const rule = findRule(session.state.rules, args.rule)
      await apply(
        session,
        { type: messageTypes.ruleDelete, ruleId: rule.id },
        (state) => !state.rules.some((entry) => entry.id === rule.id),
        'rule to be deleted'
      )
      say(`Deleted rule "${rule.name}".`)
      await finishWrite(session)
    })
  })
)

const rules = command(
  'rules',
  summary('List, add, enable, disable or delete automation rules'),
  rulesList,
  rulesAdd,
  ruleToggle(true),
  ruleToggle(false),
  rulesRemove
)

const BOARD_TEMPLATE_NAMES = ['sprint', 'bugs', 'personal']

const templateApply = command(
  'apply',
  summary('Set up the board from a template: renames/adds columns and adds labels'),
  arg('<template>', BOARD_TEMPLATE_NAMES.join(' | ')),
  ...boardFlags(),
  flag('--yes|-y', 'confirm: existing columns are renamed and empty extra columns deleted'),
  action(async ({ args, flags }) => {
    const template = String(args.template).toLowerCase()
    if (!BOARD_TEMPLATE_NAMES.includes(template)) {
      throw new Error(`Template must be ${BOARD_TEMPLATE_NAMES.join(', ')}`)
    }
    if (!flags.yes) {
      throw new Error(
        'This renames the existing columns (and deletes empty extra ones). Pass --yes to go ahead.'
      )
    }
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const message = { type: messageTypes.templateApply, template }
      session.send(message)
      // No reply when the board already matches; otherwise wait for every op.
      await session
        .wait((reply) => refused(reply, message) || reply.type === messageTypes.boardState, {
          timeout: 5000,
          label: 'template'
        })
        .catch((err) => {
          if (!/Timed out/.test(err.message)) throw err
        })
      await quiet(session)
      say(
        `Applied the ${template} template. Columns: ${session.state.columns.map((column) => column.name).join(', ')}.`
      )
      await finishWrite(session)
    })
  })
)

const templateMark = (template) =>
  command(
    template ? 'mark' : 'unmark',
    summary(template ? 'Make a card a template' : 'Turn a template back into a normal card'),
    arg('<card>', 'card number, id prefix or title'),
    ...boardFlags(),
    action(async ({ args, flags }) => {
      await onCard(flags, args.card, async (session, card) => {
        await apply(
          session,
          { type: messageTypes.cardUpdate, objectId: card.id, template },
          (state) => cardOf(state, card.id)?.template === template,
          'template flag to be saved'
        )
        say(
          template
            ? `"${card.title}" is a template. Use it with \`opencollab add --from-template ${card.id.slice(0, 8)}\`.`
            : `"${card.title}" is a normal card again.`
        )
      })
    })
  )

const templateList = command(
  'list',
  summary('List card templates'),
  ...boardFlags(),
  action(async ({ flags }) => {
    await withSession(flags, async (session) => {
      await openBoard(session, flags)
      const numbers = new Map(
        newestFirst(session.state.objects).map((post, index) => [post.id, index + 1])
      )
      const list = session.state.objects.filter((card) => card.template && !card.archived)
      if (!list.length) {
        return say('No card templates. Make one with `opencollab template mark <card>`.')
      }
      for (const card of list) {
        const extras = [
          card.checklist?.length ? `${card.checklist.length} checklist items` : null,
          labelNames(session, card).length ? `[${labelNames(session, card).join(', ')}]` : null
        ].filter(Boolean)
        say(
          `#${numbers.get(card.id)}  ${card.title}${extras.length ? `  · ${extras.join(' · ')}` : ''}  · id ${card.id}`
        )
      }
    })
  })
)

const template = command(
  'template',
  summary('Board templates (apply) and card templates (mark, unmark, list)'),
  templateApply,
  templateMark(true),
  templateMark(false),
  templateList
)

const add = command(
  'add',
  summary('Add a card to a column (quick capture: `echo "title" | opencollab add -`)'),
  arg('<title>', 'card title, or - to read titles from stdin (one card per line)'),
  ...boardFlags(),
  flag('--column|-c [column]', 'column number, name or id (default: the first column)'),
  flag('--body [text]', 'description (Markdown)'),
  flag('--assign [member]', 'assign a member, "me" works (repeatable)').multiple(),
  flag('--item [text]', 'checklist item (repeatable)').multiple(),
  flag('--due [YYYY-MM-DD]', 'due date'),
  flag('--from-template|-t [card]', 'copy a template card (checklist, labels, assignees, points)'),
  action(async ({ args, flags }) => {
    const titles = (args.title === '-' ? await readStdin() : args.title)
      .split('\n')
      .map((title) => title.trim().slice(0, LIMITS.title))
      .filter(Boolean)
    if (!titles.length) throw new Error('The title is empty')
    if (
      flags.due &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(flags.due) || Number.isNaN(Date.parse(flags.due)))
    ) {
      throw new Error('Use a due date like 2026-12-31')
    }
    if (flags.fromTemplate && (flags.body || flags.assign || flags.item || flags.due)) {
      throw new Error('--from-template takes the rest from the template; only --column applies')
    }
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const column = flags.column ? findColumn(session.state.columns, flags.column) : null
      if (flags.fromTemplate) {
        const source = findPost(session.state.objects, flags.fromTemplate)
        if (!source.template) {
          warn(`"${source.title}" is not marked as a template; copying it anyway.`)
        }
        for (const title of titles) {
          const { objectId } = await request(
            session,
            {
              type: messageTypes.cardFromTemplate,
              templateId: source.id,
              title,
              ...(column && { columnId: column.id })
            },
            'card-created',
            'card to be created'
          )
          // The reply can arrive before the board-state that carries the card.
          if (!cardOf(session.state, objectId)) {
            await session.wait(
              (reply, state) => reply.type === messageTypes.boardState && cardOf(state, objectId),
              { label: 'card to be saved' }
            )
          }
        }
      } else {
        const assignees = findMembers(session, flags.assign)
        const startedAt = Date.now()
        for (const title of titles) {
          session.send({
            type: messageTypes.boardCreate,
            title,
            body: flags.body || '',
            mentions: findMentions(flags.body, session.state.profiles),
            ...(column && { columnId: column.id }),
            ...(assignees.length && { assignees }),
            ...(flags.item && { checklist: [].concat(flags.item) }),
            ...(flags.due && { dueDate: flags.due })
          })
        }
        await session.wait(
          (reply, state) =>
            reply.type === messageTypes.boardState &&
            titles.every((title) =>
              state.objects.some(
                (object) =>
                  object.author === state.publicKey &&
                  object.title === title &&
                  Date.parse(object.createdAt) >= startedAt - 1000
              )
            ),
          { label: 'cards to be saved' }
        )
      }
      await quiet(session)
      const where = column?.name || session.state.columns[0]?.name
      say(
        titles.length === 1
          ? `Added "${titles[0]}"${where && !flags.fromTemplate ? ` to ${where}` : ''}.`
          : `Added ${titles.length} cards${where && !flags.fromTemplate ? ` to ${where}` : ''}.`
      )
      await finishWrite(session)
    })
  })
)

const mcp = command(
  'mcp',
  summary('Run an MCP server so AI clients can work on a board'),
  description(
    'Serves the board to any Model Context Protocol client (Claude, ChatGPT, Cursor,\n' +
      'local agents) as a member with this identity. It opens the board once and stays\n' +
      'online. Speaks stdio by default; --port serves Streamable HTTP at /mcp, guarded by\n' +
      'a bearer token (OPENCOLLAB_MCP_TOKEN, or a random one printed at start).\n' +
      'Needs OPENCOLLAB_PASSWORD. Stop with Ctrl+C.'
  ),
  ...commonFlags(),
  flag('--board|-b [board]', 'board name or number from `opencollab boards` (default: latest)'),
  flag('--port|-p [port]', 'serve Streamable HTTP on this port instead of stdio'),
  flag('--host [host]', 'HTTP address to listen on (default 127.0.0.1)'),
  flag('--read-only', 'only reading tools: no cards, comments or other changes'),
  flag('--allow-archive', 'also offer the archive_card tool'),
  action(async ({ flags }) => {
    await require('./lib/mcp').serve(flags, { storage: storageOf(flags) })
  })
)

const cli = command(
  'opencollab',
  header('OpenCollab — private peer-to-peer boards'),
  summary('Command-line client sharing the desktop and mobile backend'),
  footer(
    'Set OPENCOLLAB_PASSWORD to skip the password prompt (e.g. on servers).\n' +
      'Invitations and the identity are stored encrypted in the storage directory.'
  ),
  identity,
  boards,
  create,
  join,
  forget,
  invite,
  name,
  avatar,
  board,
  cards,
  show,
  posts,
  post,
  add,
  comment,
  vote,
  react,
  unreact,
  column,
  wip,
  move,
  edit,
  label,
  labelsList,
  due,
  checklist,
  assign,
  unassign,
  link,
  unlink,
  estimate,
  reveal,
  points,
  archiveCommand(true),
  archiveCommand(false),
  template,
  rules,
  describe,
  activity,
  stats,
  mine,
  notifications,
  images,
  watch,
  mcp,
  update,
  version
)

module.exports = { cli }
