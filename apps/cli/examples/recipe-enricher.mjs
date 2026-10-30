// Recipe enricher: turns shared recipe posts into proper recipes. For every card
// on a board that has a link (its "View original" source, or a link in the
// description) and isn't labelled `enriched` yet, it
//
//   1. fetches the post's transcript and its full caption/description through
//      treg (TikTok, Instagram, YouTube; other links: the page's text), and
//      reads the card's comments (tips, substitutions, corrections),
//   2. pipes them to a model command (`claude -p` by default) that writes a
//      short recipe: a one-line summary, ingredients and steps,
//   3. puts that recipe in the card's description, posts the caption and the
//      transcript as comments, and labels the card `enriched`.
//
// Remove the label from a card to enrich it again. The script runs once and
// exits; run it from cron or a systemd timer to keep a board enriched.
//
//   OPENCOLLAB_PASSWORD=... ENRICH_BOARD="Family recipes" \
//   node apps/cli/examples/recipe-enricher.mjs [--dry-run] [--limit 5] [--card <id>]
//
// ENRICH_BOARD     board name or number (required)
// ENRICH_STORAGE   CLI storage of the identity that edits the cards (default: the CLI's)
// ENRICH_COMMAND   reads a prompt on stdin, prints the answer (default: claude -p)
// ENRICH_LANGUAGE  language of the recipe (default: the post's own)
// ENRICH_LABEL     marks enriched cards (default: enriched)
// ENRICH_MAX_USD   stop once treg charges pass this (default: 0.25)
// ENRICH_LINGER    seconds to stay online after writing, so members' devices
//                  can sync the changes (default: 120; 0 skips it)
// TREG_BIN, OPENCOLLAB_BIN  the treg CLI and this repo's CLI, if not the defaults
import { spawn } from 'node:child_process'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { ask as askModel, fetchPost as fetchSource, makeCli, makeTreg } from './lib/sources.mjs'

const { values: options } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    limit: { type: 'string' },
    card: { type: 'string' }
  }
})
const board = process.env.ENRICH_BOARD
if (!board || !process.env.OPENCOLLAB_PASSWORD) {
  console.error('Set ENRICH_BOARD and OPENCOLLAB_PASSWORD.')
  process.exit(1)
}
const bin = process.env.OPENCOLLAB_BIN || path.join(import.meta.dirname, '..', 'bin.js')
const modelCommand = process.env.ENRICH_COMMAND || 'claude -p'
const language = process.env.ENRICH_LANGUAGE || 'the same language as the post'
const label = process.env.ENRICH_LABEL || 'enriched'
const maxUsd = Number(process.env.ENRICH_MAX_USD || 0.25)
const limit = options.limit ? Number(options.limit) : Infinity
const linger = Number(process.env.ENRICH_LINGER ?? 120)
const COMMENT_MAX = 4900 // the board allows 5 000 characters per comment

const treg = makeTreg()
const cli = makeCli({ bin, storage: process.env.ENRICH_STORAGE, board })
const fetchPost = (url) => fetchSource(treg, url)
const ask = (prompt) => askModel(modelCommand, prompt)

// Members' comments: tips, substitutions and corrections worth folding in. The
// enricher's own caption and transcript comments are left out.
const OWN_COMMENTS = /^\*\*(Original caption|Transcript)\*\*/

function commentsOf(card, profiles) {
  return (card.comments || [])
    .filter((comment) => !OWN_COMMENTS.test(comment.text))
    .map((comment) => `${profiles[comment.author] || 'A member'}: ${comment.text}`)
    .join('\n')
}

function promptFor(card, post, comments) {
  return [
    `Below is a recipe someone saved from social media or the web. Write it up in ${language} as a short, clear recipe.`,
    'Use only what the sources say; if a quantity or step is missing, leave it out instead of guessing.',
    "Fold in useful tips, substitutions or corrections from the members' comments.",
    'Write every word of the answer in that language, the headings and labels included.',
    'Answer in exactly this format and nothing else (translate the words in angle brackets):',
    '',
    'TITLE: <the dish, a few words>',
    'KIND: recipe',
    '',
    '<one sentence describing the dish>',
    '',
    '**<Serves>:** <n> · **<Time>:** <total> (leave out a part the sources don’t give)',
    '',
    '## <Ingredients>',
    '- <quantity> <ingredient>',
    '',
    '## <Steps>',
    '1. <step>',
    '',
    'If it is not a recipe, answer TITLE:, then KIND: other, then a 2–3 sentence summary.',
    'The TITLE is what people see on the board: a plain name anyone understands at a glance, at most 60 characters, in that language, in sentence case. No emoji, hashtags, quotes, account or site names, "on Instagram", calories or macros, and no clickbait. For a recipe, name the dish (e.g. "Kanapka z kurczakiem i awokado"); otherwise say what the post is (e.g. "Reklama pakietu dietetycznego").',
    '',
    `--- Card title: ${card.title}`,
    card.body?.trim() ? `--- Card description:\n${card.body.trim()}` : '',
    post.caption ? `--- Caption / page:\n${post.caption}` : '',
    post.transcript ? `--- Transcript:\n${post.transcript}` : '',
    comments ? `--- Members' comments:\n${comments}` : ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// "TITLE: …" and "KIND: recipe|other" first, the Markdown after them.
function parseAnswer(answer) {
  const title = answer.match(/^\s*TITLE:\s*(.+)$/m)?.[1].trim() || null
  const kind = answer.match(/^\s*KIND:\s*(\w+)/m)?.[1].toLowerCase()
  const body = answer.replace(/^\s*(TITLE|KIND):.*$/gm, '').trim()
  return { title, body, isRecipe: kind !== 'other' }
}

// Titles the share flow made from the link or the post's caption rather than
// a name: the site or account, emoji, hashtags, quotes, or just too long.
const noisyTitle = (title) =>
  /^(TikTok|YouTube|Instagram)\b|\bon (Instagram|TikTok|X|YouTube)\b|^[\w.-]+\.[a-z]{2,}\/\S*$|[#@"“”„«»]|\p{Extended_Pictographic}/iu.test(
    title
  ) || title.length > 70

// What the model says, minus the noise it was asked to leave out anyway.
const cleanTitle = (title) =>
  title
    .replace(/\p{Extended_Pictographic}|#\S+/gu, '')
    .replace(/["“”„«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)

const clip = (text) => (text.length > COMMENT_MAX ? `${text.slice(0, COMMENT_MAX)}…` : text)

async function enrich(card, profiles) {
  const url = card.source?.url || card.body?.match(/https?:\/\/\S+/)?.[0]?.replace(/[)>\]]+$/, '')
  console.log(`\n▸ ${card.title}\n  ${url}`)
  const post = await fetchPost(url)
  if (!post.caption && !post.transcript) {
    console.warn('  ! nothing to read from the post; skipped (try again later)')
    return false
  }
  console.log(`  caption ${post.caption.length} chars · transcript ${post.transcript.length} chars`)
  const comments = commentsOf(card, profiles)
  if (comments) console.log(`  ${comments.split('\n').length} comment(s) from members`)
  const recipe = parseAnswer(await ask(promptFor(card, post, comments)))
  if (!recipe.body) throw new Error('the model returned nothing')
  // A non-recipe gets a summary, and keeps its title.
  // The model's clean title replaces what the share flow made.
  const clean = recipe.title ? cleanTitle(recipe.title) : ''
  const title = clean && clean !== card.title ? clean : null
  const body = recipe.body
  if (options['dry-run']) {
    console.log(`  [dry run] ${title ? `title → ${title}\n` : ''}${body.replace(/^/gm, '  | ')}`)
    return true
  }
  await cli(['edit', card.id, '--body', body, ...(title ? ['--title', title] : [])])
  // Once per card: a re-run (label removed) doesn't post them again.
  const posted = (heading) =>
    (card.comments || []).some((comment) => comment.text.startsWith(`**${heading}**`))
  if (post.caption && !post.page && !posted('Original caption')) {
    await cli(['comment', card.id, '-'], clip(`**Original caption**\n\n${post.caption}`))
  }
  if (post.transcript && !posted('Transcript')) {
    await cli(['comment', card.id, '-'], clip(`**Transcript**\n\n${post.transcript}`))
  }
  await cli(['label', card.id, 'add', label])
  console.log(`  ✓ enriched${title ? ` · title: ${title}` : ''}`)
  return true
}

const state = JSON.parse(await cli(['board', '--json']))
const enrichedLabel = state.labels.find((entry) => entry.name.toLowerCase() === label.toLowerCase())
const todo = state.cards.filter(
  (card) =>
    !card.archived &&
    !card.template &&
    (!options.card || card.id.startsWith(options.card)) &&
    // Enriched cards come back only while their title is still noisy.
    (!(enrichedLabel && card.labelIds?.includes(enrichedLabel.id)) || noisyTitle(card.title)) &&
    (card.source?.url || /https?:\/\//.test(card.body || ''))
)
console.log(`${state.board?.name || board}: ${todo.length} card(s) to enrich`)

let done = 0
for (const card of todo.slice(0, limit)) {
  if (treg.spentMicro / 1e6 >= maxUsd) {
    console.warn(
      `\nStopped: treg charges reached $${(treg.spentMicro / 1e6).toFixed(4)} (ENRICH_MAX_USD ${maxUsd}).`
    )
    break
  }
  try {
    if (await enrich(card, state.profiles || {})) done++
  } catch (err) {
    console.error(`  ✗ ${err.message}`)
  }
}
console.log(`\n${done} enriched · treg charged $${(treg.spentMicro / 1e6).toFixed(4)}`)

// Boards sync only while two members are online together: stay on the board for
// a while so devices that are open can pull the changes. Run `opencollab watch`
// or a blind peer to keep them available for longer.
if (done && linger > 0 && !options['dry-run']) {
  console.log(`Staying online ${linger}s so open devices can sync…`)
  const storage = process.env.ENRICH_STORAGE ? ['-s', process.env.ENRICH_STORAGE] : []
  const watch = spawn(process.execPath, [bin, 'watch', ...storage, '--board', board], {
    stdio: ['ignore', 'inherit', 'inherit']
  })
  setTimeout(() => watch.kill('SIGINT'), linger * 1000)
  await new Promise((resolve) => watch.on('close', resolve))
}
