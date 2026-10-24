// A board bot: answers comments and cards that mention it, using any command
// that reads a prompt on stdin and prints a reply (an LLM CLI, a script...).
// It polls with the CLI instead of `watch` because one storage folder can only
// be open by one process at a time. See docs/server.md.
//
//   OPENCOLLAB_PASSWORD=...  BOT_NAME=Robo  BOT_COMMAND='claude -p' \
//   node apps/cli/examples/board-bot.mjs
//
// BOT_STORAGE (default ~/.opencollab-bot), BOT_BOARD (name or number, default
// latest), BOT_INTERVAL (seconds, default 30), OPENCOLLAB_BIN (default: this repo's CLI).
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const name = process.env.BOT_NAME
const command = process.env.BOT_COMMAND
if (!name || !command || !process.env.OPENCOLLAB_PASSWORD) {
  console.error('Set BOT_NAME, BOT_COMMAND and OPENCOLLAB_PASSWORD.')
  process.exit(1)
}
const storage = process.env.BOT_STORAGE || path.join(os.homedir(), '.opencollab-bot')
const interval = Number(process.env.BOT_INTERVAL || 30) * 1000
const bin = process.env.OPENCOLLAB_BIN || path.join(import.meta.dirname, '..', 'bin.js')
const seenFile = path.join(storage, 'bot-seen.json')
const mention = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')

// Runs one CLI command against the bot's storage and board; `input` goes to stdin.
function cli(args, input = '') {
  const board = process.env.BOT_BOARD ? ['--board', process.env.BOT_BOARD] : []
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [bin, ...args, '-s', storage, ...board],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
    child.stdin.end(input)
  })
}

// Pipes the prompt into BOT_COMMAND and returns what it prints.
function ask(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (data) => (out += data))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`BOT_COMMAND exited with ${code}`))
    )
    child.stdin.end(prompt)
  })
}

function promptFor(board, post, trigger, profiles) {
  const who = (identity) => profiles[identity] || identity.slice(0, 8)
  const thread = (post.comments || []).map((c) => `${who(c.author)}: ${c.text}`).join('\n')
  return [
    `You are ${name}, a helpful member of the team board "${board}".`,
    'Reply to the latest message that mentions you. Be brief; Markdown is fine.',
    '',
    `Card: ${post.title}`,
    post.body ? `Description:\n${post.body}` : '',
    thread ? `Comments:\n${thread}` : '',
    '',
    `Message to answer (from ${who(trigger.author)}):\n${trigger.text}`
  ]
    .filter((line) => line !== '')
    .join('\n')
}

async function readSeen() {
  try {
    return new Set(JSON.parse(await fs.readFile(seenFile, 'utf8')))
  } catch {
    return null
  }
}

async function tick(seen) {
  const { board, profiles, posts } = JSON.parse(await cli(['posts', '--json', '--wait', '5']))
  const me = Object.keys(profiles).find((identity) => profiles[identity] === name)
  const pending = []
  for (const post of posts) {
    const items = [
      { id: post.id, author: post.author, text: `${post.title}\n${post.body || ''}` },
      ...(post.comments || [])
    ]
    for (const item of items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      const mentioned = (me && item.mentions?.includes(me)) || mention.test(item.text)
      if (mentioned && item.author !== me) pending.push({ post, item })
    }
  }
  for (const { post, item } of pending) {
    const reply = (await ask(promptFor(board, post, item, profiles))).slice(0, 5000)
    // The text goes through stdin: replies are multi-line and may start with "-".
    if (reply) await cli(['comment', post.id, '-'], reply)
    console.log(`replied on "${post.title}"`)
  }
  await fs.writeFile(seenFile, JSON.stringify([...seen]))
}

await fs.mkdir(storage, { recursive: true })
let seen = await readSeen()
if (!seen) {
  // First run: everything already on the board counts as answered.
  seen = new Set()
  const { posts } = JSON.parse(await cli(['posts', '--json', '--wait', '5']))
  for (const post of posts) {
    seen.add(post.id)
    for (const entry of post.comments || []) seen.add(entry.id)
  }
  await fs.writeFile(seenFile, JSON.stringify([...seen]))
}
console.log(`${name} is watching for mentions every ${interval / 1000}s`)
for (;;) {
  try {
    await tick(seen)
  } catch (err) {
    console.error(err.message)
  }
  await new Promise((resolve) => setTimeout(resolve, interval))
}
