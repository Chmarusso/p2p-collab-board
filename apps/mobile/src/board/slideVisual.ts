// What a slide shows besides its text. The deck's writer
// (apps/cli/examples/feed-slides.mjs) ends a slide with one `▸ kind: …` line,
// fields separated by ` | `; without the app it reads as a plain note.
export type VersusSide = { label: string; points: string[] }
export type Visual =
  | { type: 'stat'; value: string; label: string; compare: string }
  | { type: 'versus'; left: VersusSide; right: VersusSide }
  | { type: 'flow'; nodes: string[]; note: string }
  | { type: 'layers'; layers: string[]; note: string }
  | { type: 'quote'; text: string; who: string; at: string }
  // The card's nth image, counted from 1.
  | { type: 'picture'; index: number }

const VISUAL_LINE = /^\s*▸\s*(\w+):\s*(.+)$/
const parts = (text: string, separator: RegExp) =>
  text
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean)

// The visual a line stands for; null for ordinary text and for kinds this
// version doesn't know, which then show as the text they are.
export function visualOf(line: string): Visual | null {
  const [, kind, rest] = line.match(VISUAL_LINE) || []
  if (!kind) return null
  const [first = '', second = '', third = ''] = rest.split('|').map((field) => field.trim())
  switch (kind) {
    case 'stat':
      return first ? { type: 'stat', value: first, label: second, compare: third } : null
    case 'versus': {
      const side = (field: string): VersusSide => {
        const colon = field.indexOf(':')
        return {
          label: field.slice(0, Math.max(colon, 0)).trim(),
          points: parts(field.slice(colon + 1), /;/)
        }
      }
      const [left, right] = [side(first), side(second)]
      return left.points.length && right.points.length ? { type: 'versus', left, right } : null
    }
    case 'flow': {
      const nodes = parts(first, /→/)
      return nodes.length > 1 ? { type: 'flow', nodes, note: second } : null
    }
    case 'layers': {
      const layers = parts(first, / \/ /)
      return layers.length > 1 ? { type: 'layers', layers, note: second } : null
    }
    case 'quote':
      return first ? { type: 'quote', text: first, who: second, at: third } : null
    case 'picture':
      return /^\d+$/.test(first) ? { type: 'picture', index: Number(first) } : null
    default:
      return null
  }
}

// A slide's lines without its visual line, and the visual.
export function splitVisual(lines: string[]): { lines: string[]; visual: Visual | null } {
  const at = lines.findIndex((line) => visualOf(line))
  if (at < 0) return { lines, visual: null }
  return { lines: lines.filter((_, index) => index !== at), visual: visualOf(lines[at]) }
}

// The words in a visual, for how long its slide stays up.
export function visualWords(visual: Visual | null): string[] {
  switch (visual?.type) {
    case 'stat':
      return [visual.value, visual.label, visual.compare]
    case 'versus':
      return [visual.left.label, ...visual.left.points, visual.right.label, ...visual.right.points]
    case 'flow':
      return [...visual.nodes, visual.note]
    case 'layers':
      return [...visual.layers, visual.note]
    case 'quote':
      return [visual.text, visual.who]
    default:
      return []
  }
}

// `12:34` or `1:02:03` in seconds; 0 when it isn't a time.
export function secondsOf(clock: string) {
  if (!/^\d+(:\d{2}){1,2}$/.test(clock)) return 0
  return clock.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

// The link that opens a YouTube video at `clock`; any other link as it is.
export function linkAt(url: string, clock: string) {
  const seconds = secondsOf(clock)
  if (!seconds || !/^https?:\/\/([\w-]+\.)?(youtube\.com|youtu\.be)\//i.test(url)) return url
  const base = url
    .split('#')[0]
    .replace(/([?&])t=[^&]*&?/, '$1')
    .replace(/[?&]$/, '')
  return `${base}${base.includes('?') ? '&' : '?'}t=${seconds}s`
}
