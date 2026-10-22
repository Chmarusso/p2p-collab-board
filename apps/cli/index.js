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
const { messageTypes, normalizeInvite, inviteLink, LIMITS } = require('@opencollab/board-protocol')
const { Session } = require('./lib/session')
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
const shortKey = (key = '') => (key.length > 10 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key)
const say = (...lines) => console.log(lines.join('\n'))
const warn = (text) => console.error(`! ${text}`)

function relativeTime(iso) {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso || '')) / 1000)
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

function selectBoard(boards, selector) {
  if (!boards.length) {
    throw new Error('No boards yet. Use `opencollab create` or `opencollab join`.')
  }
  if (!selector) return boards[0]
  const index = Number(selector)
  if (Number.isInteger(index) && index >= 1 && index <= boards.length) return boards[index - 1]
  const match = boards.find((board) => board.name.toLowerCase() === String(selector).toLowerCase())
  if (!match) throw new Error(`No remembered board "${selector}". See \`opencollab boards\`.`)
  return match
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

const newestFirst = (objects) =>
  [...objects].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))

function findPost(objects, selector) {
  const posts = newestFirst(objects)
  const value = String(selector).replace(/^#/, '')
  const index = Number(value)
  if (Number.isInteger(index) && index >= 1 && index <= posts.length) return posts[index - 1]
  const matches = posts.filter((post) => post.id.startsWith(value))
  if (matches.length === 1) return matches[0]
  throw new Error(matches.length ? `"${selector}" matches several posts` : `No post "${selector}"`)
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
    post.images?.length ? `${post.images.length} image${post.images.length === 1 ? '' : 's'}` : null
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

const labelNames = (session, post) =>
  (post.labelIds || [])
    .map((id) => session.state.labels.find((label) => label.id === id)?.name)
    .filter(Boolean)

// Date-only due dates are due at the end of that day, local time.
function dueText(dueDate) {
  if (!dueDate) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
  const [year, month, day] = dueDate.split('-').map(Number)
  const deadline = dateOnly ? new Date(year, month - 1, day, 23, 59, 59) : new Date(dueDate)
  if (Number.isNaN(deadline.getTime())) return null
  const left = deadline - Date.now()
  const when = dateOnly ? dueDate : deadline.toLocaleString()
  return left < 0 ? `overdue ${when}` : left < 86400000 ? `due soon ${when}` : `due ${when}`
}

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
const newLabelId = () => `label:${require('crypto').randomBytes(6).toString('hex')}`

// Sends `message`, then waits for a board-state where `check(state)` holds.
async function apply(session, message, check, label) {
  session.send(message)
  await session.wait((reply, state) => reply.type === messageTypes.boardState && check(state), {
    label
  })
}

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
  arg('<name>', 'board name'),
  ...commonFlags(),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const storage = storageOf(flags)
      const secret = await password()
      await session.unlock(secret)
      const room = await session.openBoard(null, args.name)
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
  arg('<text>', 'comment text'),
  ...boardFlags(),
  action(async ({ args, flags }) => {
    await withSession(flags, async (session) => {
      const { room } = await openBoard(session, flags)
      assertWritable(session, room)
      const target = findPost(session.state.objects, args.post)
      session.send({ type: messageTypes.boardComment, objectId: target.id, text: args.text })
      await session.wait(
        (message, state) =>
          message.type === messageTypes.boardState &&
          state.objects
            .find((object) => object.id === target.id)
            ?.comments?.some(
              (entry) => entry.author === state.publicKey && entry.text === args.text.trim()
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
  summary("Download a post's images"),
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
        const file = path.join(out, `${target.id}-${index + 1}${extensions[ref.type] || ''}`)
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
      const { columns, objects, labels, theme, info, profiles } = session.state
      if (flags.json) {
        return say(
          JSON.stringify(
            { board: boardName, info, theme, columns, labels, profiles, cards: objects },
            null,
            2
          )
        )
      }
      // Card numbers match `opencollab posts`, so either list can be used to pick one.
      const numbers = new Map(newestFirst(objects).map((post, index) => [post.id, index + 1]))
      say(`${boardName} · ${objects.length} cards · ${session.state.peers} peers`)
      if (info.description) say(...info.description.split('\n').map((line) => `  ${line}`))
      for (const column of columns) {
        const cards = objects.filter(
          (card) => card.columnId === column.id && (flags.archived || !card.archived)
        )
        say('', `## ${column.name} (${cards.length})`)
        for (const card of cards) {
          const extras = [
            labelNames(session, card).length ? `[${labelNames(session, card).join(', ')}]` : null,
            dueText(card.dueDate),
            Object.keys(card.votes || {}).length
              ? `▲ ${Object.values(card.votes).reduce((sum, vote) => sum + vote, 0)}`
              : null,
            card.comments?.length ? `${card.comments.length} comments` : null,
            card.archived ? 'archived' : null
          ].filter(Boolean)
          say(
            `  #${numbers.get(card.id)}  ${card.title}${extras.length ? `  · ${extras.join(' · ')}` : ''}`
          )
        }
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
      await finishWrite(session)
    })
  })
)

const edit = command(
  'edit',
  summary("Change a card's title or description"),
  arg('<card>', 'card number or id prefix'),
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
      if (flags.body !== undefined) change.body = String(flags.body)
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
  arg('<card>', 'card number or id prefix'),
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
      let existing = session.state.labels.find(
        (entry) => entry.name.toLowerCase() === name.toLowerCase()
      )
      if (!existing && verb === 'remove') throw new Error(`No label "${name}" on this board`)
      if (!existing) {
        const labelId = newLabelId()
        const color =
          flags.color ||
          LABEL_COLORS.find(
            (value) => !session.state.labels.some((entry) => entry.color === value)
          ) ||
          LABEL_COLORS[0]
        await apply(
          session,
          { type: messageTypes.labelUpsert, labelId, name, color },
          (state) => state.labels.some((entry) => entry.id === labelId),
          'label to be created'
        )
        existing = { id: labelId, name }
      }
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
  summary('Set or clear a due date: YYYY-MM-DD (optionally --time HH:MM) or clear'),
  arg('<card>', 'card number or id prefix'),
  arg('<date>', 'YYYY-MM-DD | clear'),
  ...boardFlags(),
  flag('--time [HH:MM]', 'time of day, local; without it the card is due at the end of the day'),
  action(async ({ args, flags }) => {
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
    arg('<card>', 'card number or id prefix'),
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
    const storage = storageOf(flags)
    const secret = await password()
    const remembered = await store.readBoards(storage, secret)
    if (!remembered.length) {
      return say('No boards yet. Use `opencollab create` or `opencollab join`.')
    }
    const seconds = Math.max(5, Number(flags.wait ?? 60) || 60)
    await withSession(flags, async (session) => {
      await session.unlock(secret)
      // The worker checks each board in the background, like the apps do.
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
      let total = 0
      for (const entry of session.state.alerts) {
        say('', `${entry.name || 'Board'}${entry.checkedAt ? '' : ' (not checked yet)'}`)
        if (!entry.alerts.length) say('  nothing new')
        for (const alert of entry.alerts) say(alertLine(alert))
        total += entry.alerts.length
      }
      say('', `${total} notification${total === 1 ? '' : 's'} from the last 14 days.`)
    })
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
  board,
  posts,
  post,
  comment,
  vote,
  column,
  move,
  edit,
  label,
  labelsList,
  due,
  archiveCommand(true),
  archiveCommand(false),
  describe,
  notifications,
  images,
  watch,
  update,
  version
)

module.exports = { cli }
