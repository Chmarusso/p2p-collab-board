// Feed slides: turns shared posts on a board into short slide decks that
// members flip through in the app (Back / Next). For every card with a link
// that isn't labelled `slides` yet, it
//
//   1. reads the post through treg: the caption or article, the transcript of
//      a video (TikTok, Instagram, YouTube, X) or the page's text, plus the
//      card's own description and its comments,
//   2. has a model command (`claude -p` by default) pull out what's worth
//      knowing, story style: a hook, then 5–8 slides with one idea each,
//   3. writes the deck into the card's description (slides separated by
//      `---`, so it reads fine anywhere), gives the card a plain title and
//      labels it `slides`,
//   4. gives a card without a picture the post's own (the cover of its slides).
//
// Remove the label from a card, or pass --redo, to make its deck again. The script runs once and
// exits; run it from cron or a systemd timer to keep a board covered.
//
//   OPENCOLLAB_PASSWORD=... SLIDES_BOARD="To watch" \
//   node apps/cli/examples/feed-slides.mjs [--dry-run] [--redo] [--limit 5] [--card <id>]
//
// SLIDES_BOARD     board name or number (required)
// SLIDES_STORAGE   CLI storage of the identity that edits the cards (default: the CLI's)
// SLIDES_COMMAND   reads a prompt on stdin, prints the answer (default: claude -p)
// SLIDES_LANGUAGE  language of the slides (default: the post's own)
// SLIDES_LABEL     marks cards that have a deck (default: slides)
// SLIDES_MAX_USD   stop once treg charges pass this (default: 0.25)
// SLIDES_PICTURES 0 leaves cards without a picture as they are (default: 1)
// SLIDES_LINGER    seconds to stay online after writing, so members' devices
//                  can sync the changes (default: 120; 0 skips it)
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  ask as askModel,
  fetchPost,
  makeCli,
  makeStatus,
  makeTreg,
  pageImage
} from './lib/sources.mjs'

const { values: options } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    redo: { type: 'boolean', default: false },
    limit: { type: 'string' },
    card: { type: 'string' }
  }
})
const board = process.env.SLIDES_BOARD
if (!board || !process.env.OPENCOLLAB_PASSWORD) {
  console.error('Set SLIDES_BOARD and OPENCOLLAB_PASSWORD.')
  process.exit(1)
}
const bin = process.env.OPENCOLLAB_BIN || path.join(import.meta.dirname, '..', 'bin.js')
const storage = process.env.SLIDES_STORAGE
const modelCommand = process.env.SLIDES_COMMAND || 'claude -p'
const language = process.env.SLIDES_LANGUAGE || 'the same language as the post'
const label = process.env.SLIDES_LABEL || 'slides'
const maxUsd = Number(process.env.SLIDES_MAX_USD || 0.25)
const limit = options.limit ? Number(options.limit) : Infinity
const linger = Number(process.env.SLIDES_LINGER ?? 120)
const pictures = process.env.SLIDES_PICTURES !== '0'
const SOURCE_MAX = 60000 // a long podcast transcript: the start and the end are enough

const treg = makeTreg()
const cli = makeCli({ bin, storage, board })
const showStatus = makeStatus({ bin, storage, board })

const linkOf = (card) =>
  card.source?.url || card.body?.match(/https?:\/\/\S+/)?.[0]?.replace(/[)>\]]+$/, '')

const clip = (text) =>
  text.length > SOURCE_MAX
    ? `${text.slice(0, SOURCE_MAX * 0.7)}\n[…]\n${text.slice(-SOURCE_MAX * 0.3)}`
    : text

function promptFor(card, post, comments) {
  return [
    `Someone saved the post below to read or watch later. Turn what is worth knowing into a story in ${language}, like an Instagram carousel or a TikTok text story: something people swipe through in under a minute and remember.`,
    'Use only what the sources say. Skip intros, sponsors, greetings and filler; keep concrete ideas, advice, numbers, names and examples.',
    'Talk to the reader directly ("you"), in plain words. Short, punchy sentences; no jargon unless the post is about it.',
    "If members' comments add something useful (a question, a correction, a tip), give it its own slide.",
    'Answer in exactly this format and nothing else:',
    '',
    'TITLE: <what the post is about, a plain name, at most 60 characters, sentence case; no emoji, quotes, hashtags, account or site names>',
    'SUMMARY: <the hook: a bold claim, surprising fact or question that makes people want to swipe, at most 12 words>',
    '',
    '### <section label: what kind of point this is, 1 to 3 words, e.g. The problem, Why it matters, How it works, The numbers, In their words, Example, Mistake to avoid, Tip>',
    '## <slide headline, at most 7 words>',
    '- <one short line that explains it, at most 16 words>',
    '',
    '### <section label>',
    '## <next headline>',
    '- <line>',
    '- <optional second line>',
    '',
    'Write 5 to 8 slides, one idea each, with 1 or 2 lines. The last slide is the takeaway (label: Takeaway): what to do or remember.',
    'No emoji anywhere. Labels repeat only when two slides really are the same kind of point.',
    'Write every word, labels included, in that language. Use **bold** for the one phrase per slide that matters most.',
    '',
    `--- Card title: ${card.title}`,
    card.body?.trim() ? `--- Card description:\n${card.body.trim()}` : '',
    post.caption ? `--- Caption / article / page:\n${clip(post.caption)}` : '',
    post.transcript ? `--- Transcript:\n${clip(post.transcript)}` : '',
    comments ? `--- Members' comments:\n${comments}` : ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// "TITLE:" and "SUMMARY:" first, then the slides as `### label`, `## heading`
// and points.
function parseDeck(answer) {
  const title = answer.match(/^\s*TITLE:\s*(.+)$/m)?.[1].trim() || null
  const summary = answer.match(/^\s*SUMMARY:\s*(.+)$/m)?.[1].trim() || ''
  // A label starts a slide; so does a heading that has no label above it.
  const slides = []
  let current = null
  for (const line of answer.split('\n')) {
    const label = /^###\s/.test(line)
    const heading = /^##\s/.test(line)
    if (label || (heading && !(current && !current.heading))) {
      current = { lines: [], heading: false }
      slides.push(current)
    }
    if (!current || !line.trim()) continue
    if (heading) current.heading = true
    current.lines.push(line.trim())
  }
  const parts = slides.filter((slide) => slide.heading).map((slide) => slide.lines.join('\n'))
  return { title, summary, slides: parts }
}

// The card's description: the summary, then one section per slide. The app
// shows each `---` section as a slide; elsewhere it reads as a short note.
const deckBody = (deck) => [deck.summary, ...deck.slides].filter(Boolean).join('\n\n---\n\n')

const cleanTitle = (title) =>
  title
    .replace(/\p{Extended_Pictographic}|#\S+/gu, '')
    .replace(/["“”„«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

async function makeDeck(card, profiles) {
  const url = linkOf(card)
  console.log(`\n▸ ${card.title}\n  ${url}`)
  const busy = options['dry-run'] ? null : showStatus('Making key points', card.id)
  let post
  let deck
  try {
    post = await fetchPost(treg, url)
    if (!post.caption && !post.transcript) {
      console.warn('  ! nothing to read from the post; skipped (try again later)')
      return false
    }
    console.log(
      `  caption ${post.caption.length} chars · transcript ${post.transcript.length} chars`
    )
    const comments = (card.comments || [])
      .map((comment) => `${profiles[comment.author] || 'A member'}: ${comment.text}`)
      .join('\n')
    deck = parseDeck(await askModel(modelCommand, promptFor(card, post, comments)))
  } finally {
    await busy?.stop()
  }
  if (deck.slides.length < 2) throw new Error('the model returned no slides')
  const clean = deck.title ? cleanTitle(deck.title) : ''
  const title = clean && clean !== card.title ? clean : null
  const body = deckBody(deck)
  if (options['dry-run']) {
    console.log(`  [dry run] ${title ? `title → ${title}\n` : ''}${body.replace(/^/gm, '  | ')}`)
    return true
  }
  // The link moves to "View original" when it was only in the description.
  const source = card.source ? [] : ['--source', url]
  await cli(['edit', card.id, '--body', body, ...(title ? ['--title', title] : []), ...source])
  await cli(['label', card.id, 'add', label])
  console.log(`  ✓ ${deck.slides.length} slides${title ? ` · title: ${title}` : ''}`)
  if (pictures && !card.images?.length) {
    await attachPicture(card, post.image || (await pageImage(url)))
  }
  return true
}

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }

// Downloads the post's picture and attaches it; a missing picture isn't an error.
async function attachPicture(card, imageUrl) {
  if (!imageUrl) return console.log('  · no picture found for this post')
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) }).catch(() => null)
  const type = response?.headers.get('content-type')?.split(';')[0]
  if (!response?.ok || !IMAGE_TYPES[type]) {
    return console.warn(`  ! picture not downloaded (${response?.status || 'no answer'}, ${type})`)
  }
  const file = path.join(os.tmpdir(), `slides-${card.id.slice(0, 12)}${IMAGE_TYPES[type]}`)
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()))
  try {
    await cli(['attach', card.id, file])
    console.log('  ✓ picture attached')
  } catch (err) {
    console.warn(`  ! picture not attached: ${err.message.split('\n')[0]}`)
  } finally {
    await fs.rm(file, { force: true })
  }
}

const state = JSON.parse(await cli(['board', '--json']))
const deckLabel = state.labels.find((entry) => entry.name.toLowerCase() === label.toLowerCase())
const todo = state.cards.filter(
  (card) =>
    !card.archived &&
    !card.template &&
    (!options.card || card.id.startsWith(options.card)) &&
    (options.redo || !(deckLabel && card.labelIds?.includes(deckLabel.id))) &&
    linkOf(card)
)
console.log(
  `${state.board?.name || board}: ${todo.length} post(s) ${options.redo ? 'to redo' : 'without slides'}`
)

let done = 0
for (const card of todo.slice(0, limit)) {
  if (treg.spentMicro / 1e6 >= maxUsd) {
    console.warn(
      `\nStopped: treg charges reached $${(treg.spentMicro / 1e6).toFixed(4)} (SLIDES_MAX_USD ${maxUsd}).`
    )
    break
  }
  try {
    if (await makeDeck(card, state.profiles || {})) done++
  } catch (err) {
    console.error(`  ✗ ${err.message}`)
  }
}
console.log(`\n${done} deck(s) made · treg charged $${(treg.spentMicro / 1e6).toFixed(4)}`)

// Boards sync only while two members are online together: stay on the board for
// a while so devices that are open can pull the changes.
if (done && linger > 0 && !options['dry-run']) {
  console.log(`Staying online ${linger}s so open devices can sync…`)
  const watch = spawn(
    process.execPath,
    [bin, 'watch', ...(storage ? ['-s', storage] : []), '--board', board],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  )
  setTimeout(() => watch.kill('SIGINT'), linger * 1000)
  await new Promise((resolve) => watch.on('close', resolve))
}
