// opencollab — command-line client for OpenCollab boards. It drives the same
// Bare backend as the desktop and mobile apps (workers/main.js), so boards,
// posts, comments, votes and encrypted images are fully interoperable.
const fs = require('fs/promises')
const os = require('os')
const path = require('path')
const readline = require('readline')
const Identity = require('keet-identity-key')
const { command, flag, arg, summary, description, header, footer } = require('paparam')
const { messageTypes, normalizeInvite, inviteLink } = require('@opencollab/board-protocol')
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
  const extras = [
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
      const { boardName } = await openBoard(session, flags, {
        invite: normalizeInvite(args.invite)
      })
      say(`Joined "${boardName}" · ${session.state.objects.length} posts.`)
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
      await openBoard(session, flags)
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
      await openBoard(session, flags)
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
      await openBoard(session, flags)
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
      await openBoard(session, flags)
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
      const { boardName } = await openBoard(session, { ...flags, wait: 0 })
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
      session.waiters.add((message) => {
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
  posts,
  post,
  comment,
  vote,
  images,
  watch,
  update,
  version
)

module.exports = { cli }
