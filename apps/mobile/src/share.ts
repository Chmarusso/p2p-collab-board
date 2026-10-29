// Text and links shared to OpenCollab from other apps (the Share menu).
// Android (plugins/share-target.js) and the iOS share extension
// (ios/OpenCollabShare) both turn a share into an opencollab://share link.

// `link` is the first link in the text; `titleFromLink` marks a title made
// from its address, which the page's own title can replace.
export type SharedItem = { title: string; body: string; link?: string; titleFromLink?: boolean }

// Which boards show in the Share menu and where their cards go. Kept on this
// device only, per identity, keyed by the board's normalized invite.
export type SharePref = { hidden?: boolean; columnId?: string | null }
export type SharePrefs = { last?: string; boards: Record<string, SharePref> }

export const sharePrefsKey = (identity: string) => `opencollab.share-boards.${identity}`

const TITLE_MAX = 120
const BODY_MAX = 20000
const URL_PATTERN = /https?:\/\/\S+/gi

// Apps share differently: YouTube and browsers send the title as the subject
// and the link as text, X and Instagram send "comment + link" or the link
// alone. The title is the subject, else the text without its links, else the
// link's address; the body keeps the full text so the link survives.
export function parseShare(url: string | null): SharedItem | null {
  if (!url || !/^opencollab:\/\/share\b/i.test(url)) return null
  const params = query(url)
  const text = (params.text || '').trim()
  const subject = (params.subject || '').trim()
  if (!text && !subject) return null
  const links = text.match(URL_PATTERN) || []
  const words =
    text
      .replace(URL_PATTERN, ' ')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .find(Boolean) || ''
  const title = subject || words || (links[0] ? address(links[0]) : '') || 'Shared link'
  const body = text && text !== subject ? text : ''
  return {
    title: clip(title, TITLE_MAX),
    body: body.slice(0, BODY_MAX),
    link: links[0],
    titleFromLink: !subject && !words && !!links[0]
  }
}

export type LinkPreview = { title?: string; description?: string; image?: string; site?: string }

// Instagram and some others only return their preview tags to link-preview
// crawlers; with this user agent they answer like they do for chat apps.
const PREVIEW_AGENT = 'facebookexternalhit/1.1'
const PREVIEW_TIMEOUT = 8000

// The page's Open Graph title, description and image, fetched from this
// device. Empty when the page can't be read: the card keeps the link anyway.
export async function fetchPreview(link: string): Promise<LinkPreview> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT)
  try {
    const response = await fetch(link, {
      headers: { 'User-Agent': PREVIEW_AGENT, Accept: 'text/html' },
      signal: controller.signal
    })
    if (!response.ok || !/html/i.test(response.headers.get('content-type') || '')) return {}
    const tags = metaTags((await response.text()).slice(0, 600000))
    const image = tags['og:image'] || tags['twitter:image']
    return {
      title: tags['og:title'] || tags['twitter:title'],
      site: tags['og:site_name'],
      description: tags['og:description'] || tags['twitter:description'] || tags.description,
      image: image ? absolute(image, response.url || link) : undefined
    }
  } catch {
    return {}
  } finally {
    clearTimeout(timer)
  }
}

// <meta property|name="…" content="…"> pairs, attributes in any order; the
// first value of each name wins.
function metaTags(html: string) {
  const tags: Record<string, string> = {}
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes: Record<string, string> = {}
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes[match[1].toLowerCase()] = match[2] ?? match[3]
    }
    const name = (attributes.property || attributes.name || '').toLowerCase()
    const content = decodeEntities(attributes.content || '').trim()
    if (name && content && !(name in tags)) tags[name] = content
  }
  return tags
}

function decodeEntities(text: string) {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity
    const point =
      code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity
  })
}

function absolute(url: string, page: string) {
  if (/^https?:\/\//i.test(url)) return url
  if (url.startsWith('//')) return `https:${url}`
  const origin = page.match(/^https?:\/\/[^/]+/i)?.[0] || ''
  return url.startsWith('/') ? origin + url : `${page.replace(/[^/]*$/, '')}${url}`
}

// The shared item with the page's preview: its title when the share had none,
// its description above the link, unless the user already edited them.
export function withPreview(item: SharedItem, preview: LinkPreview): SharedItem {
  const title = item.titleFromLink && preview.title ? clip(preview.title, TITLE_MAX) : item.title
  const description = preview.description?.slice(0, Math.max(0, BODY_MAX - item.body.length - 2))
  const body =
    description && !item.body.includes(description)
      ? `${description}\n\n${item.body || item.link || ''}`.trim()
      : item.body
  return { ...item, title, body }
}

// React Native's URL doesn't implement searchParams or host, so parse by hand.
function query(url: string) {
  const params: Record<string, string> = {}
  for (const pair of url.split('?').slice(1).join('?').split('&')) {
    const [key, ...value] = pair.split('=')
    try {
      params[decodeURIComponent(key)] = decodeURIComponent(value.join('=').replace(/\+/g, ' '))
    } catch {}
  }
  return params
}

const address = (link: string) =>
  link
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')

function clip(text: string, max: number) {
  const line = text.split('\n')[0].trim()
  if (line.length <= max) return line
  const cut = line.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2))}…`
}

export function readSharePrefs(saved: string | null): SharePrefs {
  try {
    const parsed = saved ? JSON.parse(saved) : null
    if (parsed && typeof parsed.boards === 'object') return parsed
  } catch {}
  return { boards: {} }
}
