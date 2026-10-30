// Feed shorts: turns new posts on a Feed board into vertical shorts (≤ 90 s)
// that members watch one after another in the app's Shorts player. For every
// recent post that has no short yet, it
//
//   1. gathers material: the post and its comments, the shared page or video
//      (caption, description, transcript) and facts about the topic, through
//      treg,
//   2. has a model command (`claude -p` by default) write a script: a hook, the
//      key points and a wrap-up, in scenes,
//   3. records one voiceover for the script (with word timings), picks a picture
//      per scene (the post's own images, or AI-generated ones) and renders a
//      1080×1920 video with ffmpeg: slow zoom on each picture, burned captions,
//   4. posts it to the board as a card labelled `short`, linked to the post, and
//      labels the post `shorted`.
//
// Run it from cron or a systemd timer. It stays on the board for a while after
// posting so devices that are open can sync the video.
//
//   OPENCOLLAB_PASSWORD=... SHORTS_BOARD="Family news" \
//   node apps/cli/examples/feed-shorts.mjs [--dry-run] [--limit 2] [--card <id>]
//
// SHORTS_BOARD      board name or number (required; a Feed board)
// SHORTS_STORAGE    CLI storage of the identity that posts the shorts (default: the CLI's)
// SHORTS_COMMAND    reads a prompt on stdin, prints the answer (default: claude -p)
// SHORTS_LANGUAGE   language of the short (default: the post's own)
// SHORTS_VOICE      MiniMax voice id (default: English_expressive_narrator; it speaks
//                   any supported language)
// SHORTS_DAYS       only posts added in the last N days (default: 14)
// SHORTS_MAX_USD    stop once treg charges pass this (default: 0.50)
// SHORTS_LINGER     seconds to stay online after posting (default: 300; 0 skips it)
// --dry-run renders the video into SHORTS_WORKDIR (default: a temp folder) and
// posts nothing. Needs ffmpeg and ffprobe on the PATH.
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { ask as askModel, fetchPost, makeCli, makeTreg, run } from './lib/sources.mjs'

const { values: options } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    limit: { type: 'string' },
    card: { type: 'string' }
  }
})
const board = process.env.SHORTS_BOARD
if (!board || !process.env.OPENCOLLAB_PASSWORD) {
  console.error('Set SHORTS_BOARD and OPENCOLLAB_PASSWORD.')
  process.exit(1)
}
const bin = process.env.OPENCOLLAB_BIN || path.join(import.meta.dirname, '..', 'bin.js')
const storage = process.env.SHORTS_STORAGE
const modelCommand = process.env.SHORTS_COMMAND || 'claude -p'
const language = process.env.SHORTS_LANGUAGE || 'the same language as the post'
const voice = process.env.SHORTS_VOICE || 'English_expressive_narrator'
const days = Number(process.env.SHORTS_DAYS || 14)
const maxUsd = Number(process.env.SHORTS_MAX_USD || 0.5)
const linger = Number(process.env.SHORTS_LINGER ?? 300)
const limit = options.limit ? Number(options.limit) : 3
const SHORT_LABEL = 'short'
const DONE_LABEL = 'shorted'
const MAX_SECONDS = 90
const WIDTH = 1080
const HEIGHT = 1920
const FPS = 30
// MiniMax's language_boost values for the languages a short is likely in.
const VOICE_LANGUAGES = [
  'English',
  'Polish',
  'German',
  'French',
  'Spanish',
  'Italian',
  'Portuguese',
  'Dutch',
  'Czech',
  'Slovak',
  'Ukrainian',
  'Russian',
  'auto'
]

const treg = makeTreg()
const cli = makeCli({ bin, storage, board })
const ask = (prompt) => askModel(modelCommand, prompt)
const workdir =
  process.env.SHORTS_WORKDIR || (await fs.mkdtemp(path.join(os.tmpdir(), 'feed-shorts-')))

// ---------- material ----------

const OWN_COMMENTS = /^\*\*(Original caption|Transcript)\*\*/

async function gather(card, profiles) {
  const link = card.source?.url || card.body?.match(/https?:\/\/\S+/)?.[0]
  const post = link ? await fetchPost(treg, link) : { caption: '', transcript: '' }
  const comments = (card.comments || [])
    .filter((comment) => !OWN_COMMENTS.test(comment.text))
    .map((comment) => `${profiles[comment.author] || 'A member'}: ${comment.text}`)
    .join('\n')
  // A few facts about the topic from the web, so the short says more than the post.
  const query = `${card.title} ${post.caption.slice(0, 120)}`.replace(/[#@]\S+/g, '').trim()
  const search = await treg.call('treg.web.search', { body: { q: query.slice(0, 200), limit: 6 } })
  const facts = (search?.output?.results || [])
    .slice(0, 6)
    .map((result) => `- ${result.title}: ${result.snippet} (${result.url})`)
    .join('\n')
  return { link, ...post, comments, facts }
}

// The card's own pictures (shared previews, photos), downloaded from the board.
async function postImages(card, dir) {
  const images = (card.images || []).filter((ref) => ref.type?.startsWith('image/'))
  if (!images.length) return []
  await fs.mkdir(dir, { recursive: true })
  await cli(['images', card.id, '--out', dir]).catch(() => {})
  const files = await fs.readdir(dir).catch(() => [])
  return files
    .filter((file) => /\.(jpe?g|png|webp|gif)$/i.test(file))
    .map((file) => path.join(dir, file))
}

// ---------- script ----------

function scriptPrompt(card, material, pictures) {
  return [
    `Write the script of a vertical short video (like a TikTok or Reel) about the post below, in ${language}.`,
    'It is watched by the members of a private board who shared it, so make it useful and lively, not salesy.',
    'Use only what the sources say; the web facts may add context, but skip anything doubtful.',
    'Spell everything correctly in that language, with all its diacritics (e.g. ą, ę, ł, ó, ś, ż in Polish), the title included.',
    'Length: 120–190 spoken words in total (60–85 seconds), in 5–8 scenes. Scene 1 is a hook of one or two short sentences.',
    'The last scene wraps up (a takeaway or a question to the members). No hashtags, emoji, links or "link in bio" in the narration.',
    `Each scene gets a picture: "post" uses one of the post's own ${pictures} picture(s)` +
      (pictures ? '' : ' (there are none, so always use "generate")') +
      ', "generate" asks for a new one; give an English image prompt for those (photographic, no text in the image, vertical).',
    `voice_language is the language of the narration, one of: ${VOICE_LANGUAGES.join(', ')}.`,
    'Answer with JSON only, in exactly this shape:',
    '{"title": "<plain title, at most 60 characters, no emoji or quotes>", "summary": "<one or two sentences for the card>", "voice_language": "<one of the list>", "scenes": [{"text": "<what the narrator says>", "picture": "post" | "generate", "prompt": "<image prompt when generate>"}]}',
    '',
    `--- Post title: ${card.title}`,
    card.body?.trim() ? `--- Post description:\n${card.body.trim().slice(0, 4000)}` : '',
    material.caption ? `--- Caption / page:\n${material.caption.slice(0, 8000)}` : '',
    material.transcript ? `--- Transcript:\n${material.transcript.slice(0, 8000)}` : '',
    material.comments ? `--- Members' comments:\n${material.comments}` : '',
    material.facts ? `--- From the web:\n${material.facts}` : ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function parseScript(answer) {
  const json = answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)
  const script = JSON.parse(json)
  script.scenes = (script.scenes || []).filter((scene) => scene.text?.trim()).slice(0, 8)
  if (!script.scenes.length) throw new Error('the script has no scenes')
  script.title = String(script.title || '')
    .replace(/["“”„«»]|\p{Extended_Pictographic}|#\S+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  if (!VOICE_LANGUAGES.includes(script.voice_language)) script.voice_language = 'auto'
  return script
}

// ---------- voice ----------

async function download(url, file) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`download failed (${response.status})`)
  await fs.writeFile(file, Buffer.from(await response.arrayBuffer()))
  return file
}

const probeSeconds = async (file) =>
  Number(
    await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file
    ])
  )

// One recording of the whole narration, with word timings in seconds.
async function voiceover(text, voiceLanguage, dir) {
  const answer = await treg.call('minimax.voice-gen.speech-2-8-turbo', {
    body: {
      model: 'speech-2.8-turbo',
      text,
      stream: false,
      output_format: 'url',
      language_boost: voiceLanguage,
      subtitle_enable: true,
      subtitle_type: 'word',
      voice_setting: { voice_id: voice, speed: 1.05, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }
    }
  })
  const data = answer?.data
  if (!data?.audio) throw new Error('no voiceover')
  const audio = await download(data.audio, path.join(dir, 'voice.mp3'))
  let segments = []
  try {
    segments = await (await fetch(data.subtitle_file)).json()
  } catch {}
  // MiniMax splits words into tokens (and spaces): join them back into words.
  const words = []
  let current = null
  let end = -1
  for (const segment of segments) {
    // Token positions count from the segment's start in the narration.
    const base = segment.text_begin || 0
    for (const token of segment.timestamped_words || []) {
      const begin = base + token.word_begin
      // A gap in the text (a space it didn't send as a token) also starts a word.
      const gap = begin > end
      end = base + token.word_end
      if (!token.word.trim()) {
        current = null
        continue
      }
      if (!current || gap) {
        current = { text: '', start: token.time_begin / 1000, end: 0, offset: begin }
        words.push(current)
      }
      current.text += token.word
      current.end = token.time_end / 1000
    }
  }
  return { audio, seconds: await probeSeconds(audio), words }
}

// ---------- pictures ----------

async function generatePicture(prompt, file) {
  const result = await treg.call(
    'replicate.image-gen.flux-schnell',
    { body: { input: { prompt, aspect_ratio: '9:16', num_outputs: 1, output_format: 'jpg' } } },
    ['--await', '--timeout', '300']
  )
  const url = [result?.output].flat().find((entry) => typeof entry === 'string')
  if (!url) return null
  return download(url, file)
}

// ---------- video ----------

const assText = (text) => text.replace(/[{}\\]/g, '').replace(/\n/g, ' ')
const assTime = (seconds) => {
  const cs = Math.max(0, Math.round(seconds * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

// Captions a few words at a time, broken after punctuation; the title on top
// for the first seconds.
function subtitles(words, title, scale) {
  const lines = []
  let chunk = []
  const flush = () => {
    if (!chunk.length) return
    const start = chunk[0].start / scale
    const end = chunk[chunk.length - 1].end / scale
    lines.push(
      `Dialogue: 0,${assTime(start)},${assTime(end + 0.05)},Caption,,0,0,0,,${assText(chunk.map((w) => w.text).join(' '))}`
    )
    chunk = []
  }
  for (const word of words) {
    chunk.push(word)
    const length = chunk.map((w) => w.text).join(' ').length
    if (chunk.length >= 4 || length >= 22 || /[.!?,:;]$/.test(word.text)) flush()
  }
  flush()
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${WIDTH}`,
    `PlayResY: ${HEIGHT}`,
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Caption,Arial,78,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,2,2,80,80,430,1',
    'Style: Title,Arial,58,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,3,18,0,8,90,90,210,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 1,${assTime(0)},${assTime(3.2)},Title,,0,0,0,,${assText(title)}`,
    ...lines
  ].join('\n')
}

function ffmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let errors = ''
    child.stderr.on('data', (data) => (errors += data))
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg: ${errors.trim().slice(-600)}`))
    )
  })
}

// One picture per scene with a slow zoom, the voiceover, burned captions.
async function render({ scenes, pictures, voice: recording, title }, dir) {
  // Fit 90 s: speed the voice up a little (at most 1.25×) rather than cut it.
  const tail = 0.8
  const scale = Math.min(1.25, Math.max(1, (recording.seconds + tail) / MAX_SECONDS))
  const total = Math.min(MAX_SECONDS, recording.seconds / scale + tail)
  // A scene starts at its first word.
  const starts = scenes.map((scene, index) => {
    if (!index) return 0
    const word = recording.words.find((entry) => entry.offset >= scene.offset)
    return word ? word.start / scale : (total * index) / scenes.length
  })
  const durations = starts.map((start, index) => (starts[index + 1] ?? total) - start)
  await fs.writeFile(path.join(dir, 'subs.ass'), subtitles(recording.words, title, scale))

  const inputs = pictures.flatMap((file) => ['-i', file])
  const chains = pictures.map((_, index) => {
    const frames = Math.max(1, Math.round(durations[index] * FPS))
    const zoom = index % 2 ? `if(eq(on,0),1.14,max(zoom-0.0007,1))` : `min(zoom+0.0007,1.14)`
    return `[${index}:v]scale=${WIDTH * 1.2}:${HEIGHT * 1.2}:force_original_aspect_ratio=increase,crop=${WIDTH * 1.2}:${HEIGHT * 1.2},zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},setsar=1,format=yuv420p[v${index}]`
  })
  const concat = `${pictures.map((_, index) => `[v${index}]`).join('')}concat=n=${pictures.length}:v=1:a=0[scenes]`
  const audio = `[${pictures.length}:a]atempo=${scale.toFixed(4)},apad,atrim=0:${total.toFixed(2)}[voice]`
  const output = path.join(dir, 'short.mp4')
  await ffmpeg(
    [
      ...inputs,
      '-i',
      recording.audio,
      '-filter_complex',
      [...chains, concat, `[scenes]ass=subs.ass[video]`, audio].join(';'),
      '-map',
      '[video]',
      '-map',
      '[voice]',
      '-t',
      total.toFixed(2),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      output
    ],
    dir
  )
  // The card's cover: a frame with the title on it.
  const cover = path.join(dir, 'cover.jpg')
  await ffmpeg(['-ss', '1.2', '-i', output, '-frames:v', '1', '-q:v', '3', cover], dir)
  return { video: output, cover, seconds: total }
}

// ---------- one post ----------

async function makeShort(card, profiles) {
  const dir = path.join(workdir, card.id.slice(-12))
  await fs.mkdir(dir, { recursive: true })
  console.log(`\n▸ ${card.title}`)
  const material = await gather(card, profiles)
  console.log(
    `  caption ${material.caption.length} · transcript ${material.transcript.length} · comments ${material.comments ? material.comments.split('\n').length : 0} · facts ${material.facts ? material.facts.split('\n').length : 0}`
  )
  const own = await postImages(card, path.join(dir, 'post'))
  const script = parseScript(await ask(scriptPrompt(card, material, own.length)))
  // Each scene's place in the narration, to find where its words start.
  let offset = 0
  for (const scene of script.scenes) {
    scene.text = scene.text.trim()
    scene.offset = offset
    offset += scene.text.length + 1
  }
  const narration = script.scenes.map((scene) => scene.text).join(' ')
  console.log(
    `  script: ${script.scenes.length} scenes, ${narration.split(/\s+/).length} words · “${script.title}”`
  )

  const recording = await voiceover(narration, script.voice_language, dir)
  console.log(
    `  voiceover ${recording.seconds.toFixed(1)} s, ${recording.words.length} timed words`
  )

  const pictures = []
  let next = 0
  for (const [index, scene] of script.scenes.entries()) {
    let file = null
    if (scene.picture !== 'generate' && own.length) file = own[next++ % own.length]
    if (!file) {
      const target = path.join(dir, `scene-${index}.jpg`)
      file = await generatePicture(scene.prompt || script.title, target)
    }
    // No picture at all: reuse the previous one, or any the post has.
    pictures.push(file || pictures[index - 1] || own[0])
  }
  if (pictures.some((file) => !file)) throw new Error('no pictures for the scenes')

  const short = await render(
    { scenes: script.scenes, pictures, voice: recording, title: script.title },
    dir
  )
  console.log(`  rendered ${short.seconds.toFixed(1)} s → ${short.video}`)
  if (options['dry-run']) return true

  // The short is its own card: cover picture, video, label, link to the post.
  const startedAt = Date.now()
  await cli(['post', script.title, '--body', script.summary || '', '--image', short.cover])
  const state = JSON.parse(await cli(['board', '--json']))
  const mine = state.cards
    .filter(
      (entry) => entry.title === script.title && Date.parse(entry.createdAt) >= startedAt - 5000
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (!mine) throw new Error('the short card did not appear')
  await cli(['attach', mine.id, short.video])
  await cli(['label', mine.id, 'add', SHORT_LABEL])
  await cli(['link', mine.id, 'relates', card.id]).catch(() => {})
  if (material.link) await cli(['edit', mine.id, '--source', material.link]).catch(() => {})
  await cli(['label', card.id, 'add', DONE_LABEL])
  console.log(`  ✓ posted “${script.title}”`)
  return true
}

// ---------- run ----------

const state = JSON.parse(await cli(['board', '--json']))
if ((state.info?.kind || 'kanban') !== 'feed') {
  console.warn(
    `! "${state.board?.name || board}" is a ${state.info?.kind || 'kanban'} board, not a Feed; going ahead anyway.`
  )
}
const labelId = (name) => state.labels.find((entry) => entry.name.toLowerCase() === name)?.id
const skip = new Set([labelId(SHORT_LABEL), labelId(DONE_LABEL)].filter(Boolean))
const since = Date.now() - days * 24 * 3600 * 1000
const todo = state.cards
  .filter(
    (card) =>
      !card.archived &&
      !card.template &&
      (!options.card || card.id.startsWith(options.card)) &&
      !(card.labelIds || []).some((id) => skip.has(id)) &&
      (options.card || Date.parse(card.createdAt) >= since)
  )
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
console.log(`${state.board?.name || board}: ${todo.length} post(s) without a short`)

let made = 0
for (const card of todo.slice(0, limit)) {
  if (treg.spentMicro / 1e6 >= maxUsd) {
    console.warn(
      `\nStopped: treg charges reached $${(treg.spentMicro / 1e6).toFixed(4)} (SHORTS_MAX_USD ${maxUsd}).`
    )
    break
  }
  try {
    if (await makeShort(card, state.profiles || {})) made++
  } catch (err) {
    console.error(`  ✗ ${err.message}`)
  }
}
console.log(
  `\n${made} short(s) · treg charged $${(treg.spentMicro / 1e6).toFixed(4)} · files in ${workdir}`
)

// Boards sync only while two members are online together: stay a while so
// open devices can pull the videos.
if (made && linger > 0 && !options['dry-run']) {
  console.log(`Staying online ${linger}s so open devices can sync…`)
  const extra = storage ? ['-s', storage] : []
  const watch = spawn(process.execPath, [bin, 'watch', ...extra, '--board', board], {
    stdio: ['ignore', 'inherit', 'inherit']
  })
  setTimeout(() => watch.kill('SIGINT'), linger * 1000)
  await new Promise((resolve) => watch.on('close', resolve))
}
