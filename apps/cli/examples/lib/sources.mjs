// Shared by the example bots (recipe-enricher, feed-shorts): running the
// OpenCollab CLI, calling treg, reading a shared post (caption, description,
// transcript) and asking a model command.
import { execFile, spawn } from 'node:child_process'
import path from 'node:path'

export function run(file, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) =>
      err
        ? reject(
            Object.assign(
              new Error(`${path.basename(file)} ${args[0]}: ${stderr || err.message}`),
              {
                stdout
              }
            )
          )
        : resolve(stdout)
    )
    child.stdin.end(input || '')
  })
}

// One CLI command on a bot's storage and board; `input` goes to stdin.
export function makeCli({ bin, storage, board }) {
  const extra = [...(storage ? ['-s', storage] : []), '--board', board, '-w', '5']
  return (args, input) => run(process.execPath, [bin, ...args, ...extra], input)
}

// Shows members what the bot is doing ("Making key points" on a card) while it
// reads and thinks; the apps show it live. Stop it before the next CLI command:
// it holds the storage.
export function makeStatus({ bin, storage, board }) {
  return (text, cardId) => {
    const child = spawn(
      process.execPath,
      [
        bin,
        'status',
        text,
        ...(cardId ? ['--card', cardId] : []),
        ...(storage ? ['-s', storage] : []),
        '--board',
        board
      ],
      { stdio: 'ignore' }
    )
    const closed = new Promise((resolve) => child.on('close', resolve))
    return {
      async stop() {
        if (child.exitCode === null) child.kill('SIGINT')
        await closed
      }
    }
  }
}

// treg calls with a running total of what they cost.
export function makeTreg(bin = process.env.TREG_BIN || 'treg') {
  const treg = {
    spentMicro: 0,
    // The provider's answer; null when it had nothing (failed calls aren't billed).
    async call(id, request = {}, extraArgs = []) {
      const args = ['--json', 'call', id, ...extraArgs]
      for (const [key, value] of Object.entries(request.query || {})) {
        args.push('--query', `${key}=${value}`)
      }
      if (request.body) args.push('--method', 'POST', '--data', JSON.stringify(request.body))
      let answer
      try {
        // treg exits non-zero on a provider error but still prints its answer.
        const stdout = await run(bin, args).catch((err) => err.stdout || Promise.reject(err))
        answer = JSON.parse(stdout.trim().split('\n').pop())
      } catch (err) {
        console.warn(`  ! ${id}: ${err.message.trim().split('\n')[0]}`)
        return null
      }
      treg.spentMicro += answer._treg?.charged_micro || 0
      if (answer._treg?.http_status >= 300) {
        const result = answer.result
        console.warn(`  · ${id}: ${result?.message || result?.error || answer._treg.http_status}`)
        return null
      }
      return answer.result ?? answer
    }
  }
  return treg
}

// The longest string under any of `keys`, anywhere in a provider's answer: routed
// tools are served by different providers, each with its own shape.
export function longestAt(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return ''
  let best = ''
  for (const [key, child] of Object.entries(value)) {
    const found =
      typeof child === 'string' && keys.includes(key) ? child : longestAt(child, keys, depth + 1)
    if (found.length > best.length) best = found
  }
  return best
}

// Transcript text from VTT, a list of timed segments, or a provider's own shape.
export function transcriptOf(result) {
  if (!result) return ''
  const segments = result.output?.data?.segments
  if (Array.isArray(segments)) return segments.map((s) => s.text).join(' ')
  const text = longestAt(result, ['transcript', 'text'])
  return text
    .replace(/^WEBVTT.*$/m, '')
    .replace(/^\d{2}:\d{2}[:.\d]* --> .*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

export function platformOf(url) {
  const host = url.replace(/^https?:\/\//, '')
  if (/(^|\.)tiktok\.com\//i.test(host)) return 'tiktok'
  if (/(^|\.)instagram\.com\//i.test(host)) return 'instagram'
  if (/(^|\.)(youtube\.com|youtu\.be)\//i.test(host)) return 'youtube'
  if (/^(www\.|mobile\.)?(x|twitter)\.com\/.+\/status\/\d+/i.test(host)) return 'x'
  if (/^open\.spotify\.com\/(intl-[\w-]+\/)?episode\/\w+/i.test(host)) return 'spotify'
  return 'web'
}

// Caption/description and transcript of the post behind `url`.
export async function fetchPost(treg, url) {
  switch (platformOf(url)) {
    case 'tiktok': {
      const detail = await treg.call('treg.tiktok.video.detail', { body: { url } })
      const transcript = await treg.call('anyapi.tiktok.video.captions', { body: { url } })
      return {
        caption: longestAt(detail, ['desc', 'description']),
        transcript: transcriptOf(transcript)
      }
    }
    case 'instagram': {
      const detail = await treg.call('treg.instagram.post.detail', { body: { url } })
      const transcript = await treg.call('scrapecreators.x.v2-instagram-media-transcript', {
        query: { url }
      })
      return {
        caption: longestAt(detail, ['caption', 'text']),
        transcript: transcriptOf(transcript)
      }
    }
    case 'youtube': {
      const detail = await treg.call('treg.youtube.video.detail', { body: { url } })
      const transcript = await treg.call('anyapi.youtube.video_transcript', { body: { url } })
      const title = longestAt(detail, ['title'])
      const description = longestAt(detail, ['description'])
      return {
        caption: [title, description].filter(Boolean).join('\n\n'),
        transcript: transcriptOf(transcript)
      }
    }
    case 'x': {
      // This reader also returns X Articles in full, not just the post's teaser.
      const detail = await treg.call('scrapecreators.x.v1-twitter-tweet', { query: { url } })
      const article = detail?.article?.article_results?.result
      const text =
        detail?.note_tweet?.note_tweet_results?.result?.text || detail?.legacy?.full_text || ''
      const media = detail?.legacy?.extended_entities?.media || []
      const transcript = media.some((item) => item.type === 'video')
        ? await treg.call('anyapi.twitter.tweet_transcript', { body: { url } })
        : null
      return {
        caption: [
          text,
          article?.title,
          ...(article?.content_state?.blocks || []).map((block) => block.text)
        ]
          .filter(Boolean)
          .join('\n\n'),
        transcript: transcriptOf(transcript)
      }
    }
    case 'spotify':
      return spotifyEpisode(treg, url)
    default: {
      const page = await treg.call('treg.web.extract', { body: { url } })
      // The whole page: read, but not kept as a comment (the card links to it).
      return {
        caption: longestAt(page, ['markdown', 'content', 'text']).slice(0, 20000),
        transcript: '',
        page: true
      }
    }
  }
}

// The picture a page shows in link previews (og:image), or ''.
export async function pageImage(url) {
  const html = (await getText(url)).slice(0, 600000)
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/(property|name)=["'](og:image|twitter:image)["']/i.test(tag)) continue
    const image = tag.match(/content=["']([^"']+)["']/i)?.[1]
    if (image) return new URL(image.replace(/&amp;/g, '&'), url).href
  }
  return ''
}

// The words of a title, for telling whether two titles name the same episode.
const wordsOf = (text) =>
  new Set(
    (text || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((word) => word.length > 1)
  )
// How much of `title` the other title shares, 0 to 1.
function overlap(title, other) {
  const words = wordsOf(title)
  if (!words.size) return 0
  const theirs = wordsOf(other)
  return [...words].filter((word) => theirs.has(word)).length / words.size
}

// Sites such as Spotify send their link-preview tags only to crawlers they know,
// so pages are fetched as one (the app's share sheet does the same).
const CRAWLER = 'facebookexternalhit/1.1'

async function getText(url) {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': CRAWLER },
      signal: AbortSignal.timeout(30000)
    })
    return response.ok ? await response.text() : ''
  } catch {
    return ''
  }
}

// A Spotify episode, cheapest source first. Spotify has no transcript to sell,
// and most podcasts are also on Apple Podcasts, in an RSS feed and on YouTube:
//   1. Spotify's embed page (free): the title, the show and the length,
//   2. Apple Podcasts search (free): the show notes and the show's RSS feed,
//   3. the feed's own transcript, when the host publishes one (free),
//   4. the same episode on YouTube (~$0.004): its transcript,
//   5. only with no show notes from 2: Spotify's own data through treg (~$0.002).
async function spotifyEpisode(treg, url) {
  const id = url.match(/episode\/(\w+)/)[1]
  const html = await getText(`https://open.spotify.com/embed/episode/${id}`)
  const data = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)?.[1]
  let entity = {}
  try {
    entity = JSON.parse(data).props.pageProps.state.data.entity || {}
  } catch {}
  let title = entity.title || entity.name || ''
  const show = entity.subtitle || ''
  const seconds = (entity.duration || 0) / 1000
  if (!title) {
    // oEmbed has the title too, though not the show.
    try {
      title = JSON.parse(await getText(`https://open.spotify.com/oembed?url=${url}`)).title || ''
    } catch {}
  }
  // Nothing to search for: none of the sources below can find the episode.
  if (!title) {
    console.warn('  · Spotify: no title for this episode')
    return { caption: '', transcript: '' }
  }

  let notes = ''
  let transcript = ''
  const episode = await appleEpisode(title, show)
  notes = (episode?.description || '').trim()
  if (episode?.feedUrl) transcript = await feedTranscript(episode.feedUrl, title)
  if (transcript) console.log('  transcript from the podcast feed')
  if (!transcript) {
    const video = await youtubeMatch(treg, title, show, seconds)
    if (video) {
      console.log(`  same episode on YouTube: ${video}`)
      transcript = transcriptOf(
        await treg.call('anyapi.youtube.video_transcript', { body: { url: video } })
      )
    }
  }
  if (!notes) {
    const found = await treg.call('scrapecreators.x.v1-spotify-search', {
      query: { query: [show, title].filter(Boolean).join(' ') }
    })
    const episode = (found?.episodes || []).find((item) => item.id === id)
    notes = (episode?.description || '').trim()
  }
  // The episode's own picture (16:9 on video podcasts), else the show's cover.
  const largest = (images) =>
    [...(images || [])].sort((a, b) => (b.maxWidth || 0) - (a.maxWidth || 0))[0]?.url
  return {
    caption: [title, show && `Podcast: ${show}`, notes].filter(Boolean).join('\n\n'),
    transcript,
    image: largest(entity.videoThumbnailImage) || largest(entity.relatedEntityCoverArt)
  }
}

// The episode on Apple Podcasts: show notes and the show's feed.
async function appleEpisode(title, show) {
  const term = encodeURIComponent(`${show} ${title}`.slice(0, 200))
  const text = await getText(
    `https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=10&term=${term}`
  )
  let results = []
  try {
    results = JSON.parse(text).results || []
  } catch {}
  const score = (item) =>
    overlap(title, item.trackName) + (show ? overlap(show, item.collectionName) / 2 : 0)
  const best = results.sort((a, b) => score(b) - score(a))[0]
  return best && overlap(title, best.trackName) >= 0.7 ? best : null
}

// The transcript a podcast host publishes in its feed (<podcast:transcript>).
async function feedTranscript(feedUrl, title) {
  const feed = await getText(feedUrl)
  const item = feed
    .split(/<item[\s>]/)
    .slice(1)
    .find((entry) => {
      const name = entry.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]
      return name && overlap(title, name) >= 0.8
    })
  const links = [...(item || '').matchAll(/<podcast:transcript\b[^>]*>/g)].map((tag) => ({
    url: tag[0].match(/url="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&'),
    type: tag[0].match(/type="([^"]+)"/)?.[1] || ''
  }))
  const order = [
    'text/plain',
    'text/vtt',
    'application/x-subrip',
    'application/srt',
    'application/json'
  ]
  const rank = (link) => order.indexOf(link.type) + 1 || order.length + 1
  for (const link of links.filter((entry) => entry.url).sort((a, b) => rank(a) - rank(b))) {
    const body = await getText(link.url)
    if (!body) continue
    if (link.type === 'application/json') {
      try {
        return JSON.parse(body)
          .segments.map((segment) => segment.body)
          .join(' ')
      } catch {
        continue
      }
    }
    if (/html/.test(link.type)) continue
    return body
      .replace(/\r/g, '')
      .replace(/^WEBVTT.*$/m, '')
      .replace(/^\d+\s*$/gm, '')
      .replace(/^[\d:.,]+ --> .*$/gm, '')
      .replace(/\n{2,}/g, '\n')
      .trim()
  }
  return ''
}

// The full episode on YouTube: a similar title (channels often retitle an
// episode), the same show and about the same length, so not a clip. A video
// listed without its length or channel is looked up (~$0.001, at most two).
async function youtubeMatch(treg, title, show, seconds) {
  // This provider, called directly, ranks by relevance and returns each video's
  // length and channel; the routed search sometimes fell to one that didn't.
  const found = await treg.call('tikhub.youtube.search.videos', {
    query: {
      keyword: [show, title].filter(Boolean).join(' ').slice(0, 200),
      type: 'video',
      ...(seconds > 20 * 60 ? { duration: 'long' } : {})
    }
  })
  const lengthOf = (video) => {
    if (Number(video.duration_seconds || video.lengthSeconds)) {
      return Number(video.duration_seconds || video.lengthSeconds)
    }
    return String(video.duration || video.video_length || '')
      .split(':')
      .reduce((total, part) => total * 60 + Number(part), 0)
  }
  const channelOf = (video) => video.author || video.channel || video.channel_name || ''
  const sameShow = (video) => !show || overlap(show, `${video.title} ${channelOf(video)}`) >= 0.5
  const verdict = (video) => {
    const length = lengthOf(video)
    if (seconds && length) return Math.abs(length - seconds) <= seconds * 0.15 && sameShow(video)
    // No length to compare: a near-identical title from the show itself.
    if (channelOf(video)) return overlap(title, video.title) >= 0.7 && sameShow(video)
    return null
  }
  const urlOf = (video) => video.url || `https://www.youtube.com/watch?v=${video.video_id}`
  const candidates = (found?.data?.videos || found?.output?.videos || [])
    .filter((video) => overlap(title, video.title) >= 0.5)
    .sort((a, b) => overlap(title, b.title) - overlap(title, a.title))
  let lookups = 0
  for (const video of candidates) {
    let answer = verdict(video)
    if (answer === null && lookups < 2) {
      lookups++
      const detail = await treg.call('treg.youtube.video.detail', { body: { url: urlOf(video) } })
      answer = verdict({ ...video, ...(detail?.output || {}) })
    }
    if (answer) return urlOf(video)
  }
  return null
}

// Pipes `prompt` into a model command (e.g. `claude -p`) and returns its answer.
export function ask(command, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let errors = ''
    child.stdout.on('data', (data) => (out += data))
    // Shown only if the command fails: model CLIs print notices there.
    child.stderr.on('data', (data) => (errors += data))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(new Error(`${command} exited with ${code}: ${errors.trim()}`))
    )
    child.stdin.end(prompt)
  })
}
