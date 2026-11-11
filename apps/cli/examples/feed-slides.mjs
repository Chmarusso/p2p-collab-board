// Feed slides: turns shared posts on a board into short slide decks that
// members flip through in the app (Back / Next). For every card with a link
// that isn't labelled `slides` yet, it
//
//   1. reads the post through treg: the caption or article, the transcript of
//      a video (TikTok, Instagram, YouTube, X; a long X video through a copy of
//      it on YouTube) or the page's text, plus the card's own description and
//      its comments,
//   2. has a model command (`claude -p` by default) pull out what's worth
//      knowing, story style: a hook, then 6–8 slides that each teach one thing
//      (a case, steps, old against new, a number, a quote), and for each slide
//      the visual that explains it: a small diagram, the quoted line itself or
//      a scene to draw,
//   3. has the scenes drawn (treg image generation, a few per deck) and
//      attaches them to the card,
//   4. writes the deck into the card's description (slides separated by
//      `---`, each visual as one `▸ kind: …` line, so it reads fine anywhere),
//      gives the card a plain title and labels it `slides`,
//   5. gives a card without a picture the post's own (the cover of its slides).
//
// A quote is kept only if the source says it in those words. Remove the label
// from a card, or pass --redo, to make its deck again. The script runs once and
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
// SLIDES_PICTURES  drawn scenes per deck, about $0.008 each (default: 3; 0 for none)
// SLIDES_MAX_USD   stop once treg charges pass this (default: 0.25)
// SLIDES_LINGER    seconds to stay online after writing, so members' devices
//                  can sync the changes (default: 120; 0 skips it)
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { ask as askModel, fetchPost, makeCli, makeTreg, pageImage } from './lib/sources.mjs'

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
const ask = (prompt) => askModel(modelCommand, prompt)
const language = process.env.SLIDES_LANGUAGE || 'the same language as the post'
const label = process.env.SLIDES_LABEL || 'slides'
const maxUsd = Number(process.env.SLIDES_MAX_USD || 0.25)
const limit = options.limit ? Number(options.limit) : Infinity
const linger = Number(process.env.SLIDES_LINGER ?? 120)
const pictures = Number(process.env.SLIDES_PICTURES ?? 3)
const SOURCE_MAX = 60000 // a long podcast transcript: the start and the end are enough

const treg = makeTreg()
const cli = makeCli({ bin, storage, board })

const linkOf = (card) =>
  card.source?.url || card.body?.match(/https?:\/\/\S+/)?.[0]?.replace(/[)>\]]+$/, '')

const clip = (text) =>
  text.length > SOURCE_MAX
    ? `${text.slice(0, SOURCE_MAX * 0.7)}\n[…]\n${text.slice(-SOURCE_MAX * 0.3)}`
    : text

// The visuals a slide can carry, as the model is asked for them.
const VISUALS = [
  '{"type":"stat","value":"30%","label":"<what the number is, at most 8 words>","compare":"<what it is measured against, at most 8 words, optional>"} for one striking number',
  '{"type":"versus","left":{"label":"<the old way, at most 3 words>","points":["<at most 6 words>", "2 or 3 points"]},"right":{"label":"<the new way>","points":["..."]}} for one way against another',
  '{"type":"flow","nodes":["<at most 4 words>", "3 to 5 nodes"],"note":"<at most 8 words, optional>"} for steps, a process, or cause and effect',
  '{"type":"layers","layers":["<top layer, at most 5 words>", "2 to 4 layers"],"note":"<at most 8 words, optional>"} for things built on top of each other',
  '{"type":"quote","text":"<the line, copied VERBATIM from the source>","who":"<who said or wrote it>"AT} for a line worth remembering in its own words'
]
const PICTURE_VISUAL =
  '{"type":"picture","scene":"<one sentence: a scene a teacher would sketch on a whiteboard to explain this idea, with concrete objects and people doing something; no text in the picture>"} for a case or an idea that a drawing explains better than a diagram'

function promptFor(card, post, comments) {
  const at = post.timed ? ',"at":"<m:ss, the time in the transcript where the line starts>"' : ''
  const visuals = [...VISUALS, ...(pictures > 0 ? [PICTURE_VISUAL] : [])]
  return [
    `Someone saved the post below to read or watch later. Turn it into a story of 6 to 8 slides in ${language}, like the best Instagram carousels: each slide teaches ONE thing well enough that the reader could repeat it to a colleague tomorrow.`,
    '',
    'What makes a slide good here:',
    '- It carries the mechanism, not the conclusion: not "culture stops slop" but how exactly, with the example the source gives.',
    '- It has evidence from the source: a number, a named person, a concrete case, a verbatim quote.',
    '- It has a voice: plain words, "you", short sentences, a little attitude. No jargon unless the post is about it, no filler.',
    '- Use only what the sources say. Never invent a number, a quote or a name. Skip intros, sponsors and greetings.',
    "If members' comments add something useful (a question, a correction, a tip), give it its own slide.",
    '',
    'Vary the slide kinds; pick the kind that fits the idea:',
    '- "story": a concrete case in 2 or 3 lines (what happened, what they did, what came of it)',
    '- "steps": a how-to in 3 short lines',
    '- "versus": the old way against the new way',
    '- "number": one striking number and what it means',
    '- "quote": a verbatim line worth remembering; the lines say why it matters, without repeating it',
    '- "takeaway": the last slide, what to do or remember, with 👉 as its emoji',
    '',
    'Give each slide the ONE visual that explains its idea (explains, not decorates), or none when nothing fits:',
    ...visuals.map((visual) => `- ${visual.replace('AT', at)}`),
    pictures > 0
      ? `Use ${pictures} pictures in the deck when it has that many story or takeaway slides (those are the slides a drawing serves best), and never more.`
      : '',
    '',
    'Answer with ONE JSON object between the lines BEGIN_DECK and END_DECK, and nothing else between them:',
    'BEGIN_DECK',
    '{"title":"<what the post is about, a plain name, at most 60 characters, sentence case; no emoji, quotes, hashtags, account or site names>","hook":"<a bold claim, surprising fact or question that makes people want to swipe, at most 12 words>","slides":[{"kind":"story","emoji":"<one fitting emoji>","headline":"<at most 7 words>","lines":["<at most 16 words, with **bold** on the one phrase that matters most>","<2 lines as a rule, 3 at most>"],"visual":{}}]}',
    'END_DECK',
    `Write every word of the deck in that language; a quote stays in the language of the source.`,
    '',
    `--- Card title: ${card.title}`,
    card.body?.trim() ? `--- Card description:\n${card.body.trim()}` : '',
    post.caption ? `--- Caption / article / page:\n${clip(post.caption)}` : '',
    post.timed
      ? `--- Transcript, each line starting with its time:\n${clip(post.timed)}`
      : post.transcript
        ? `--- Transcript:\n${clip(post.transcript)}`
        : '',
    comments ? `--- Members' comments:\n${comments}` : ''
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n')
}

// The deck as the model's JSON, between the two marker lines.
function parseDeck(answer) {
  const marked = answer.match(/BEGIN_DECK([\s\S]*?)END_DECK/)?.[1] ?? answer
  let deck = null
  try {
    deck = JSON.parse(marked.slice(marked.indexOf('{'), marked.lastIndexOf('}') + 1))
  } catch {}
  const slides = (Array.isArray(deck?.slides) ? deck.slides : [])
    .filter((slide) => slide?.headline && Array.isArray(slide.lines))
    .map((slide) => ({
      heading: [slide.emoji, slide.headline].filter(Boolean).map(tidy).join(' '),
      lines: slide.lines.map(tidy).filter(Boolean).slice(0, 4),
      visual: slide.visual
    }))
  return { title: deck?.title || null, summary: tidy(deck?.hook), slides }
}

const tidy = (text) =>
  String(text ?? '')
    .replace(/[|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const list = (items, max) =>
  (Array.isArray(items) ? items : []).map(tidy).filter(Boolean).slice(0, max)
// Letters and digits only: a quote counts as verbatim whatever its punctuation.
const bare = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

// A visual the app can draw, or null: a quote must be in the source word for word.
function checkedVisual(visual, source) {
  switch (visual?.type) {
    case 'stat': {
      const value = tidy(visual.value)
      return value
        ? { type: 'stat', value, label: tidy(visual.label), compare: tidy(visual.compare) }
        : null
    }
    case 'versus': {
      const side = (entry) => ({
        label: tidy(entry?.label).replace(/:/g, ''),
        points: list(entry?.points, 3).map((point) => point.replace(/;/g, ','))
      })
      const [left, right] = [side(visual.left), side(visual.right)]
      const whole = left.label && right.label && left.points.length && right.points.length
      return whole ? { type: 'versus', left, right } : null
    }
    case 'flow': {
      const nodes = list(visual.nodes, 5).map((node) => node.replace(/\s*→\s*/g, ' '))
      return nodes.length > 1 ? { type: 'flow', nodes, note: tidy(visual.note) } : null
    }
    case 'layers': {
      const layers = list(visual.layers, 4).map((layer) => layer.replace(/ \/ /g, ', '))
      return layers.length > 1 ? { type: 'layers', layers, note: tidy(visual.note) } : null
    }
    case 'quote': {
      const text = tidy(visual.text).replace(/^["“„«]+|["”»]+$/g, '')
      if (!text || !source.includes(bare(text))) {
        if (text) console.log(`  · quote not found in the source, left out: ${text.slice(0, 60)}…`)
        return null
      }
      const at = tidy(visual.at).match(/^\d{1,3}:\d{2}(:\d{2})?$/)?.[0] || ''
      return { type: 'quote', text, who: tidy(visual.who), at }
    }
    case 'picture': {
      const scene = tidy(visual.scene)
      return scene ? { type: 'picture', scene } : null
    }
    default:
      return null
  }
}

// One line the app turns back into the visual; anywhere else it reads as a note.
function visualLine(visual) {
  const fields = (...parts) => parts.join(' | ').replace(/( \| )+$/, '')
  const side = (entry) => `${entry.label}: ${entry.points.join('; ')}`
  switch (visual.type) {
    case 'stat':
      return `▸ stat: ${fields(visual.value, visual.label, visual.compare)}`
    case 'versus':
      return `▸ versus: ${fields(side(visual.left), side(visual.right))}`
    case 'flow':
      return `▸ flow: ${fields(visual.nodes.join(' → '), visual.note)}`
    case 'layers':
      return `▸ layers: ${fields(visual.layers.join(' / '), visual.note)}`
    case 'quote':
      return `▸ quote: ${fields(visual.text, visual.who, visual.at)}`
    case 'picture':
      // The card's nth image; before it is drawn (a dry run), the scene.
      return `▸ picture: ${visual.index || visual.scene}`
  }
}

// The card's description: the summary, then one section per slide. The app
// shows each `---` section as a slide; elsewhere it reads as a short note.
const slideText = (slide) =>
  [
    `## ${slide.heading}`,
    ...slide.lines.map((line) => `- ${line.replace(/^\s*(?:[-*•]|\d+\.)\s+/, '')}`),
    ...(slide.visual ? [visualLine(slide.visual)] : [])
  ].join('\n')
const deckBody = (deck) =>
  [deck.summary, ...deck.slides.map(slideText)].filter(Boolean).join('\n\n---\n\n')

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
  const post = await fetchPost(treg, url, { ask })
  if (!post.caption && !post.transcript) {
    console.warn('  ! nothing to read from the post; skipped (try again later)')
    return false
  }
  console.log(`  caption ${post.caption.length} chars · transcript ${post.transcript.length} chars`)
  const comments = (card.comments || [])
    .map((comment) => `${profiles[comment.author] || 'A member'}: ${comment.text}`)
    .join('\n')
  const deck = parseDeck(await ask(promptFor(card, post, comments)))
  if (deck.slides.length < 2) throw new Error('the model returned no slides')
  const said = bare([post.caption, post.transcript, card.body, comments].join(' '))
  let scenes = 0
  for (const slide of deck.slides) {
    slide.visual = checkedVisual(slide.visual, said)
    if (slide.visual?.type === 'picture' && ++scenes > pictures) slide.visual = null
  }
  const clean = deck.title ? cleanTitle(deck.title) : ''
  const title = clean && clean !== card.title ? clean : null
  if (options['dry-run']) {
    const body = deckBody(deck)
    console.log(`  [dry run] ${title ? `title → ${title}\n` : ''}${body.replace(/^/gm, '  | ')}`)
    return true
  }
  // Pictures first: a slide points at its drawing by its place among the card's images.
  if (!card.images?.length) await attachPicture(card, post.image || (await pageImage(url)))
  await attachDrawings(
    card,
    deck.slides.filter((slide) => slide.visual?.type === 'picture')
  )
  // The link moves to "View original" when it was only in the description.
  const source = card.source ? [] : ['--source', url]
  const changes = ['--body', deckBody(deck), ...(title ? ['--title', title] : []), ...source]
  await cli(['edit', card.id, ...changes])
  await cli(['label', card.id, 'add', label])
  const drawn = deck.slides.filter((slide) => slide.visual?.type === 'picture').length
  console.log(
    `  ✓ ${deck.slides.length} slides${drawn ? ` · ${drawn} drawn` : ''}${title ? ` · title: ${title}` : ''}`
  )
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

// Drawn scenes: one look for the whole board, and no lettering, which image
// models garble.
const DRAWING = {
  tool: 'reapi.image-gen.gpt-image-2-5',
  options: { model: 'gpt-image-2.5-flare-official', quality: 'medium', size: '1536x1024' },
  usd: 0.008,
  style:
    'Hand-drawn sketchnote illustration, like a teacher explaining on a whiteboard: confident thick black marker lines on warm off-white paper, flat colour accents in teal and warm yellow only, simple friendly faceless characters, lots of empty space, one clear idea. Absolutely no text, letters, numbers or labels anywhere in the picture.'
}
const MAX_ATTACHMENTS = 12
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const stillImages = (card) => (card?.images || []).filter((ref) => !ref.type.startsWith('video/'))

// One scene as an image file, or null. The task is billed only when it succeeds.
async function draw(scene, name) {
  const body = { ...DRAWING.options, prompt: `${DRAWING.style} Scene: ${scene}` }
  const task = await treg.call(DRAWING.tool, { body }, ['--await', '--timeout', '600'])
  const imageUrl = task?.output?.image_urls?.[0]
  if (!imageUrl) return null
  // A waited-for task answers without its charge: count the listed price.
  treg.spentMicro += DRAWING.usd * 1e6
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) }).catch(() => null)
  const type = response?.headers.get('content-type')?.split(';')[0]
  if (!response?.ok || !IMAGE_TYPES[type]) return null
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length > MAX_IMAGE_BYTES) return null
  const file = path.join(os.tmpdir(), `${name}${IMAGE_TYPES[type]}`)
  await fs.writeFile(file, data)
  return file
}

// Draws the slides' scenes side by side, attaches them and points each slide at
// its image. A slide whose drawing didn't make it goes without a visual.
async function attachDrawings(card, slides) {
  const current = async () =>
    JSON.parse(await cli(['board', '--json'])).cards.find((entry) => entry.id === card.id)
  const affordable = Math.floor((maxUsd - treg.spentMicro / 1e6) / DRAWING.usd + 1e-9)
  const room = slides.length ? MAX_ATTACHMENTS - ((await current())?.images?.length || 0) : 0
  const chosen = slides.slice(0, Math.max(0, Math.min(affordable, room)))
  if (chosen.length < slides.length) {
    console.warn(
      `  ! ${slides.length - chosen.length} drawing(s) skipped (spend limit or card full)`
    )
  }
  const files = await Promise.all(
    chosen.map((slide, index) =>
      draw(slide.visual.scene, `slides-${card.id.slice(0, 12)}-${index}`).catch(() => null)
    )
  )
  const drawn = chosen.filter((slide, index) => files[index])
  const paths = files.filter(Boolean)
  let first = 0
  try {
    if (paths.length) {
      const before = stillImages(await current()).length
      await cli(['attach', card.id, paths[0], ...paths.slice(1).flatMap((file) => ['-i', file])])
      // The new images are the card's last ones, in the order given.
      if (stillImages(await current()).length === before + paths.length) first = before + 1
    }
  } catch (err) {
    console.warn(`  ! drawings not attached: ${err.message.split('\n')[0]}`)
  } finally {
    await Promise.all(paths.map((file) => fs.rm(file, { force: true })))
  }
  for (const slide of slides) {
    const place = first ? drawn.indexOf(slide) : -1
    slide.visual = place < 0 ? null : { type: 'picture', index: first + place }
  }
  if (first) console.log(`  ✓ ${drawn.length} drawing(s) attached`)
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
