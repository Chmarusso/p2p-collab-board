// Markdown for card descriptions and comments. Card text comes from other
// peers and this page can drive the worker, so the HTML is always sanitized:
// raw HTML in the source is shown as text, remote images are dropped (they
// would leak the reader's IP), and links are limited to http(s) and mailto.
// `![alt](image:<key>)` points at one of the card's own encrypted attachments;
// it becomes a placeholder the app fills from its image cache.
import { Marked } from '../node_modules/marked/lib/marked.esm.js'
import DOMPurify from '../node_modules/dompurify/dist/purify.es.mjs'
import hljs from '../node_modules/@highlightjs/cdn-assets/es/core.min.js'
import bash from '../node_modules/@highlightjs/cdn-assets/es/languages/bash.min.js'
import css from '../node_modules/@highlightjs/cdn-assets/es/languages/css.min.js'
import diff from '../node_modules/@highlightjs/cdn-assets/es/languages/diff.min.js'
import go from '../node_modules/@highlightjs/cdn-assets/es/languages/go.min.js'
import javascript from '../node_modules/@highlightjs/cdn-assets/es/languages/javascript.min.js'
import json from '../node_modules/@highlightjs/cdn-assets/es/languages/json.min.js'
import markdown from '../node_modules/@highlightjs/cdn-assets/es/languages/markdown.min.js'
import python from '../node_modules/@highlightjs/cdn-assets/es/languages/python.min.js'
import rust from '../node_modules/@highlightjs/cdn-assets/es/languages/rust.min.js'
import sql from '../node_modules/@highlightjs/cdn-assets/es/languages/sql.min.js'
import typescript from '../node_modules/@highlightjs/cdn-assets/es/languages/typescript.min.js'
import xml from '../node_modules/@highlightjs/cdn-assets/es/languages/xml.min.js'
import yaml from '../node_modules/@highlightjs/cdn-assets/es/languages/yaml.min.js'

const languages = {
  bash,
  css,
  diff,
  go,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml
}
for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language)

const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ href, text }) =>
      href?.startsWith('image:')
        ? `<span class="md-image" data-image="${escapeHtml(href.slice(6))}" data-alt="${escapeHtml(text || '')}"></span>`
        : escapeHtml(text),
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s/)[0].toLowerCase()
      const known = language && hljs.getLanguage(language)
      // Auto-detection is slow and unreliable on long blocks; skip it there.
      const result = known
        ? hljs.highlight(text, { language, ignoreIllegals: true })
        : text.length < 5000
          ? hljs.highlightAuto(text)
          : { value: escapeHtml(text) }
      return `<pre><code class="hljs">${result.value}</code></pre>`
    }
  }
})

const purify = DOMPurify(window)
purify.addHook('afterSanitizeAttributes', (node) => {
  // Task lists (`- [ ]`) are the only inputs kept, and only as read-only boxes.
  if (node.tagName === 'INPUT') {
    if (node.getAttribute('type') === 'checkbox') node.setAttribute('disabled', '')
    else node.remove()
  }
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})
const SANITIZE = {
  FORBID_TAGS: ['img', 'style', 'form', 'button', 'textarea', 'select', 'svg', 'math'],
  FORBID_ATTR: ['style', 'id', 'name'],
  // DOMPurify's default minus the extra schemes. Values without a scheme must
  // still pass: the pattern is also applied to attributes like `type`.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
}

// `mentions` maps display names to identity keys for the members the text
// mentions; matching `@Name` text becomes a highlighted chip.
export function renderMarkdown(text, { mentions = [], self = '' } = {}) {
  const template = document.createElement('template')
  template.innerHTML = purify.sanitize(marked.parse(text || ''), SANITIZE)
  if (mentions.length) highlightMentions(template.content, mentions, self)
  return template.content
}

function highlightMentions(root, mentions, self) {
  // Longest names first, so "Ann Lee" wins over "Ann".
  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length)
  const pattern = new RegExp(
    `@(${sorted.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w])`,
    'g'
  )
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement?.closest('code, pre, a')) nodes.push(walker.currentNode)
  }
  for (const node of nodes) {
    const text = node.nodeValue
    pattern.lastIndex = 0
    if (!pattern.test(text)) continue
    pattern.lastIndex = 0
    const fragment = document.createDocumentFragment()
    let last = 0
    for (const match of text.matchAll(pattern)) {
      fragment.append(text.slice(last, match.index))
      const mention = sorted.find((m) => m.name === match[1])
      const chip = document.createElement('span')
      chip.className = mention.identity === self ? 'mention mention-me' : 'mention'
      chip.title = mention.identity
      chip.textContent = match[0]
      fragment.append(chip)
      last = match.index + match[0].length
    }
    fragment.append(text.slice(last))
    node.replaceWith(fragment)
  }
}

// Identity keys of the members whose `@Name` appears in `text`. Longest names
// match first and are blanked out, so "@Ann Lee" doesn't also mention "Ann".
export function findMentions(text, profiles) {
  const found = new Set()
  let rest = text || ''
  const members = Object.entries(profiles).sort((a, b) => b[1].length - a[1].length)
  for (const [identity, name] of members) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(^|[^\\w])@${escaped}(?![\\w])`, 'g')
    if (!pattern.test(rest)) continue
    found.add(identity)
    rest = rest.replace(pattern, '$1 ')
  }
  return [...found]
}
