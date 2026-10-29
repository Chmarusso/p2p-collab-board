import { renderMarkdown, findMentions } from './markdown.js'
import { escape, relativeTime, isoDay } from './util.js'
import { celebrate } from './confetti.js'
import { renderStats } from './stats.js'
import { renderTable, renderCalendar } from './views.js'
import { THEME_TEMPLATES, THEME_MODES, themeTemplate } from './themes.js'
import { BOARD_FEATURES, BOARD_KIND_IDS, boardKind, hasFeature } from './kinds.js'
import { encode } from '../node_modules/uqr/dist/index.mjs'

const bridge = window.bridge
const normalizeInvite = (value) => {
  const invite = String(value || '').trim()
  const match = invite.match(
    /^(?:opencollab:\/\/board\/|opencollab:\/\/|https?:\/\/[^/]+\/board\/)?(.+)$/i
  )
  return decodeURIComponent(match ? match[1] : invite).replace(/\/$/, '')
}
const inviteLink = (invite) => `opencollab://board/${encodeURIComponent(normalizeInvite(invite))}`
const decoder = new TextDecoder('utf-8')
const workers = { main: '/workers/main.js' }
const identityGate = document.getElementById('identity-gate')
const roomGate = document.getElementById('room-gate')
const boardView = document.getElementById('chat')
const identityError = document.getElementById('identity-error')
const roomError = document.getElementById('room-error')
const profileGate = document.getElementById('profile-gate')
const profileError = document.getElementById('profile-error')
const boardObjects = document.getElementById('board-objects')
const recentBoards = document.getElementById('recent-boards')
const boardLoading = document.getElementById('board-loading')
const connectionModal = document.getElementById('connection-modal')
const identityMenu = document.getElementById('identity-label')
const newObjectForm = document.getElementById('new-object-form')
const newObjectToggle = document.getElementById('new-object-toggle')
let currentIdentity = ''
let currentDisplayName = ''
let currentInvite = ''
let networkStatus = 'waiting'
let peerCount = 0
let objects = []
let columns = []
let labels = []
let theme = { background: null, accent: null, template: null, backgroundImage: null }
let boardInfo = { description: '', icon: null }
// Moderation: the owner (board creator) and every member with role and ban.
let boardOwner = null
// The board's type (renderer/kinds.js): which features show.
let boardKindId = 'kanban'
const can = (feature) => hasFeature(boardKindId, feature)
let members = []
let editingDescription = false
let descriptionExpanded = false
// Image uploads waiting for the worker: requestId → { cardId, names }.
const pendingUploads = new Map()
let colorPickerColumn = null
let colorPickerEntering = false
// Moves made here land where the user put them; only peers' moves animate.
const localCardMoves = new Set()
const localColumnMoves = new Set()
let lastUnreadAlerts = 0
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const cssToken = (name) =>
  window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
let profiles = {}
let boardSynced = false
let roomEntered = false
let identityUnlocked = false
// Board state re-renders often; keep UI state outside the DOM.
const seenObjects = new Set()
const seenComments = new Set()
let showArchived = false
let openCardId = null
// Inline editors survive re-renders: { columnId, text } / { text } / { id, text }.
let cardComposer = null
let columnComposer = null
let renamingColumn = null
let dragging = null
let renderDeferred = false
let editingBody = false
// Label toggles not yet echoed back by the worker, so quick clicks stack.
let labelDraft = null
const COMMENTS_SHOWN = 10
let showAllComments = false
let recoloringLabel = null
let newLabelColor = null
const filters = { labels: new Set(), member: '', due: '', assignee: '' }
// Trello's label palette.
const LABEL_COLORS = ['#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef']
LABEL_COLORS.push('#579dff', '#6cc3e0', '#94c748', '#e774bb', '#8590a2')
// Notifications from every joined board (the worker checks the others in the
// background). Read state is kept on this device, per identity.
let alertBoards = []
let currentBoardKey = ''
let pendingOpenCard = null
const notifiedAlerts = new Set()
const primedBoards = new Set()
// Image attachments: bytes live encrypted in each author's Hyperblobs core;
// the worker fetches them on demand and they are cached here as data URLs.
const MAX_IMAGES = 4
const MAX_IMAGE_SIDE = 1600
const imageCache = new Map()
const imageRequests = new Set()
let pendingImages = []
// Automation rules, and who else is on the board right now (and on which card).
let rules = []
let presencePeers = []
// Mirrors REACTIONS in packages/board-protocol (the worker drops anything else).
const REACTIONS = ['👍', '❤️', '🎉', '😂', '😮', '🚀', '👀', '🔥']
const ESTIMATES = [0, 1, 2, 3, 5, 8, 13, 21]
const DAY_MS = 24 * 3600 * 1000
// Board / table / calendar, remembered on this device.
const VIEW_KEY = 'opencollab.board-view'
let boardViewMode = (() => {
  try {
    return localStorage.getItem(VIEW_KEY) || 'board'
  } catch {
    return 'board'
  }
})()
const tableSort = { key: 'column', dir: 'asc' }
let calendarMonth = new Date()
// The calendar day whose "+N more" list is open.
let calendarOpenDay = null
// Card details: which tab shows, the reaction picker that is open (card or a
// comment id), the checklist item being renamed, and the link being added.
let cardTab = 'comments'
let reactionPicker = null
let pickerNode = null
let checklistEditing = null
let hideCheckedItems = false
let linkKind = 'blocks'
// Long checklists and link lists show their first rows until expanded.
const COLLAPSED_ROWS = 10
let checklistShowAll = false
let linksShowAll = false
// What the open card's checklist and estimate looked like last render, so only
// real transitions (finishing the list, revealing votes) animate.
let lastChecklist = { cardId: null, complete: false }
let lastReveal = { cardId: null, revealed: false }
let revealUntil = 0
let wipEditingColumn = null
let templatePickerColumn = null
// Replies to activity/stats/template requests carry the id they were asked
// with; only the latest request of each kind is shown.
const latestRequest = {}
let assigneeDraft = null

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  share:
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  trash:
    '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  palette:
    '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a5 5 0 0 0 5-5c0-5.5-4.5-10-10-10z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4z"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  tag: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
  camera:
    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  checklist: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-8"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v12"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  template:
    '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  gauge: '<path d="M12 14 16 10"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  points: '<path d="M12 2 2 7l10 5 10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'
}

function icon(name, className = 'icon') {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`
}

function withIcon(button, name, label) {
  button.innerHTML = `${icon(name)}<span>${escape(label)}</span>`
}

function shortKey(identity) {
  const key = identity || ''
  return key.length > 10 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key
}

// Deterministic 5x5 mirrored identicon derived from the hex public key.
function identicon(identity) {
  const key = (identity || '').padEnd(32, '0')
  const hue = parseInt(key.slice(0, 4), 16) % 360
  let cells = ''
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (parseInt(key[4 + y * 3 + x], 16) % 2 === 0) continue
      cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`
      if (x < 2) cells += `<rect x="${4 - x}" y="${y}" width="1" height="1"/>`
    }
  }
  return `<svg class="identicon" viewBox="-0.5 -0.5 6 6" aria-hidden="true"><g fill="hsl(${hue} 85% 62%)">${cells}</g></svg>`
}

// A member's avatar once its image has loaded, their identicon until then
// (and when they have none). Avatars come from the board, like the board icon.
function avatar(identity) {
  const ref = members.find((member) => member.identity === identity)?.avatar
  const cached = ref ? imageCache.get(imageKey(ref)) : null
  if (ref && !cached) requestImage(ref)
  return cached?.url
    ? `<img class="identicon avatar" src="${cached.url}" alt="" />`
    : identicon(identity)
}

function identityHtml(identity) {
  const name = profiles[identity]
  return `<span class="identity" title="${escape(identity)}">${avatar(identity)}${name ? `<span class="name">${escape(name)}</span>` : ''}<span>${escape(shortKey(identity))}</span></span>`
}

const memberName = (identity) =>
  identity === currentIdentity
    ? currentDisplayName || 'You'
    : profiles[identity] || members.find((m) => m.identity === identity)?.name || shortKey(identity)

// Overlapping avatars; past `max` the rest collapse into "+N".
// `entering` faces (people who just arrived) play a short entrance.
function avatarStack(identities, max = 3, entering = null) {
  const list = identities || []
  if (!list.length) return ''
  const names = list.map(memberName)
  const faces = list
    .slice(0, max)
    .map(
      (identity) =>
        `<span class="stack-face${entering?.has(identity) ? ' enter' : ''}">${avatar(identity)}</span>`
    )
    .join('')
  const rest = list.length > max ? `<span class="stack-face more">+${list.length - max}</span>` : ''
  return `<span class="avatar-stack" title="${escape(names.join(', '))}" aria-label="${escape(names.join(', '))}">${faces}${rest}</span>`
}

// The last column is "Done" everywhere (stats, rules, celebration).
const doneColumnId = () => (columns.length > 1 ? columns[columns.length - 1].id : null)
const isDone = (object) => object.columnId === doneColumnId()
const peersOn = (cardId) => presencePeers.filter((peer) => peer.cardId === cardId)

function send(message) {
  bridge.writeWorkerIPC(workers.main, JSON.stringify(message))
}

function showBoardManagement() {
  if (!identityUnlocked) return
  roomEntered = false
  boardSynced = false
  currentInvite = ''
  resetBoardUi()
  roomGate.style.display = 'block'
  profileGate.style.display = 'none'
  showBoard(false)
  document.getElementById('gate-identity').innerHTML = identityHtml(currentIdentity)
  showRoomChoice()
  showRecentBoards()
}

function resetBoardUi() {
  seenObjects.clear()
  seenComments.clear()
  cardComposer = null
  columnComposer = null
  renamingColumn = null
  filters.labels.clear()
  filters.member = ''
  filters.due = ''
  filters.assignee = ''
  rules = []
  presencePeers = []
  presencePrimed = false
  knownPresence.clear()
  renderPresence()
  wipEditingColumn = null
  templatePickerColumn = null
  for (const modal of document.querySelectorAll('.overlay.open')) modal.classList.remove('open')
  document.getElementById('filter-panel').hidden = true
  document.getElementById('theme-panel').hidden = true
  closeLabelsManager()
  closeSettingsMenu()
  closeProfileEditor()
  editingDescription = false
  descriptionExpanded = false
  boardInfo = { description: '', icon: null }
  boardKindId = 'kanban'
  applyKind()
  renderDescription()
  renderBoardIcon()
  colorPickerColumn = null
  theme = { background: null, accent: null, template: null, backgroundImage: null }
  boardOwner = null
  members = []
  closeMembers()
  document.getElementById('banned-banner').hidden = true
  closeCard()
  closeNotifications()
  closeNewObject()
}

function showBoard(visible) {
  boardView.style.display = visible ? 'block' : 'none'
  document.body.classList.toggle('board-open', visible)
  applyTheme()
}

// Board backgrounds. Presets are dark enough for the default light text.
const BACKGROUNDS = {
  'preset:ocean': 'linear-gradient(135deg, #0f2027, #203a43 50%, #2c5364)',
  'preset:dusk': 'linear-gradient(135deg, #2b1055, #4b3b8f 55%, #7597de)',
  'preset:forest': 'linear-gradient(135deg, #0b2e22, #135c44 60%, #1d7a5a)',
  'preset:sunset': 'linear-gradient(135deg, #42275a, #734b6d 55%, #b0605f)',
  'preset:ember': 'linear-gradient(135deg, #2a1414, #5c2318 55%, #8a3b1d)',
  'preset:slate': 'linear-gradient(135deg, #1f2933, #323f4b 55%, #52606d)'
}
const ACCENTS = ['#39ff88', '#22d3ee', '#579dff', '#9f8fef', '#e774bb', '#fea362', '#f5cd47']

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Look and feel on this device: light or dark mode, and a template that can
// override the board's. Kept in localStorage, like the notification sound.
const THEME_MODE_KEY = 'opencollab.theme-mode'
const THEME_OVERRIDE_KEY = 'opencollab.theme-override'
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
// Palette keys map to CSS variables by name: surfaceRaised → --surface-raised.
const cssVar = (key) => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

function deviceSetting(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}
function saveDeviceSetting(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

// Dark until the user picks System or Light, so the default look stays put.
let themeMode = deviceSetting(THEME_MODE_KEY, 'dark')
if (!THEME_MODES.includes(themeMode)) themeMode = 'dark'
let themeOverride = deviceSetting(THEME_OVERRIDE_KEY, '')
const colorScheme = () =>
  themeMode === 'system' ? (darkQuery.matches ? 'dark' : 'light') : themeMode
// This device's template, else the open board's, else the default.
const activeTemplate = (open = true) =>
  themeTemplate(themeOverride || (open ? theme.template : null))
darkQuery.addEventListener('change', () => {
  if (themeMode === 'system') applyTheme()
})

// Theme values are validated by the worker: a preset id or #rrggbb.
function applyTheme() {
  const root = document.documentElement
  const open = document.body.classList.contains('board-open')
  const scheme = colorScheme()
  const background = open ? theme.background : null
  const accent = open ? theme.accent : null
  // The board's custom accent goes into the palette, so each variable is
  // written once and stays put across board updates.
  const palette = { ...activeTemplate(open)[scheme] }
  if (accent) {
    palette.accent = accent
    palette.accentInk = luminance(accent) > 0.4 ? '#04110a' : '#ffffff'
  }
  for (const [key, value] of Object.entries(palette)) root.style.setProperty(cssVar(key), value)
  root.style.colorScheme = scheme
  root.dataset.scheme = scheme
  // A background image sits on top of the color, dimmed so text stays readable.
  const image =
    open && theme.backgroundImage ? imageCache.get(imageKey(theme.backgroundImage)) : null
  if (open && theme.backgroundImage) requestImage(theme.backgroundImage)
  const base = background
    ? BACKGROUNDS[background] || (background.startsWith('#') ? background : 'var(--bg)')
    : 'var(--bg)'
  if (image?.url) {
    root.style.setProperty(
      '--board-bg',
      `linear-gradient(rgba(5, 8, 12, 0.55), rgba(5, 8, 12, 0.55)), url("${image.url}") center / cover no-repeat, ${base}`
    )
  } else if (background) root.style.setProperty('--board-bg', base)
  else root.style.removeProperty('--board-bg')
  document.body.classList.toggle('themed', !!background || !!image?.url)
  // Text on the board canvas follows the background, not the mode: dark on a
  // light custom colour, light on presets and images (which are all dark).
  const lightCanvas = !image?.url && background?.startsWith('#') && luminance(background) > 0.35
  if (lightCanvas) root.style.setProperty('--board-ink', '#0b0f14')
  else if (scheme === 'light' && (background || image?.url)) {
    root.style.setProperty('--board-ink', '#eef2f7')
  } else root.style.removeProperty('--board-ink')
}

function setTheme(change) {
  send({ type: 'board:theme-set', ...change })
}

// One tile per template, previewed in the current mode.
function templateTile(template, pressed) {
  const colors = template[colorScheme()]
  return `<button type="button" class="template-tile" data-template="${template.id}" aria-pressed="${pressed}" style="--tile-bg: ${colors.bg}; --tile-surface: ${colors.surface}; --tile-border: ${colors.border}; --tile-text: ${colors.text}; --tile-accent: ${colors.accent}"><span class="template-preview" aria-hidden="true"><span></span><span></span><span></span></span>${escape(template.name)}</button>`
}

function renderThemePanel() {
  const templates = document.getElementById('theme-templates')
  const boardTemplate = themeTemplate(theme.template).id
  templates.innerHTML = THEME_TEMPLATES.map((template) =>
    templateTile(template, template.id === boardTemplate)
  ).join('')
  for (const button of templates.querySelectorAll('[data-template]')) {
    // The template brings its own accent and background; a background image stays.
    button.onclick = () =>
      setTheme({ template: button.dataset.template, accent: null, background: null })
  }
  for (const button of document.querySelectorAll('[data-theme-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.themeMode === themeMode))
  }
  document.getElementById('theme-override').value = themeOverride
  document.getElementById('theme-override-hint').hidden = !themeOverride

  const backgrounds = document.getElementById('theme-backgrounds')
  const current = theme.background
  const options = [
    [null, 'Default', 'var(--bg)'],
    ...Object.entries(BACKGROUNDS).map(([id, css]) => [id, id.slice(7), css])
  ]
  backgrounds.innerHTML =
    options
      .map(
        ([id, name, css]) =>
          `<button type="button" class="swatch background" style="--label-color: ${css}" data-background="${id || ''}" aria-label="${escape(name)} background" title="${escape(name)}" aria-pressed="${current === id}"></button>`
      )
      .join('') +
    `<label class="swatch background custom" title="Custom color" aria-pressed="${!!current?.startsWith('#')}" style="${current?.startsWith('#') ? `background: ${current}` : ''}">Custom<input type="color" aria-label="Custom background color" value="${current?.startsWith('#') ? current : '#1a2a3a'}" /></label>`
  for (const button of backgrounds.querySelectorAll('[data-background]')) {
    button.onclick = () => setTheme({ background: button.dataset.background || null })
  }
  backgrounds.querySelector('input').onchange = (event) =>
    setTheme({ background: event.target.value })

  // The first swatch is the template's own accent, shown as it looks right now.
  const templateAccent = activeTemplate()[colorScheme()].accent
  const accents = document.getElementById('theme-accents')
  accents.innerHTML =
    [templateAccent, ...ACCENTS.filter((color) => color !== templateAccent)]
      .map(
        (color, index) =>
          `<button type="button" class="swatch" style="--label-color: ${color}" data-accent="${index === 0 ? '' : color}" aria-label="${index === 0 ? 'Template accent' : `Accent ${color}`}" aria-pressed="${index === 0 ? !theme.accent : theme.accent === color}"></button>`
      )
      .join('') +
    `<label class="swatch custom" title="Custom accent">+<input type="color" aria-label="Custom accent color" value="${theme.accent || templateAccent}" /></label>`
  for (const button of accents.querySelectorAll('[data-accent]')) {
    button.onclick = () => setTheme({ accent: button.dataset.accent || null })
  }
  accents.querySelector('input').onchange = (event) => setTheme({ accent: event.target.value })
  renderMediaThumb('theme-image', theme.backgroundImage)
  renderMediaThumb('board-icon', boardInfo.icon)
}

// The thumbnail and "Remove" button next to a board image setting.
function renderMediaThumb(prefix, ref) {
  const thumb = document.getElementById(`${prefix}-thumb`)
  const cached = ref ? imageCache.get(imageKey(ref)) : null
  thumb.hidden = !ref
  thumb.style.backgroundImage = cached?.url ? `url("${cached.url}")` : ''
  document.getElementById(`${prefix}-remove`).hidden = !ref
  if (ref) requestImage(ref)
}

function renderBoardIcon() {
  const slot = document.getElementById('board-icon')
  const ref = boardInfo.icon
  const cached = ref ? imageCache.get(imageKey(ref)) : null
  slot.hidden = !cached?.url
  slot.innerHTML = cached?.url ? `<img src="${cached.url}" alt="" />` : ''
  if (ref && !cached) requestImage(ref)
}

// Board icon, background image and avatars: shared with the board, like the theme.
async function uploadBoardImage(file, type, errorId = 'theme-error', maxSide = MAX_IMAGE_SIDE) {
  const error = document.getElementById(errorId)
  error.hidden = true
  if (!file) return
  try {
    const image = await prepareImage(file, maxSide)
    if (image.url.length * 0.75 > 5 * 1024 * 1024) throw new Error('too large')
    send({
      type,
      image: {
        data: image.url.slice(image.url.indexOf(',') + 1),
        type: image.type,
        width: image.width,
        height: image.height
      }
    })
  } catch {
    error.textContent = `${file.name} could not be used (JPEG, PNG, WebP or GIF up to 5 MB).`
    error.hidden = false
  }
}

for (const [prefix, type] of [
  ['theme-image', 'board:background-image-set'],
  ['board-icon', 'board:icon-set']
]) {
  const input = document.getElementById(`${prefix}-input`)
  document.getElementById(`${prefix}-upload`).onclick = () => input.click()
  input.onchange = () => {
    const [file] = input.files
    input.value = ''
    uploadBoardImage(file, type)
  }
  document.getElementById(`${prefix}-remove`).onclick = () => send({ type, image: null })
}

async function showRecentBoards() {
  if (!currentIdentity) {
    recentBoards.innerHTML = ''
    return
  }
  const boards = await bridge.recentBoardsList(currentIdentity)
  // The worker checks these in the background for the notification bar.
  send({
    type: 'boards:watch',
    boards: boards.map(({ invite, name }) => ({ invite, name }))
  })
  recentBoards.innerHTML = boards.length ? '<p class="section-label">Joined boards</p>' : ''
  for (const board of boards) {
    const row = document.createElement('div')
    row.className = 'recent-board'

    const join = document.createElement('button')
    join.className = 'secondary'
    join.innerText = board.name || 'Board name loading…'
    join.onclick = () => send({ type: 'room:start', invite: board.invite, name: board.name })

    const remove = document.createElement('button')
    remove.className = 'secondary icon-only'
    remove.innerHTML = icon('trash')
    remove.setAttribute('aria-label', `Remove ${board.name || 'joined board'}`)
    let confirmTimer = null
    remove.onclick = async () => {
      if (!confirmTimer) {
        remove.className = 'danger'
        withIcon(remove, 'trash', 'Remove?')
        confirmTimer = setTimeout(() => {
          confirmTimer = null
          remove.className = 'secondary icon-only'
          remove.innerHTML = icon('trash')
        }, 3000)
        return
      }
      clearTimeout(confirmTimer)
      await bridge.recentBoardsRemove(currentIdentity, board.invite)
      await showRecentBoards()
    }

    row.append(join, remove)
    recentBoards.appendChild(row)
  }
}

async function rememberBoard(board) {
  await bridge.recentBoardsSave(currentIdentity, board)
  await showRecentBoards()
}

function setBoardName(name) {
  const heading = document.getElementById('board-name')
  heading.innerText = name
  heading.title = name
}

function updateIdentityMenu() {
  identityMenu.innerHTML = `${avatar(currentIdentity)}<span dir="auto">@${escape(currentDisplayName || 'DisplayName')}</span>`
  identityMenu.title = currentDisplayName ? `@${currentDisplayName}` : ''
}

// The topbar and the Members view show the same chip.
function updateStatusChip() {
  for (const chip of document.querySelectorAll('.status-chip')) {
    chip.classList.toggle('online', peerCount > 0)
    chip.querySelector('.peer-status').innerText =
      `${peerCount} ${peerCount === 1 ? 'peer' : 'peers'}`
    chip.querySelector('.sync-status').innerText = boardSynced ? 'synced' : 'syncing…'
  }
}

function openConnectionModal() {
  document.getElementById('modal-identity').innerHTML = identityHtml(currentIdentity)
  document.getElementById('modal-network').innerText = networkStatus
  document.getElementById('modal-peers').innerText = peerCount
  document.getElementById('copy-invite').disabled = !currentInvite
  document.getElementById('share-invite').disabled = !currentInvite
  document.getElementById('show-invite-qr').disabled = !currentInvite
  document.getElementById('invite-qr').hidden = true
  connectionModal.classList.add('open')
  document.getElementById('close-connection-modal').focus()
}

function closeConnectionModal() {
  connectionModal.classList.remove('open')
  identityMenu.focus()
}

function renderComment(comment) {
  const element = document.createElement('div')
  element.className = 'comment'
  if (!seenComments.has(comment.id)) {
    seenComments.add(comment.id)
    element.classList.add('enter')
  }
  element.innerHTML = `<div class="comment-meta">${identityHtml(comment.author)}<span class="time" title="${escape(new Date(comment.createdAt).toLocaleString())}">${escape(relativeTime(comment.createdAt))}</span></div><div class="markdown" dir="auto"></div>`
  element.querySelector('.markdown').append(markdownFor(comment.text, comment.mentions))
  element.append(
    reactionBar(comment.reactions, `comment:${comment.id}`, (emoji, on) =>
      send({ type: 'board:reaction-set', objectId: openCardId, commentId: comment.id, emoji, on })
    )
  )
  return element
}

// `images` are the card's attachments that `![alt](image:<key>)` may show.
function markdownFor(text, mentions, images = []) {
  const fragment = renderMarkdown(text, {
    mentions: (mentions || [])
      .filter((identity) => profiles[identity])
      .map((identity) => ({ identity, name: profiles[identity] })),
    self: currentIdentity
  })
  for (const slot of fragment.querySelectorAll('.md-image')) {
    const ref = images.find((image) => imageKey(image) === slot.dataset.image)
    if (!ref) {
      slot.classList.add('missing')
      continue
    }
    slot.dataset.mdImageKey = imageKey(ref)
    fillInlineImage(slot)
    requestImage(ref)
  }
  return fragment
}

// Fills a cover or Markdown image from the cache; shows a placeholder until then.
function fillInlineImage(slot) {
  const key = slot.dataset.mdImageKey || slot.dataset.coverKey
  const cached = imageCache.get(key)
  slot.classList.toggle('loading', !cached)
  slot.classList.toggle('missing', !!cached?.error && !!slot.dataset.mdImageKey)
  slot.innerHTML = ''
  if (!cached?.url) return
  const img = document.createElement('img')
  img.src = cached.url
  img.alt = slot.dataset.alt || 'Card image'
  if (slot.dataset.mdImageKey) {
    img.onclick = (event) => {
      event.stopPropagation()
      openImageViewer(cached.url)
    }
  }
  slot.append(img)
}

const imageKey = (ref) => `${ref.core}:${ref.id.blockOffset}:${ref.id.blockLength}`

function requestImage(ref) {
  const key = imageKey(ref)
  if (imageCache.has(key) || imageRequests.has(key)) return
  imageRequests.add(key)
  send({ type: 'board:image', ref })
}

function fillImageSlot(slot, ref) {
  const cached = imageCache.get(imageKey(ref))
  slot.classList.toggle('loading', !cached)
  if (cached?.url) {
    slot.innerHTML = `<img src="${cached.url}" alt="Attached image" />`
    slot.disabled = false
  } else if (cached?.error) {
    slot.textContent = 'Unavailable · retry'
    slot.disabled = false
  } else {
    slot.textContent = ''
    slot.disabled = true
  }
}

function renderImages(card, object) {
  const container = card.querySelector('.object-images')
  if (!container) return
  for (const ref of object.images) {
    if (isVideoRef(ref)) {
      container.appendChild(renderVideoSlot(ref))
      continue
    }
    const slot = document.createElement('button')
    slot.type = 'button'
    slot.className = 'object-image'
    slot.dataset.imageKey = imageKey(ref)
    if (ref.width && ref.height) slot.style.aspectRatio = `${ref.width} / ${ref.height}`
    slot.onclick = () => {
      const cached = imageCache.get(imageKey(ref))
      if (cached?.url) openImageViewer(cached.url)
      else if (cached?.error) {
        imageCache.delete(imageKey(ref))
        fillImageSlot(slot, ref)
        requestImage(ref)
      }
    }
    fillImageSlot(slot, ref)
    container.appendChild(slot)
    requestImage(ref)
  }
}

// Videos: the worker writes a decrypted copy to disk and the player reads it
// from there, so even 200 MB files never cross IPC.
const isVideoRef = (ref) => typeof ref?.type === 'string' && ref.type.startsWith('video/')
const videoFiles = new Map() // media key → { path } | { error } | { loading }
const fileUrl = (file) =>
  'file://' + encodeURI((file.startsWith('/') ? '' : '/') + file.replaceAll('\\', '/'))

function renderVideoSlot(ref) {
  const key = imageKey(ref)
  const state = videoFiles.get(key)
  if (state?.path) {
    const video = document.createElement('video')
    video.className = 'object-video'
    video.controls = true
    video.preload = 'metadata'
    video.src = fileUrl(state.path)
    video.dataset.videoKey = key
    return video
  }
  const slot = document.createElement('button')
  slot.type = 'button'
  slot.className = 'object-image video'
  slot.dataset.videoKey = key
  const size = ref.id.byteLength / (1024 * 1024)
  const label = `${ref.name || 'Video'} · ${size < 1 ? '<1' : Math.round(size)} MB`
  slot.innerHTML = state?.loading
    ? `<span class="play" aria-hidden="true">…</span><span>Loading video…</span>`
    : state?.error
      ? `<span class="play" aria-hidden="true">↻</span><span>Unavailable · retry</span>`
      : `<span class="play" aria-hidden="true">▶</span><span dir="auto">${escape(label)}</span>`
  slot.disabled = !!state?.loading
  slot.setAttribute('aria-label', `Play ${ref.name || 'video'}`)
  slot.onclick = () => {
    videoFiles.set(key, { loading: true })
    slot.replaceWith(renderVideoSlot(ref))
    send({ type: 'board:media', ref })
  }
  return slot
}

function onBoardMedia(message) {
  videoFiles.set(message.key, message.path ? { path: message.path } : { error: message.error })
  const ref = objects
    .flatMap((object) => object.images || [])
    .find((entry) => imageKey(entry) === message.key)
  if (!ref) return
  for (const slot of document.querySelectorAll(`[data-video-key="${message.key}"]`)) {
    const next = renderVideoSlot(ref)
    slot.replaceWith(next)
    if (message.path) next.play?.().catch(() => {})
  }
}

let videoUpload = null // { requestId, cardId }

async function attachVideos() {
  const object = cardById(openCardId)
  const error = document.getElementById('card-image-error')
  error.hidden = true
  if (!object || videoUpload) return
  const files = await bridge.pickVideos()
  if (!files.length) return
  const tooBig = files.find((file) => file.size > 200 * 1024 * 1024)
  if (tooBig) {
    error.textContent = `${tooBig.name} is too large (max 200 MB).`
    error.hidden = false
    return
  }
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  videoUpload = { requestId, cardId: object.id }
  const button = document.getElementById('card-attach-video')
  button.disabled = true
  withIcon(button, 'video', 'Uploading…')
  send({
    type: 'board:card-media-add',
    objectId: object.id,
    requestId,
    files: files.map(({ path, name }) => ({ path, name }))
  })
}

function onMediaProgress(message) {
  if (message.requestId !== videoUpload?.requestId) return
  const percent = Math.floor((message.bytes / message.total) * 100)
  withIcon(document.getElementById('card-attach-video'), 'video', `Uploading ${percent}%`)
}

function onMediaAdded(message) {
  if (message.requestId !== videoUpload?.requestId) return
  videoUpload = null
  const button = document.getElementById('card-attach-video')
  button.disabled = false
  withIcon(button, 'video', 'Attach video')
  if (message.keys?.length) return
  const error = document.getElementById('card-image-error')
  error.textContent = message.error || 'The video could not be added.'
  error.hidden = false
}

document.getElementById('card-attach-video').onclick = attachVideos

function openImageViewer(url) {
  const viewer = document.getElementById('image-viewer')
  viewer.querySelector('img').src = url
  viewer.classList.add('open')
}

function closeImageViewer() {
  document.getElementById('image-viewer').classList.remove('open')
}

// Downscale to `maxSide` and re-encode as JPEG to keep transfers small.
// GIFs are kept as-is so animations survive.
async function prepareImage(file, maxSide = MAX_IMAGE_SIDE) {
  if (file.type === 'image/gif') {
    const url = await readAsDataUrl(file)
    const bitmap = await window.createImageBitmap(file)
    return { url, type: file.type, width: bitmap.width, height: bitmap.height }
  }
  const bitmap = await window.createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
  return {
    url: await readAsDataUrl(blob),
    type: 'image/jpeg',
    width: canvas.width,
    height: canvas.height
  }
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new window.FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function renderPendingImages() {
  const previews = document.getElementById('image-previews')
  previews.innerHTML = ''
  pendingImages.forEach((image, index) => {
    const preview = document.createElement('div')
    preview.className = 'image-preview'
    preview.innerHTML = `<img src="${image.url}" alt="Image to attach" /><button type="button" class="secondary" aria-label="Remove image">✕</button>`
    preview.querySelector('button').onclick = () => {
      pendingImages.splice(index, 1)
      renderPendingImages()
    }
    previews.appendChild(preview)
  })
}

const scoreOf = (object) => Object.values(object.votes || {}).reduce((sum, value) => sum + value, 0)
const cardById = (id) => objects.find((object) => object.id === id)
// The worker sends cards sorted by column, then position.
const cardsIn = (columnId) => objects.filter((object) => object.columnId === columnId)
// Templates are cards too, but only show in the template picker.
const isShown = (object) =>
  !object.template && (showArchived || !object.archived) && matchesFilters(object)
const visibleCards = (columnId) => cardsIn(columnId).filter(isShown)
const templates = () => objects.filter((object) => object.template && !object.archived)

// Date-only due dates are due at the end of that day, local time.
function dueInfo(dueDate) {
  if (!dueDate) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
  const [year, month, day] = dueDate.split('-').map(Number)
  const deadline = dateOnly ? new Date(year, month - 1, day, 23, 59, 59) : new Date(dueDate)
  if (Number.isNaN(deadline.getTime())) return null
  const left = deadline - Date.now()
  // The year shows when it isn't this one, or "Jan 15" two years overdue reads as recent.
  const text = deadline.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(deadline.getFullYear() !== new Date().getFullYear() && { year: 'numeric' })
  })
  return {
    deadline,
    dateOnly,
    status: left < 0 ? 'overdue' : left < 24 * 3600 * 1000 ? 'soon' : '',
    text: dateOnly
      ? text
      : `${text}, ${deadline.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  }
}

function dueBadge(object) {
  const due = dueInfo(object.dueDate)
  if (!due) return ''
  const label = { overdue: 'Overdue', soon: 'Due soon' }[due.status] || 'Due'
  return `<span class="due-badge ${due.status}" title="${label}: ${escape(due.deadline.toLocaleString())}">${icon('clock')}${escape(due.text)}</span>`
}

// `max` caps the chips shown (card faces); the rest collapse into "+N".
function labelChips(labelIds, max = Infinity) {
  const shown = (labelIds || [])
    .map((id) => labels.find((label) => label.id === id))
    .filter(Boolean)
  const chips = shown
    .slice(0, max)
    .map(
      (label) =>
        `<span class="label-chip" style="--label-color: ${label.color || '#8590a2'}" title="${escape(label.name)}" dir="auto">${escape(label.name)}</span>`
    )
  if (shown.length > max) {
    const rest = shown.slice(max)
    chips.push(
      `<span class="label-chip more" title="${escape(rest.map((label) => label.name).join(', '))}">+${rest.length}</span>`
    )
  }
  return chips.join('')
}

const mentionsMember = (object, identity) =>
  object.mentions?.includes(identity) ||
  object.comments?.some((comment) => comment.mentions?.includes(identity))

function matchesFilters(object) {
  if (filters.labels.size && !object.labelIds?.some((id) => filters.labels.has(id))) return false
  if (filters.member && !mentionsMember(object, filters.member)) return false
  if (filters.assignee) {
    const assignees = object.assignees || []
    if (filters.assignee === 'none' ? assignees.length : !assignees.includes(filters.assignee)) {
      return false
    }
  }
  if (filters.due) {
    const due = dueInfo(object.dueDate)
    if (filters.due === 'none') return !due
    if (!due) return false
    if (filters.due === 'overdue') return due.status === 'overdue'
    const left = due.deadline - Date.now()
    if (filters.due === 'week') return left >= 0 && left <= 7 * 24 * 3600 * 1000
  }
  return true
}

const filterCount = () =>
  filters.labels.size +
  (filters.member ? 1 : 0) +
  (filters.due ? 1 : 0) +
  (filters.assignee ? 1 : 0)

// The worker places a card by index among all cards of the column, archived
// ones included; the UI counts only the cards it shows.
// Cards that count against a column's WIP limit, whatever the filters show.
const wipCount = (columnId) =>
  cardsIn(columnId).filter((object) => !object.archived && !object.template).length

// Moving into the last column is finishing: a blocked card asks first, and the
// mover gets a small celebration. A full column still takes the card, with a note.
async function moveCard(cardId, columnId, visibleIndex) {
  const card = cardById(cardId)
  const column = columns.find((entry) => entry.id === columnId)
  const entering = card && column && card.columnId !== columnId
  if (entering && columnId === doneColumnId() && card.blockedBy?.length) {
    const blockers = card.blockedBy
      .map((id) => cardById(id)?.title)
      .filter(Boolean)
      .map((title) => `“${title.length > 60 ? `${title.slice(0, 59)}…` : title}”`)
    const confirmed = await confirmDialog({
      title: 'This card is still blocked',
      body: `${blockers.length ? `Waiting on: ${blockers.join(', ')}. ` : ''}Move it to ${column.name} anyway?`,
      confirmLabel: 'Move anyway'
    })
    if (!confirmed) return false
  }
  const all = cardsIn(columnId).filter((object) => object.id !== cardId)
  const visible = visibleCards(columnId).filter((object) => object.id !== cardId)
  const index =
    visibleIndex <= 0
      ? visible.length
        ? all.indexOf(visible[0])
        : all.length
      : all.indexOf(visible[Math.min(visibleIndex, visible.length) - 1]) + 1
  localCardMoves.add(cardId)
  send({ type: 'board:card-move', objectId: cardId, columnId, index })
  if (!entering) return true
  const count = wipCount(columnId) + 1
  if (can('wip') && column.wipLimit && count > column.wipLimit) {
    showToast(`${column.name} is over its WIP limit (${count}/${column.wipLimit})`, 'warn')
  }
  if (columnId === doneColumnId()) celebrateDone(cardId)
  return true
}

// Keyboard moves (Alt+arrows, a select changed with the keys) finish quietly:
// confetti is for the drag or click that lands a card in Done.
let lastInput = 'pointer'
document.addEventListener('pointerdown', () => (lastInput = 'pointer'), true)
document.addEventListener('keydown', () => (lastInput = 'key'), true)
let pendingCelebration = null

function celebrateDone(cardId) {
  playSound()
  if (lastInput !== 'pointer') return
  // From the column select when the card is open; otherwise from the card
  // itself once the board shows it in Done.
  if (openCardId === cardId) return burstFrom(cardColumn)
  if (boardViewMode !== 'board') return burstFrom(null)
  pendingCelebration = cardId
}

function burstFrom(element) {
  const box = element?.getBoundingClientRect()
  const x = box ? box.left + box.width / 2 : window.innerWidth / 2
  const y = box ? box.top + box.height / 2 : window.innerHeight / 3
  celebrate(x, y, { reducedMotion: reducedMotion.matches, accent: cssToken('--accent') })
}

function moveColumn(columnId, index) {
  localColumnMoves.add(columnId)
  send({ type: 'board:column-update', columnId, index })
}

function renderCard(object) {
  const card = document.createElement('article')
  card.className = `kanban-card${object.archived ? ' archived' : ''}`
  if (!seenObjects.has(object.id)) {
    seenObjects.add(object.id)
    card.classList.add('enter')
  }
  card.dataset.cardId = object.id
  card.tabIndex = 0
  card.draggable = true
  card.setAttribute('role', 'button')
  card.setAttribute('aria-label', `${object.title}. Alt+arrow keys move the card.`)
  const score = scoreOf(object)
  const comments = object.comments?.length || 0
  const videos = (object.images || []).filter(isVideoRef).length
  const images = (object.images?.length || 0) - videos
  const chips = can('labels') ? labelChips(object.labelIds, 4) : ''
  const cover = object.images?.find((ref) => !isVideoRef(ref))
  const checklist = can('checklist') ? object.checklist || [] : []
  const checked = checklist.filter((item) => item.done).length
  const reactions = Object.entries(object.reactions || {}).filter(([, who]) => who.length)
  const viewers = peersOn(object.id)
  // Untouched cards fade a little; finished and archived ones never age.
  const idle = object.updatedAt ? Date.now() - object.updatedAt : 0
  const aging =
    object.archived || isDone(object) ? 0 : idle >= 14 * DAY_MS ? 2 : idle >= 7 * DAY_MS ? 1 : 0
  if (aging) {
    card.classList.add(`aging-${aging}`)
    card.title = `Not updated for ${Math.floor(idle / DAY_MS)} days`
  }
  const blocked = can('links') && object.blockedBy?.length
  if (blocked) card.classList.add('blocked')
  const badges = blocked
    ? `<span class="blocked-badge" title="Blocked by ${escape(object.blockedBy.map((id) => cardById(id)?.title || 'a card').join(', '))}">${icon('lock')}Blocked</span>`
    : ''
  const points =
    can('points') && object.points !== null && object.points !== undefined
      ? `<span class="points-chip" title="${object.points} points">${object.points}</span>`
      : ''
  card.innerHTML = `${cover ? `<div class="card-cover" data-cover-key="${escape(imageKey(cover))}"></div>` : ''}${
    viewers.length
      ? `<span class="card-viewers" title="${escape(viewers.map((peer) => peer.name || shortKey(peer.identity)).join(', '))} viewing">${avatarStack(
          viewers.map((peer) => peer.identity),
          2
        )}</span>`
      : ''
  }${chips ? `<div class="label-list">${chips}</div>` : ''}<div class="kanban-card-title" dir="auto" title="${escape(object.title)}">${escape(object.title)}</div>
    ${badges ? `<div class="card-badges">${badges}</div>` : ''}
    <div class="kanban-card-meta">${[
      points,
      can('due') ? dueBadge(object) : '',
      can('votes') && Object.keys(object.votes || {}).length
        ? `<span title="Score">${icon(score < 0 ? 'down' : 'up')}${score}</span>`
        : '',
      object.body?.trim() ? `<span title="Has a description">${icon('text')}</span>` : '',
      comments ? `<span title="Comments">${icon('message')}${comments}</span>` : '',
      unreadAlerts().some(
        (alert) =>
          alert.boardKey === currentBoardKey &&
          alert.cardId === object.id &&
          alert.kind === 'mention'
      )
        ? '<span class="mention mention-me" title="You were mentioned">@</span>'
        : '',
      images ? `<span title="Images">${icon('image')}${images}</span>` : '',
      videos ? `<span title="Videos">${icon('video')}${videos}</span>` : '',
      checklist.length
        ? `<span class="checklist-count${checked === checklist.length ? ' complete' : ''}" title="Checklist">${icon('checklist')}${checked}/${checklist.length}</span>`
        : '',
      reactions.length
        ? `<span class="reaction-summary" title="Reactions">${reactions
            .slice(0, 3)
            .map(([emoji, who]) => `${emoji}${who.length > 1 ? who.length : ''}`)
            .join(' ')}${reactions.length > 3 ? ` +${reactions.length - 3}` : ''}</span>`
        : '',
      object.archived ? '<span>archived</span>' : '',
      can('assignees') && object.assignees?.length
        ? `<span class="card-assignees">${avatarStack(object.assignees, 3)}</span>`
        : ''
    ].join('')}</div>${
      checklist.length
        ? `<div class="checklist-bar" aria-hidden="true"><span style="--p: ${checked / checklist.length}"></span></div>`
        : ''
    }`
  if (cover) {
    fillInlineImage(card.querySelector('.card-cover'))
    requestImage(cover)
  }
  card.onclick = () => openCard(object.id)
  card.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openCard(object.id)
      return
    }
    if (!event.altKey || !event.key.startsWith('Arrow')) return
    event.preventDefault()
    const visible = visibleCards(object.columnId)
    const index = visible.findIndex((entry) => entry.id === object.id)
    const columnIndex = columns.findIndex((column) => column.id === object.columnId)
    if (event.key === 'ArrowUp' && index > 0) moveCard(object.id, object.columnId, index - 1)
    if (event.key === 'ArrowDown' && index < visible.length - 1) {
      moveCard(object.id, object.columnId, index + 1)
    }
    const target = columns[columnIndex + (event.key === 'ArrowLeft' ? -1 : 1)]
    if (target && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      moveCard(object.id, target.id, index)
    }
  }
  card.ondragstart = (event) => {
    dragging = { kind: 'card', id: object.id }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', object.id)
    requestAnimationFrame(() => card.classList.add('dragging'))
  }
  card.ondragend = endDrag
  return card
}

function endDrag() {
  dragging = null
  for (const marker of document.querySelectorAll('.drop-marker, .column-drop-marker')) {
    marker.remove()
  }
  for (const element of document.querySelectorAll('.dragging')) {
    element.classList.remove('dragging')
  }
  if (renderDeferred) renderBoard()
}

// Index among the elements matching `selector`, from the pointer position.
function dropIndex(container, selector, coordinate, axis) {
  const items = [...container.querySelectorAll(selector)].filter(
    (element) => !element.classList.contains('dragging')
  )
  const index = items.findIndex((element) => {
    const box = element.getBoundingClientRect()
    return axis === 'y'
      ? coordinate < box.top + box.height / 2
      : coordinate < box.left + box.width / 2
  })
  return { items, index: index === -1 ? items.length : index }
}

function placeMarker(container, items, index, className) {
  let marker = container.querySelector(`:scope > .${className}`)
  if (!marker) {
    marker = document.createElement('div')
    marker.className = className
  }
  const before = items[index] || container.querySelector(':scope > .add-column')
  // dragover fires constantly; re-inserting would replay the marker's entry.
  if (marker.parentNode !== container || marker.nextSibling !== before) {
    container.insertBefore(marker, before)
  }
}

function renderComposer({ placeholder, value, onInput, onSubmit, onCancel, submitLabel }) {
  const form = document.createElement('form')
  form.className = 'composer'
  form.innerHTML = `<textarea rows="2" placeholder="${escape(placeholder)}" aria-label="${escape(placeholder)}"></textarea>
    <div class="row"><button>${escape(submitLabel)}</button><button type="button" class="ghost">Cancel</button></div>`
  const input = form.querySelector('textarea')
  input.value = value
  input.oninput = () => onInput(input.value)
  input.onkeydown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      form.requestSubmit()
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault()
    if (input.value.trim()) onSubmit(input.value.trim())
    else input.focus()
  }
  form.querySelector('button.ghost').onclick = onCancel
  return form
}

function renderColumn(column, index) {
  const element = document.createElement('section')
  element.className = 'column'
  element.dataset.columnId = column.id
  if (column.color) element.style.setProperty('--column-color', column.color)
  const cards = visibleCards(column.id)

  const head = document.createElement('header')
  head.className = 'column-head'
  head.draggable = !renamingColumn
  if (renamingColumn?.id === column.id) {
    const input = document.createElement('input')
    input.className = 'column-name-input'
    input.value = renamingColumn.text
    input.setAttribute('aria-label', 'Column name')
    input.dataset.focusKey = `rename:${column.id}`
    input.oninput = () => (renamingColumn.text = input.value)
    const finish = (save) => {
      if (!renamingColumn) return
      const name = renamingColumn.text.trim()
      renamingColumn = null
      if (save && name && name !== column.name) {
        send({ type: 'board:column-update', columnId: column.id, name })
      }
      renderBoard()
    }
    input.onkeydown = (event) => {
      if (event.key === 'Enter') finish(true)
      if (event.key === 'Escape') {
        event.stopPropagation()
        finish(false)
      }
    }
    input.onblur = () => finish(true)
    head.append(input)
  } else {
    const name = document.createElement('button')
    name.className = 'column-name'
    name.textContent = column.name
    name.dir = 'auto'
    name.title = `${column.name} (click to rename)`
    name.onclick = () => {
      renamingColumn = { id: column.id, text: column.name }
      renderBoard()
      document.querySelector(`[data-focus-key="rename:${column.id}"]`)?.select()
    }
    head.append(name)
  }
  // With a WIP limit the count is every open card, so filters can't hide a full column.
  const count = document.createElement('span')
  const total = wipCount(column.id)
  const limit = can('wip') ? column.wipLimit : null
  count.className = `column-count${limit && total > limit ? ' over-limit' : limit && total === limit ? ' at-limit' : ''}`
  count.textContent = limit ? `${total}/${limit}` : cards.length
  count.title = limit
    ? `${total} of ${limit} cards (WIP limit)${total > limit ? ' · over the limit' : ''}`
    : `${cards.length} ${cards.length === 1 ? 'card' : 'cards'}`
  const points = cards.reduce((sum, object) => sum + (object.archived ? 0 : object.points || 0), 0)
  const pointsChip = document.createElement('span')
  pointsChip.className = 'column-points'
  pointsChip.hidden = !points || !can('points')
  pointsChip.textContent = `${points} pts`
  pointsChip.title = `${points} points in this column`
  if (limit && total > limit) element.classList.add('over-limit')
  const tools = document.createElement('div')
  tools.className = 'column-tools'
  const tool = (iconName, label, onClick, disabled = false) => {
    const button = document.createElement('button')
    button.className = 'ghost'
    button.innerHTML = icon(iconName)
    button.setAttribute('aria-label', label)
    button.title = label
    button.disabled = disabled
    button.onclick = onClick
    tools.append(button)
    return button
  }
  tool('palette', 'Column color', () => {
    colorPickerColumn = colorPickerColumn === column.id ? null : column.id
    colorPickerEntering = true
    renderBoard()
    colorPickerEntering = false
  })
  if (can('wip')) {
    tool('gauge', 'WIP limit', () => {
      wipEditingColumn = wipEditingColumn === column.id ? null : column.id
      renderBoard()
      document.querySelector(`[data-focus-key="wip:${column.id}"]`)?.select()
    })
  }
  tool('left', 'Move column left', () => moveColumn(column.id, index - 1), index === 0)
  tool(
    'right',
    'Move column right',
    () => moveColumn(column.id, index + 1),
    index === columns.length - 1
  )
  const remove = tool(
    'trash',
    'Delete column (its cards move to the first column)',
    () => {
      if (!remove.classList.contains('danger')) {
        remove.className = 'danger'
        withIcon(remove, 'trash', 'Delete?')
        setTimeout(() => remove.isConnected && renderBoard(), 3000)
        return
      }
      send({ type: 'board:column-delete', columnId: column.id })
    },
    columns.length < 2
  )
  head.append(pointsChip, count, tools)
  head.ondragstart = (event) => {
    if (event.target !== head) return
    dragging = { kind: 'column', id: column.id }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', column.id)
    requestAnimationFrame(() => element.classList.add('dragging'))
  }
  head.ondragend = endDrag

  const list = document.createElement('div')
  list.className = 'column-cards'
  if (!cards.length) list.innerHTML = '<div class="column-empty">No cards</div>'
  for (const object of cards) list.append(renderCard(object))
  // The whole column takes a dropped card, not just its list of cards.
  element.ondragover = (event) => {
    if (dragging?.kind !== 'card') return
    event.preventDefault()
    const { items, index: at } = dropIndex(list, '.kanban-card', event.clientY, 'y')
    placeMarker(list, items, at, 'drop-marker')
  }
  element.ondragleave = (event) => {
    if (!element.contains(event.relatedTarget)) list.querySelector('.drop-marker')?.remove()
  }
  element.ondrop = (event) => {
    if (dragging?.kind !== 'card') return
    event.preventDefault()
    const { index: at } = dropIndex(list, '.kanban-card', event.clientY, 'y')
    moveCard(dragging.id, column.id, at)
    endDrag()
  }

  const foot = document.createElement('div')
  foot.className = 'column-foot'
  if (cardComposer?.columnId === column.id) {
    const composer = renderComposer({
      placeholder: 'Card title',
      value: cardComposer.text,
      submitLabel: 'Add card',
      onInput: (text) => (cardComposer.text = text),
      onSubmit: (title) => {
        send({ type: 'board:create', title, body: '', columnId: column.id })
        cardComposer = { columnId: column.id, text: '' }
        renderBoard()
      },
      onCancel: () => {
        cardComposer = null
        renderBoard()
      }
    })
    composer.querySelector('textarea').dataset.focusKey = `card:${column.id}`
    foot.append(composer)
  } else {
    const add = document.createElement('button')
    add.className = 'ghost'
    withIcon(add, 'plus', 'Add a card')
    add.onclick = () => {
      cardComposer = { columnId: column.id, text: '' }
      renderBoard()
      document.querySelector(`[data-focus-key="card:${column.id}"]`)?.focus()
    }
    const fromTemplate = document.createElement('button')
    fromTemplate.className = 'ghost icon-only'
    fromTemplate.innerHTML = icon('template')
    fromTemplate.setAttribute('aria-label', 'New card from a template')
    fromTemplate.setAttribute('aria-expanded', String(templatePickerColumn === column.id))
    fromTemplate.title = 'From template…'
    fromTemplate.dataset.focusKey = `template:${column.id}`
    fromTemplate.onclick = () => {
      templatePickerColumn = templatePickerColumn === column.id ? null : column.id
      renderBoard()
    }
    foot.append(add, fromTemplate)
    if (templatePickerColumn === column.id) foot.append(renderTemplatePicker(column))
  }

  element.append(head)
  if (can('wip') && wipEditingColumn === column.id) element.append(renderWipEditor(column))
  if (colorPickerColumn === column.id) {
    const colors = document.createElement('div')
    // Only the render that opens the row plays its entry, not later rebuilds.
    colors.className = colorPickerEntering ? 'column-colors entering' : 'column-colors'
    colors.setAttribute('role', 'group')
    colors.setAttribute('aria-label', 'Column color')
    colors.innerHTML =
      `<button type="button" class="swatch none" data-color="" aria-label="No color" aria-pressed="${!column.color}"></button>` +
      LABEL_COLORS.map(
        (color) =>
          `<button type="button" class="swatch" style="--label-color: ${color}" data-color="${color}" aria-label="Color ${color}" aria-pressed="${column.color === color}"></button>`
      ).join('')
    for (const swatch of colors.querySelectorAll('[data-color]')) {
      swatch.onclick = () => {
        send({
          type: 'board:column-update',
          columnId: column.id,
          color: swatch.dataset.color || null
        })
        colorPickerColumn = null
      }
    }
    element.append(colors)
  }
  element.append(list, foot)
  return element
}

// Inline row under the column header: a number, Enter saves, empty clears.
function renderWipEditor(column) {
  const form = document.createElement('form')
  form.className = 'wip-editor'
  form.innerHTML = `<label class="muted" for="wip-${escape(column.id)}">WIP limit</label>
    <input id="wip-${escape(column.id)}" type="number" min="1" max="999" inputmode="numeric" placeholder="None" value="${column.wipLimit ?? ''}" data-focus-key="wip:${escape(column.id)}" />
    <button>Save</button>${column.wipLimit ? '<button type="button" class="ghost">Clear</button>' : ''}`
  const input = form.querySelector('input')
  const save = (value) => {
    wipEditingColumn = null
    if (value !== column.wipLimit) {
      send({ type: 'board:column-update', columnId: column.id, wipLimit: value })
    }
    renderBoard()
  }
  form.onsubmit = (event) => {
    event.preventDefault()
    const value = input.value.trim() ? Math.round(Number(input.value)) : null
    if (value !== null && !(value >= 1 && value <= 999)) {
      input.setCustomValidity('Use a number from 1 to 999')
      input.reportValidity()
      return
    }
    save(value)
  }
  input.oninput = () => input.setCustomValidity('')
  input.onkeydown = (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    wipEditingColumn = null
    renderBoard()
  }
  form.querySelector('button.ghost')?.addEventListener('click', () => save(null))
  return form
}

// "From template…" under a column: each template card makes a copy here.
function renderTemplatePicker(column) {
  const menu = document.createElement('div')
  menu.className = 'template-picker'
  menu.setAttribute('role', 'menu')
  const list = templates()
  menu.innerHTML = list.length
    ? `<span class="section-label">From template</span>${list
        .map(
          (template) =>
            `<div class="template-option"><button type="button" class="ghost" role="menuitem" data-template-id="${escape(template.id)}"><span dir="auto">${escape(template.title)}</span>${template.checklist?.length ? `<span class="muted mono">${template.checklist.length} items</span>` : ''}</button><button type="button" class="ghost icon-only" data-template-edit="${escape(template.id)}" aria-label="Edit template ${escape(template.title)}" title="Edit template">${icon('edit')}</button></div>`
        )
        .join('')}`
    : '<p class="muted hint">No templates yet. Open a card and turn on “Use as template” to reuse it here.</p>'
  for (const button of menu.querySelectorAll('[data-template-id]')) {
    button.onclick = () => {
      request('card-created', {
        type: 'board:card-from-template',
        templateId: button.dataset.templateId,
        columnId: column.id
      })
      templatePickerColumn = null
      renderBoard()
    }
  }
  for (const button of menu.querySelectorAll('[data-template-edit]')) {
    button.onclick = () => {
      templatePickerColumn = null
      renderBoard()
      openCard(button.dataset.templateEdit)
    }
  }
  menu.onkeydown = (event) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    templatePickerColumn = null
    renderBoard()
    document.querySelector(`[data-focus-key="template:${column.id}"]`)?.focus()
  }
  return menu
}

function renderAddColumn() {
  const element = document.createElement('div')
  element.className = 'add-column'
  if (columnComposer) {
    const composer = renderComposer({
      placeholder: 'Column name',
      value: columnComposer.text,
      submitLabel: 'Add column',
      onInput: (text) => (columnComposer.text = text),
      onSubmit: (name) => {
        send({ type: 'board:column-create', name })
        columnComposer = { text: '' }
        renderBoard()
      },
      onCancel: () => {
        columnComposer = null
        renderBoard()
      }
    })
    composer.querySelector('textarea').dataset.focusKey = 'column'
    element.append(composer)
  } else {
    const add = document.createElement('button')
    add.className = 'secondary'
    withIcon(add, 'plus', 'Add a column')
    add.onclick = () => {
      columnComposer = { text: '' }
      renderBoard()
      document.querySelector('[data-focus-key="column"]')?.focus()
    }
    element.append(add)
  }
  return element
}

// Where each card and column sits, relative to the board, so the page moving
// (a banner, a panel opening) doesn't count as the board moving.
function boardRects() {
  const origin = boardObjects.getBoundingClientRect()
  const at = (element) => {
    const box = element.getBoundingClientRect()
    return { x: box.left - origin.left, y: box.top - origin.top }
  }
  const rects = { cards: new Map(), columns: new Map() }
  for (const element of boardObjects.querySelectorAll('.column')) {
    rects.columns.set(element.dataset.columnId, at(element))
  }
  for (const element of boardObjects.querySelectorAll('[data-card-id]')) {
    rects.cards.set(element.dataset.cardId, at(element))
  }
  return rects
}

// FLIP: cards and columns a peer moved slide from where they were. getBounding-
// ClientRect includes running animations, so a rebuild mid-slide retargets.
function animateBoardChanges(before) {
  // My own drag or keyboard move: everything it shifted lands instantly too.
  if (localCardMoves.size || localColumnMoves.size) return
  const after = boardRects()
  // On-screen movement, so ease-in-out rather than an entrance curve.
  const options = { duration: 220, easing: cssToken('--ease-in-out') }
  const shifted = (from, to) => Math.abs(from.x - to.x) + Math.abs(from.y - to.y) > 1
  const columnDelta = new Map()
  for (const element of boardObjects.querySelectorAll('.column')) {
    const id = element.dataset.columnId
    const from = before.columns.get(id)
    const to = after.columns.get(id)
    if (!from || localColumnMoves.has(id) || !shifted(from, to)) continue
    const dx = from.x - to.x
    const dy = from.y - to.y
    columnDelta.set(id, { dx, dy })
    if (reducedMotion.matches) {
      element.animate([{ opacity: 0.6 }, { opacity: 1 }], { ...options, duration: 120 })
    } else {
      element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        options
      )
    }
  }
  for (const element of boardObjects.querySelectorAll('[data-card-id]')) {
    const id = element.dataset.cardId
    const from = before.cards.get(id)
    const to = after.cards.get(id)
    if (!from || localCardMoves.has(id) || !shifted(from, to)) continue
    // Inside a sliding column the card already rides along; animate the rest.
    const column = columnDelta.get(element.closest('.column')?.dataset.columnId) || { dx: 0, dy: 0 }
    const dx = from.x - to.x - column.dx
    const dy = from.y - to.y - column.dy
    if (Math.abs(dx) + Math.abs(dy) <= 1) continue
    if (reducedMotion.matches) {
      element.animate([{ opacity: 0.6 }, { opacity: 1 }], { ...options, duration: 120 })
    } else {
      element.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        options
      )
    }
  }
}

function renderBoard({ animate = false } = {}) {
  // Rebuilding mid-drag would cancel the drag; catch up when it ends.
  if (dragging) {
    renderDeferred = true
    return
  }
  renderDeferred = false
  applyView()
  if (boardViewMode !== 'board') {
    renderAltView()
    renderBoardChrome()
    return
  }
  const before = animate ? boardRects() : null
  const active = document.activeElement
  const focus = active?.dataset?.focusKey
    ? { key: active.dataset.focusKey, start: active.selectionStart, end: active.selectionEnd }
    : active?.dataset?.cardId
      ? { cardId: active.dataset.cardId }
      : null
  const scrollLeft = boardObjects.scrollLeft
  const scrollTops = new Map(
    [...boardObjects.querySelectorAll('.column')].map((element) => [
      element.dataset.columnId,
      element.querySelector('.column-cards').scrollTop
    ])
  )

  boardObjects.innerHTML = ''
  columns.forEach((column, index) => boardObjects.append(renderColumn(column, index)))
  boardObjects.append(renderAddColumn())

  boardObjects.scrollLeft = scrollLeft
  for (const element of boardObjects.querySelectorAll('.column')) {
    element.querySelector('.column-cards').scrollTop = scrollTops.get(element.dataset.columnId) || 0
  }
  if (focus?.key) {
    const input = document.querySelector(`[data-focus-key="${focus.key}"]`)
    input?.focus()
    // Number inputs and buttons have no text selection to restore.
    if (typeof focus.start === 'number') input?.setSelectionRange?.(focus.start, focus.end)
  } else if (focus?.cardId) {
    document.querySelector(`[data-card-id="${focus.cardId}"]`)?.focus()
  }
  if (before) {
    animateBoardChanges(before)
    localCardMoves.clear()
    localColumnMoves.clear()
  }
  const finished =
    pendingCelebration && boardObjects.querySelector(`[data-card-id="${pendingCelebration}"]`)
  if (finished && cardById(pendingCelebration)?.columnId === doneColumnId()) {
    pendingCelebration = null
    burstFrom(finished)
  }
  renderBoardChrome()
}

// Everything around the cards that follows the board state, in every view.
function renderBoardChrome() {
  const archived = objects.filter((object) => object.archived && !object.template).length
  const archivedToggle = document.getElementById('archived-toggle')
  archivedToggle.hidden = !archived && !showArchived
  archivedToggle.textContent = `${showArchived ? 'Hide' : 'Show'} archived (${archived})`
  archivedToggle.setAttribute('aria-pressed', String(showArchived))
  renderColumnOptions(document.getElementById('object-column'))
  renderFilters()
  if (!document.getElementById('theme-panel').hidden) renderThemePanel()
  if (labelsModal.classList.contains('open')) renderLabelsManager()
  refreshCard()
  updateNotifications()
  renderPresence()
  if (rulesModal.classList.contains('open')) renderRules()
  refreshPanels()
}

// Board, table or calendar; the board's columns stay the default.
const viewContainers = {
  board: boardObjects,
  table: document.getElementById('board-table'),
  calendar: document.getElementById('board-calendar')
}

function applyView() {
  if (!viewContainers[boardViewMode]) boardViewMode = 'board'
  const loading = boardLoading.classList.contains('visible')
  for (const [mode, container] of Object.entries(viewContainers)) {
    const shown = !loading && mode === boardViewMode
    if (mode === 'board') container.style.display = shown ? 'flex' : 'none'
    else container.hidden = !shown
  }
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === boardViewMode))
  }
}

function setView(mode) {
  if (mode === boardViewMode) return
  boardViewMode = mode
  try {
    localStorage.setItem(VIEW_KEY, mode)
  } catch {}
  renderBoard()
}

const viewContext = () => ({
  columns,
  labels,
  memberName,
  dueInfo,
  dueBadge,
  labelChips,
  avatarStack,
  isDone,
  openCard,
  sort: tableSort,
  month: calendarMonth,
  openDay: calendarOpenDay,
  onMoreDay: (day) => {
    const previous = calendarOpenDay
    calendarOpenDay = day
    renderBoard()
    const focus = day ? `.calendar-popover .calendar-card` : `[data-more-day="${previous}"]`
    viewContainers.calendar.querySelector(focus)?.focus()
  },
  onSort: (key) => {
    tableSort.dir = tableSort.key === key && tableSort.dir === 'asc' ? 'desc' : 'asc'
    tableSort.key = key
    renderBoard()
    document.querySelector(`[data-sort="${key}"]`)?.focus()
  },
  onMonth: (step) => {
    calendarMonth = step
      ? new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + step, 1)
      : new Date()
    calendarOpenDay = null
    renderBoard()
    document.querySelector(`[data-month="${step}"]`)?.focus()
  },
  onDrag: (active) => {
    if (active) dragging = { kind: 'calendar' }
    else endDrag()
  },
  // A due date with a time keeps its time on the new day.
  onReschedule: (cardId, day) => {
    const object = cardById(cardId)
    const due = object && dueInfo(object.dueDate)
    if (!due) return
    let dueDate = day
    if (!due.dateOnly) {
      const [year, month, date] = day.split('-').map(Number)
      const moved = new Date(due.deadline)
      moved.setFullYear(year, month - 1, date)
      dueDate = moved.toISOString()
    }
    if (dueDate !== object.dueDate) send({ type: 'board:card-update', objectId: cardId, dueDate })
  }
})

function renderAltView() {
  const cards = objects.filter(isShown)
  const container = viewContainers[boardViewMode]
  const focusedCard = document.activeElement?.closest?.('[data-card-id]')?.dataset.cardId
  const scroll = container.querySelector('.table-scroll')?.scrollTop
  if (boardViewMode === 'table') renderTable(container, cards, viewContext())
  else renderCalendar(container, cards, viewContext())
  if (scroll) container.querySelector('.table-scroll').scrollTop = scroll
  if (focusedCard) container.querySelector(`[data-card-id="${focusedCard}"]`)?.focus()
}

for (const button of document.querySelectorAll('[data-view]')) {
  button.innerHTML = `${icon(button.dataset.view)}<span>${escape(button.textContent.trim())}</span>`
  button.onclick = () => setView(button.dataset.view)
}

function renderFilters() {
  // Labels deleted by someone else drop out of the filter.
  for (const id of filters.labels) {
    if (!labels.some((label) => label.id === id)) filters.labels.delete(id)
  }
  const toggle = document.getElementById('filter-toggle')
  const count = filterCount()
  toggle.textContent = count ? `Filter (${count})` : 'Filter'
  toggle.classList.toggle('active', count > 0)
  const labelBox = document.getElementById('filter-labels')
  labelBox.innerHTML = labels.length
    ? labels
        .map(
          (label) =>
            `<button type="button" class="label-chip" style="--label-color: ${label.color || '#8590a2'}" data-label-id="${escape(label.id)}" aria-pressed="${filters.labels.has(label.id)}">${escape(label.name || ' ')}</button>`
        )
        .join('')
    : '<span class="muted">No labels yet</span>'
  for (const chip of labelBox.querySelectorAll('[data-label-id]')) {
    chip.onclick = () => {
      const id = chip.dataset.labelId
      if (filters.labels.has(id)) filters.labels.delete(id)
      else filters.labels.add(id)
      renderBoard()
    }
  }
  const member = document.getElementById('filter-member')
  if (document.activeElement !== member) {
    member.innerHTML = `<option value="">Anyone</option>${Object.entries(profiles)
      .map(
        ([identity, name]) =>
          `<option value="${escape(identity)}">${escape(identity === currentIdentity ? `${name} (you)` : name)}</option>`
      )
      .join('')}`
    member.value = filters.member
  }
  const assignee = document.getElementById('filter-assignee')
  if (document.activeElement !== assignee) {
    const people = members.filter((m) => !m.banned && m.identity !== currentIdentity)
    assignee.innerHTML = `<option value="">Anyone</option><option value="${escape(currentIdentity)}">Assigned to me</option><option value="none">Unassigned</option>${people
      .map(
        (member) =>
          `<option value="${escape(member.identity)}">${escape(memberName(member.identity))}</option>`
      )
      .join('')}`
    assignee.value = filters.assignee
  }
  document.getElementById('filter-due').value = filters.due
  const shown = objects.filter(isShown).length
  const total = objects.filter((o) => !o.template && (showArchived || !o.archived)).length
  document.getElementById('filter-summary').textContent = count
    ? `Showing ${shown} of ${total} cards`
    : ''
  document.getElementById('filter-clear').hidden = !count
  const mine = document.getElementById('filter-mine')
  mine.setAttribute(
    'aria-pressed',
    String(!!currentIdentity && filters.assignee === currentIdentity)
  )
  mine.classList.toggle('active', !!currentIdentity && filters.assignee === currentIdentity)
}

document.getElementById('theme-toggle').onclick = () => {
  const panel = document.getElementById('theme-panel')
  panel.hidden = !panel.hidden
  document.getElementById('theme-toggle').setAttribute('aria-expanded', String(!panel.hidden))
  if (!panel.hidden) renderThemePanel()
}
document.getElementById('filter-toggle').onclick = () => {
  const panel = document.getElementById('filter-panel')
  panel.hidden = !panel.hidden
  document.getElementById('filter-toggle').setAttribute('aria-expanded', String(!panel.hidden))
}
document.getElementById('filter-member').onchange = (event) => {
  filters.member = event.target.value
  renderBoard()
}
document.getElementById('filter-assignee').onchange = (event) => {
  filters.assignee = event.target.value
  renderBoard()
}
document.getElementById('filter-due').onchange = (event) => {
  filters.due = event.target.value
  renderBoard()
}
document.getElementById('filter-clear').onclick = () => {
  filters.labels.clear()
  filters.member = ''
  filters.due = ''
  filters.assignee = ''
  renderBoard()
}

boardObjects.ondragover = (event) => {
  if (dragging?.kind !== 'column') return
  event.preventDefault()
  const { items, index } = dropIndex(boardObjects, '.column', event.clientX, 'x')
  placeMarker(boardObjects, items, index, 'column-drop-marker')
}
boardObjects.ondrop = (event) => {
  if (dragging?.kind !== 'column') return
  event.preventDefault()
  const { index } = dropIndex(boardObjects, '.column', event.clientX, 'x')
  moveColumn(dragging.id, index)
  endDrag()
}

function renderColumnOptions(select, selected = select.value) {
  if (document.activeElement === select) return
  select.innerHTML = columns
    .map((column) => `<option value="${escape(column.id)}">${escape(column.name)}</option>`)
    .join('')
  select.value = columns.some((column) => column.id === selected) ? selected : columns[0]?.id
}

// Card details: built once per open, then refreshed in place on every
// board-state so typing in the title, description or comment survives.
const cardModal = document.getElementById('card-modal')
const cardTitle = document.getElementById('card-title')
const cardBody = document.getElementById('card-body')
const cardColumn = document.getElementById('card-column')
let cardFocusReturn = null

function openCard(id) {
  const object = cardById(id)
  if (!object) return
  cardFocusReturn = document.activeElement
  openCardId = id
  cardTitle.value = object.title
  setEditingBody(false)
  labelDraft = null
  showAllComments = false
  document.getElementById('card-label-new').value = ''
  closeDuePopover()
  document.getElementById('card-comment').value = ''
  document.getElementById('card-image-error').hidden = true
  reactionPicker = null
  checklistEditing = null
  checklistShowAll = false
  linksShowAll = false
  lastChecklist = { cardId: null, complete: false }
  lastReveal = { cardId: null, revealed: false }
  setTypingLine('')
  assigneeDraft = null
  closeAssignPopover()
  closeLinkForm()
  document.getElementById('card-checklist-new').value = ''
  setCardTab('comments')
  renderCardGallery(object)
  refreshCard()
  cardModal.classList.add('open')
  cardTitle.focus()
  stopTyping()
  setPresence(false)
}

// Rebuilt only when the card's images change, so a refresh doesn't flash them.
function renderCardGallery(object) {
  const gallery = document.getElementById('card-images')
  const keys = (object.images || []).map(imageKey).join('|')
  if (gallery.dataset.keys === keys) return
  gallery.dataset.keys = keys
  gallery.innerHTML = ''
  if (object.images?.length) renderImages(cardModal, object)
  gallery.hidden = !object.images?.length
}

function closeCard() {
  if (!openCardId) return
  openCardId = null
  stopTyping()
  setPresence(false)
  cardModal.classList.remove('open')
  const target = cardFocusReturn?.dataset?.cardId
  cardFocusReturn = null
  if (target) document.querySelector(`[data-card-id="${target}"]`)?.focus()
}

function refreshCard() {
  if (!openCardId) return
  const object = cardById(openCardId)
  if (!object) return closeCard()
  if (document.activeElement !== cardTitle) cardTitle.value = object.title
  if (!editingBody) {
    const view = document.getElementById('card-body-view')
    view.innerHTML = ''
    view.classList.toggle('empty', !object.body?.trim())
    if (object.body?.trim()) view.append(markdownFor(object.body, object.mentions, object.images))
    else view.textContent = 'Add a more detailed description…'
  }
  document.getElementById('card-author').innerHTML =
    `${identityHtml(object.author)}<span class="time">${escape(relativeTime(object.createdAt))}</span>`
  renderColumnOptions(cardColumn, object.columnId)
  document.getElementById('card-archived-badge').hidden = !object.archived
  refreshCardExtras(object)
  renderCardLabels(object)
  renderCardGallery(object)
  refreshDue(object)
  document.getElementById('card-archive').textContent = object.archived ? 'Restore' : 'Archive'

  const ownVote = object.votes?.[currentIdentity] || 0
  document.getElementById('card-score').textContent = scoreOf(object)
  for (const button of cardModal.querySelectorAll('[data-card-vote]')) {
    const value = Number(button.dataset.cardVote)
    button.innerHTML = icon(value === 1 ? 'up' : 'down')
    button.className = ownVote === value ? (value === 1 ? 'voted-up' : 'voted-down') : ''
    button.setAttribute('aria-pressed', String(ownVote === value))
  }

  const list = document.getElementById('card-comments')
  keepFocus(list, () => renderComments(list, object))
  markAlertsRead((alert) => alert.boardKey === currentBoardKey && alert.cardId === object.id)
}

function renderComments(list, object) {
  list.innerHTML = ''
  const comments = [...(object.comments || [])].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  )
  // Long threads show the latest comments; older ones are one click away.
  const hidden = showAllComments ? 0 : Math.max(0, comments.length - COMMENTS_SHOWN)
  if (hidden) {
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'ghost comments-more'
    more.textContent = `Show ${hidden} earlier ${hidden === 1 ? 'comment' : 'comments'}`
    more.onclick = () => {
      showAllComments = true
      refreshCard()
    }
    list.appendChild(more)
  }
  for (const comment of comments.slice(hidden)) list.appendChild(renderComment(comment))
}

function refreshDue(object) {
  const due = dueInfo(object.dueDate)
  const button = document.getElementById('card-due-button')
  button.className = `ghost due-button${due ? ` set ${due.status}` : ''}`
  button.innerHTML = due
    ? `${icon('clock')}<span>${escape(due.text)}${due.status === 'overdue' ? ' · overdue' : due.status === 'soon' ? ' · due soon' : ''}</span>`
    : `${icon('plus')}<span>Add due date</span>`
}

// Asks the worker for something it answers with a matching requestId.
function request(kind, message) {
  const requestId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  latestRequest[kind] = requestId
  send({ ...message, requestId })
}

// Rebuilds `container` and puts focus (and the caret) back on the element
// with the same focus key, so a peer's change doesn't interrupt typing.
function keepFocus(container, build) {
  const active = document.activeElement
  const key = container.contains(active) ? active.dataset.focusKey : null
  const start = active?.selectionStart
  const end = active?.selectionEnd
  build()
  if (!key) return
  const next = container.querySelector(`[data-focus-key="${key}"]`)
  next?.focus()
  if (typeof start === 'number') next?.setSelectionRange?.(start, end)
}

// Presence: which card is open here, and whether a comment is being typed.
// typing:true goes out at most every 3s and lapses 4s after the last key.
let typingSentAt = 0
let typingTimer = null

function setPresence(typing) {
  if (roomEntered) send({ type: 'board:presence-set', cardId: openCardId, typing })
}

function noteTyping() {
  if (!openCardId) return
  clearTimeout(typingTimer)
  typingTimer = setTimeout(stopTyping, 4000)
  if (Date.now() - typingSentAt < 3000) return
  typingSentAt = Date.now()
  setPresence(true)
}

function stopTyping() {
  clearTimeout(typingTimer)
  typingTimer = null
  if (!typingSentAt) return
  typingSentAt = 0
  setPresence(false)
}

const presenceKey = () =>
  presencePeers.map((peer) => `${peer.identity}:${peer.cardId || ''}`).join('|')

// Faces animate in for people who join while the board is open, not for
// everyone already there when it opens.
let presencePrimed = false
const knownPresence = new Set()
let presenceEntering = new Set()
let presenceHeaderHtml = ''

function onPresence(message) {
  const before = presenceKey()
  presencePeers = (message.peers || []).filter((peer) => peer.identity !== currentIdentity)
  presenceEntering = new Set(
    presencePrimed
      ? presencePeers.map((peer) => peer.identity).filter((id) => !knownPresence.has(id))
      : []
  )
  knownPresence.clear()
  for (const peer of presencePeers) knownPresence.add(peer.identity)
  presencePrimed = true
  // Card faces only change when someone opens or closes a card.
  if (presenceKey() !== before && boardViewMode === 'board') renderBoard()
  else renderPresence()
}

const listNames = (names) =>
  names.length < 3
    ? names.join(' and ')
    : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`

// Who is on the board now (header) and on the open card (details).
function renderPresence() {
  const header = document.getElementById('presence')
  header.hidden = !presencePeers.length
  const identities = presencePeers.map((peer) => peer.identity)
  const html = presencePeers.length
    ? `${avatarStack(identities, 4)}<span class="presence-label">${presencePeers.length} online</span>`
    : ''
  // Rebuilt only when it changes, so an entrance isn't cut short by a re-render.
  if (html !== presenceHeaderHtml) {
    presenceHeaderHtml = html
    header.innerHTML = presencePeers.length
      ? `${avatarStack(identities, 4, presenceEntering)}<span class="presence-label">${presencePeers.length} online</span>`
      : ''
  }
  presenceEntering = new Set()
  header.title = presencePeers
    .map((peer) => {
      const card = peer.cardId && cardById(peer.cardId)
      return `${memberName(peer.identity)}${card ? ` · viewing “${card.title}”` : ''}`
    })
    .join('\n')
  if (!openCardId) return
  const here = peersOn(openCardId)
  const viewers = document.getElementById('card-viewers')
  viewers.hidden = !here.length
  viewers.innerHTML = here.length
    ? `${avatarStack(
        here.map((peer) => peer.identity),
        4
      )}<span>${escape(listNames(here.map((peer) => memberName(peer.identity))))} ${here.length === 1 ? 'is' : 'are'} here</span>`
    : ''
  const typing = here.filter((peer) => peer.typing).map((peer) => memberName(peer.identity))
  setTypingLine(
    typing.length ? `${listNames(typing)} ${typing.length === 1 ? 'is' : 'are'} typing…` : ''
  )
}

// The line keeps its height; the text fades out and is cleared once invisible.
function setTypingLine(text) {
  const line = document.getElementById('card-typing')
  if (text) {
    line.textContent = text
    line.classList.remove('idle')
    return
  }
  if (line.classList.contains('idle')) return
  line.classList.add('idle')
  line.addEventListener(
    'transitionend',
    () => {
      if (line.classList.contains('idle')) line.textContent = ''
    },
    { once: true }
  )
}

// Emoji chips with counts (mine highlighted) and a picker for the rest.
function reactionBar(reactions, key, onToggle) {
  const bar = document.createElement('div')
  bar.className = 'reaction-row'
  const used = REACTIONS.filter((emoji) => reactions?.[emoji]?.length)
  for (const emoji of used) {
    const who = reactions[emoji]
    const mine = who.includes(currentIdentity)
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = `reaction${mine ? ' mine' : ''}`
    chip.setAttribute('aria-pressed', String(mine))
    chip.title = listNames(who.map(memberName))
    chip.setAttribute('aria-label', `${emoji} ${who.length}: ${chip.title}`)
    chip.innerHTML = `<span aria-hidden="true">${emoji}</span><span class="mono">${who.length}</span>`
    chip.dataset.focusKey = `reaction:${key}:${emoji}`
    chip.onclick = () => onToggle(emoji, !mine)
    bar.append(chip)
  }
  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'reaction add'
  add.innerHTML = `${icon('smile')}${used.length ? '' : '<span>React</span>'}`
  add.setAttribute('aria-label', 'Add reaction')
  add.setAttribute('aria-expanded', String(reactionPicker === key))
  add.dataset.focusKey = `reaction-add:${key}`
  add.onclick = () => {
    reactionPicker = reactionPicker === key ? null : key
    refreshCard()
  }
  bar.append(add)
  if (reactionPicker === key) {
    // One picker node per open picker, moved into each rebuilt bar, so a
    // peer's update doesn't replay its entrance.
    let picker = pickerNode?.key === key ? pickerNode.element : null
    if (!picker) {
      picker = document.createElement('div')
      picker.className = 'reaction-picker'
      picker.setAttribute('role', 'group')
      picker.setAttribute('aria-label', 'Pick a reaction')
      for (const emoji of REACTIONS) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = emoji
        button.dataset.focusKey = `reaction-pick:${key}:${emoji}`
        picker.append(button)
      }
      picker.onkeydown = (event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        reactionPicker = null
        refreshCard()
      }
      pickerNode = { key, element: picker }
      picker.animate(
        reducedMotion.matches
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'scale(0.97)' },
              { opacity: 1, transform: 'none' }
            ],
        { duration: 140, easing: cssToken('--ease-out') }
      )
    }
    for (const button of picker.querySelectorAll('button')) {
      const emoji = button.textContent
      const mine = !!reactions?.[emoji]?.includes(currentIdentity)
      button.className = `ghost${mine ? ' mine' : ''}`
      button.setAttribute('aria-pressed', String(mine))
      button.onclick = () => {
        reactionPicker = null
        onToggle(emoji, !mine)
        refreshCard()
      }
    }
    bar.append(picker)
  }
  return bar
}

// Everything in the card details added on top of title, labels, due and comments.
function refreshCardExtras(object) {
  document.getElementById('card-template-badge').hidden = !object.template
  const blocked = document.getElementById('card-blocked-badge')
  blocked.hidden = !object.blockedBy?.length
  blocked.innerHTML = `${icon('lock')}Blocked`
  document.getElementById('card-template-toggle').checked = !!object.template
  const reactions = document.getElementById('card-reactions')
  keepFocus(reactions, () => {
    reactions.innerHTML = ''
    reactions.append(
      reactionBar(object.reactions, 'card', (emoji, on) =>
        send({ type: 'board:reaction-set', objectId: object.id, emoji, on })
      )
    )
  })
  renderAssignees(object)
  renderEstimate(object)
  renderChecklist(object)
  renderLinks(object)
  renderPresence()
}

// Assignees: chips with remove, and a popover of members to toggle.
const currentAssignees = (object) => assigneeDraft || object?.assignees || []

function setAssignees(object, assignees) {
  assigneeDraft = assignees
  send({ type: 'board:card-update', objectId: object.id, assignees })
  renderAssignees(object)
}

function renderAssignees(object) {
  const list = document.getElementById('card-assignees')
  const assigned = currentAssignees(object)
  keepFocus(list, () => {
    list.innerHTML = `${assigned
      .map(
        (identity) =>
          `<span class="assignee-chip">${avatar(identity)}<span dir="auto">${escape(memberName(identity))}</span><button type="button" class="ghost" data-unassign="${escape(identity)}" data-focus-key="unassign:${escape(identity)}" aria-label="Unassign ${escape(memberName(identity))}">✕</button></span>`
      )
      .join(
        ''
      )}<button id="card-assign-button" type="button" class="ghost due-button" aria-haspopup="dialog" aria-expanded="${!document.getElementById('assign-popover').hidden}" data-focus-key="assign">${icon(assigned.length ? 'plus' : 'user')}<span>${assigned.length ? 'Add' : 'Assign'}</span></button>${
      assigned.includes(currentIdentity) || !currentIdentity
        ? ''
        : '<button type="button" class="ghost assign-me" data-focus-key="assign-me">Assign me</button>'
    }`
  })
  for (const button of list.querySelectorAll('[data-unassign]')) {
    button.onclick = () =>
      setAssignees(
        object,
        currentAssignees(object).filter((identity) => identity !== button.dataset.unassign)
      )
  }
  list
    .querySelector('.assign-me')
    ?.addEventListener('click', () =>
      setAssignees(object, [...currentAssignees(object), currentIdentity])
    )
  document.getElementById('card-assign-button').onclick = () => {
    const popover = document.getElementById('assign-popover')
    if (popover.hidden) openAssignPopover()
    else closeAssignPopover({ focusButton: true })
  }
  const options = document.getElementById('assign-options')
  if (document.getElementById('assign-popover').hidden) return
  const people = members.filter((member) => !member.banned || assigned.includes(member.identity))
  keepFocus(options, () => {
    options.innerHTML = people.length
      ? people
          .map((member) => {
            const on = assigned.includes(member.identity)
            return `<button type="button" class="assign-option${on ? ' on' : ''}" aria-pressed="${on}" data-assign="${escape(member.identity)}" data-focus-key="assign-option:${escape(member.identity)}">${avatar(member.identity)}<span dir="auto">${escape(memberName(member.identity))}${member.identity === currentIdentity ? ' (you)' : ''}</span><span class="check-mark" aria-hidden="true">${on ? '✓' : ''}</span></button>`
          })
          .join('')
      : '<span class="muted hint">No members yet</span>'
  })
  for (const button of options.querySelectorAll('[data-assign]')) {
    button.onclick = () => {
      const ids = currentAssignees(object)
      const id = button.dataset.assign
      setAssignees(object, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
    }
  }
}

function openAssignPopover() {
  document.getElementById('assign-popover').hidden = false
  const object = cardById(openCardId)
  if (object) renderAssignees(object)
  document.querySelector('#assign-options button')?.focus()
}

function closeAssignPopover({ focusButton = false } = {}) {
  const popover = document.getElementById('assign-popover')
  if (popover.hidden) return
  popover.hidden = true
  const button = document.getElementById('card-assign-button')
  button?.setAttribute('aria-expanded', 'false')
  if (focusButton) button?.focus()
}

document.getElementById('assign-popover').onkeydown = (event) => {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  closeAssignPopover({ focusButton: true })
}
document.addEventListener('mousedown', (event) => {
  if (!event.target.closest('.assign-anchor')) closeAssignPopover()
  if (calendarOpenDay && !event.target.closest('.calendar-popover, [data-more-day]')) {
    calendarOpenDay = null
    renderBoard()
  }
})

// Planning poker: votes stay hidden until someone reveals them; then the
// suggested value (the median, rounded up to the deck) can become the points.
function suggestedPoints(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted[Math.floor((sorted.length - 1) / 2)]
  return ESTIMATES.find((value) => value >= middle) ?? Math.round(middle)
}

function renderEstimate(object) {
  const box = document.getElementById('card-estimate')
  const points = document.getElementById('card-points')
  const hasPoints = object.points !== null && object.points !== undefined
  points.hidden = !hasPoints
  points.textContent = hasPoints ? `${object.points} ${object.points === 1 ? 'pt' : 'pts'}` : ''
  const votes = Object.entries(object.estimates || {})
  const mine = object.estimates?.[currentIdentity]
  const revealed = !!object.revealEstimates
  // Votes flip over one after another, only at the moment they are revealed.
  // The flip keeps its class until it has played, so refreshes in between
  // leave the markup (and the running animation) alone.
  if (lastReveal.cardId === object.id && !lastReveal.revealed && revealed) {
    revealUntil = Date.now() + 600
  }
  lastReveal = { cardId: object.id, revealed }
  const flipping = revealed && Date.now() < revealUntil
  const deck = [...ESTIMATES, null]
    .map((value) => {
      const on = value === null ? false : mine === value
      return `<button type="button" class="poker-card${on ? ' on' : ''}" aria-pressed="${on}" data-estimate="${value ?? ''}" data-focus-key="estimate:${value ?? '?'}" title="${value === null ? 'Not sure (removes my vote)' : `Vote ${value}`}">${value ?? '?'}</button>`
    })
    .join('')
  const voters = votes.length
    ? votes
        .map(
          ([identity, value], index) =>
            `<span class="poker-vote" title="${escape(memberName(identity))}">${avatar(identity)}<span class="poker-value${revealed || identity === currentIdentity ? '' : ' hidden'}${flipping ? ' reveal' : ''}" style="--i: ${index}">${revealed || identity === currentIdentity ? value : '•'}</span></span>`
        )
        .join('')
    : '<span class="muted hint">No votes yet</span>'
  const suggestion =
    revealed && votes.length ? suggestedPoints(votes.map(([, value]) => value)) : null
  const actions = [
    votes.length
      ? `<button type="button" class="ghost" data-reveal="${!revealed}" data-focus-key="reveal">${revealed ? 'Hide votes' : `Reveal ${votes.length} ${votes.length === 1 ? 'vote' : 'votes'}`}</button>`
      : '',
    suggestion !== null && suggestion !== object.points
      ? `<button type="button" class="secondary" data-use-points="${suggestion}" data-focus-key="use-points">Use ${suggestion}</button>`
      : '',
    hasPoints
      ? '<button type="button" class="ghost" data-clear-points data-focus-key="clear-points">Clear points</button>'
      : ''
  ].join('')
  const html = `<div class="poker-deck" role="group" aria-label="Your estimate">${deck}</div><div class="row poker-status"><span class="poker-votes">${voters}</span>${actions}</div>`
  if (box.dataset.html !== html) {
    box.dataset.html = html
    keepFocus(box, () => (box.innerHTML = html))
  }
  for (const button of box.querySelectorAll('[data-estimate]')) {
    button.onclick = () => {
      const value = button.dataset.estimate === '' ? null : Number(button.dataset.estimate)
      send({
        type: 'board:estimate-set',
        objectId: object.id,
        value: value === mine ? null : value
      })
    }
  }
  // The markup may be reused, so handlers are assigned, not added.
  const on = (selector, handler) => {
    const button = box.querySelector(selector)
    if (button) button.onclick = handler
  }
  on('[data-reveal]', (event) =>
    send({
      type: 'board:card-update',
      objectId: object.id,
      revealEstimates: event.currentTarget.dataset.reveal === 'true'
    })
  )
  on('[data-use-points]', (event) =>
    send({
      type: 'board:card-update',
      objectId: object.id,
      points: Number(event.currentTarget.dataset.usePoints)
    })
  )
  on('[data-clear-points]', () =>
    send({ type: 'board:card-update', objectId: object.id, points: null })
  )
}

// Checklist: toggle, rename in place, delete, Alt+↑/↓ to reorder.
function sendChecklist(object, fields) {
  send({ type: 'board:checklist-set', objectId: object.id, ...fields })
}

function renderChecklist(object) {
  const items = object.checklist || []
  const done = items.filter((item) => item.done).length
  const complete = !!items.length && done === items.length
  const count = document.getElementById('card-checklist-count')
  count.textContent = items.length ? `${done}/${items.length}` : ''
  if (lastChecklist.cardId === object.id && !lastChecklist.complete && complete) {
    count.classList.add('bump')
    count.addEventListener('animationend', () => count.classList.remove('bump'), { once: true })
  }
  lastChecklist = { cardId: object.id, complete }
  const progress = document.getElementById('card-checklist-progress')
  progress.hidden = !items.length
  progress.classList.toggle('complete', complete)
  progress.querySelector('span').style.setProperty('--p', items.length ? done / items.length : 0)
  const hide = document.getElementById('card-checklist-hide')
  hide.hidden = !done
  hide.setAttribute('aria-pressed', String(hideCheckedItems))
  hide.textContent = hideCheckedItems ? `Show checked (${done})` : 'Hide checked'
  const list = document.getElementById('card-checklist')
  if (checklistEditing && !items.some((item) => item.id === checklistEditing.itemId)) {
    checklistEditing = null
  }
  const shown = items.filter(
    (item) => !hideCheckedItems || !item.done || checklistEditing?.itemId === item.id
  )
  const hidden = checklistShowAll ? 0 : Math.max(0, shown.length - COLLAPSED_ROWS)
  const visible = new Set(shown.slice(0, shown.length - hidden).map((item) => item.id))
  keepFocus(list, () => {
    list.innerHTML = ''
    items.forEach((item, index) => {
      if (!visible.has(item.id)) return
      const row = document.createElement('li')
      row.className = `checklist-item${item.done ? ' done' : ''}`
      const editing = checklistEditing?.itemId === item.id
      row.innerHTML = `<input type="checkbox" ${item.done ? 'checked' : ''} aria-label="${escape(item.text)}" data-focus-key="check:${escape(item.id)}" title="Alt+↑/↓ to reorder" />${
        editing
          ? `<input class="item-edit" maxlength="300" dir="auto" aria-label="Item text" data-focus-key="edit:${escape(item.id)}" />`
          : `<span class="item-text" dir="auto" role="button" tabindex="0" data-focus-key="text:${escape(item.id)}" title="Click to edit">${escape(item.text)}</span>`
      }<button type="button" class="ghost icon-only" aria-label="Delete item ${escape(item.text)}" data-focus-key="delete:${escape(item.id)}">${icon('trash')}</button>`
      const [checkbox] = row.querySelectorAll('input')
      checkbox.onchange = () => sendChecklist(object, { itemId: item.id, done: checkbox.checked })
      row.onkeydown = (event) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
        event.preventDefault()
        const target = index + (event.key === 'ArrowUp' ? -1 : 1)
        if (target < 0 || target >= items.length) return
        sendChecklist(object, { itemId: item.id, index: target })
      }
      row.querySelector('button').onclick = () =>
        sendChecklist(object, { itemId: item.id, deleted: true })
      if (editing) {
        const input = row.querySelector('.item-edit')
        input.value = checklistEditing.text
        input.oninput = () => (checklistEditing.text = input.value)
        const finish = (save) => {
          if (checklistEditing?.itemId !== item.id) return
          const text = checklistEditing.text.trim()
          checklistEditing = null
          if (save && text && text !== item.text) sendChecklist(object, { itemId: item.id, text })
          renderChecklist(object)
          list.querySelector(`[data-focus-key="text:${item.id}"]`)?.focus()
        }
        input.onkeydown = (event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            finish(true)
          } else if (event.key === 'Escape') {
            event.stopPropagation()
            finish(false)
          }
        }
        input.onblur = () => finish(true)
      } else {
        const text = row.querySelector('.item-text')
        const edit = () => {
          checklistEditing = { itemId: item.id, text: item.text }
          renderChecklist(object)
          list.querySelector(`[data-focus-key="edit:${item.id}"]`)?.focus()
        }
        text.onclick = edit
        text.onkeydown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            edit()
          }
        }
      }
      list.append(row)
    })
    if (hidden) {
      list.append(showAllRow('checklist-all', shown.length, () => (checklistShowAll = true)))
    }
  })
}

// "Show all N" under a collapsed list; the list rebuilds expanded.
function showAllRow(key, total, expand) {
  const row = document.createElement('li')
  row.className = 'show-all-row'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'ghost show-all'
  button.textContent = `Show all ${total}`
  button.dataset.focusKey = key
  button.onclick = () => {
    expand()
    refreshCard()
  }
  row.append(button)
  return row
}

document.getElementById('card-checklist-form').onsubmit = (event) => {
  event.preventDefault()
  const input = document.getElementById('card-checklist-new')
  const object = cardById(openCardId)
  const text = input.value.trim()
  if (!object || !text) return input.focus()
  sendChecklist(object, { text })
  input.value = ''
}
document.getElementById('card-checklist-hide').onclick = () => {
  hideCheckedItems = !hideCheckedItems
  refreshCard()
}

// Links: outgoing ones live on this card; incoming ones are other cards'
// links pointing here ("blocked by" when they block this one).
function cardLinks(object) {
  const outgoing = (object.links || []).map((link) => ({
    ...link,
    from: object.id,
    to: link.cardId,
    other: link.cardId,
    label: link.kind === 'blocks' ? 'Blocks' : 'Relates to'
  }))
  const incoming = objects.flatMap((other) =>
    (other.links || [])
      .filter((link) => link.cardId === object.id)
      .map((link) => ({
        kind: link.kind,
        from: other.id,
        to: object.id,
        other: other.id,
        label: link.kind === 'blocks' ? 'Blocked by' : 'Relates to'
      }))
  )
  return [...outgoing, ...incoming]
}

function renderLinks(object) {
  const list = document.getElementById('card-links')
  const links = cardLinks(object).filter((link) => cardById(link.other))
  const order = { 'Blocked by': 0, Blocks: 1, 'Relates to': 2 }
  links.sort((a, b) => order[a.label] - order[b.label])
  const hidden = linksShowAll ? 0 : Math.max(0, links.length - COLLAPSED_ROWS)
  keepFocus(list, () => {
    list.innerHTML = links.length
      ? links
          .slice(0, links.length - hidden)
          .map((link) => {
            const other = cardById(link.other)
            const column = columns.find((entry) => entry.id === other.columnId)
            const open = link.label === 'Blocked by' && object.blockedBy?.includes(other.id)
            return `<div class="link-row"><span class="link-kind${open ? ' blocking' : ''}">${escape(link.label)}</span><button type="button" class="link-title" data-open-card="${escape(other.id)}" title="${escape(other.title)}" data-focus-key="link-open:${escape(link.from)}:${escape(link.to)}" dir="auto">${escape(other.title)}</button><span class="muted link-column${isDone(other) ? ' done' : ''}" dir="auto">${isDone(other) ? '✓ ' : ''}${escape(column?.name || '')}</span><button type="button" class="ghost icon-only" data-unlink="${escape(link.from)}|${escape(link.to)}|${link.kind}" aria-label="Remove link to ${escape(other.title)}" data-focus-key="unlink:${escape(link.from)}:${escape(link.to)}">✕</button></div>`
          })
          .join('')
      : '<span class="muted hint">No links. Link cards that block or relate to this one.</span>'
    if (hidden) {
      const row = showAllRow('links-all', links.length, () => (linksShowAll = true))
      list.append(row.firstChild)
    }
  })
  for (const button of list.querySelectorAll('[data-open-card]')) {
    button.onclick = () => openCard(button.dataset.openCard)
  }
  for (const button of list.querySelectorAll('[data-unlink]')) {
    button.onclick = () => {
      const [objectId, targetId, kind] = button.dataset.unlink.split('|')
      send({ type: 'board:link-set', objectId, targetId, kind, linked: false })
    }
  }
  if (!document.getElementById('card-link-form').hidden) renderLinkResults()
}

function renderLinkResults() {
  const object = cardById(openCardId)
  const box = document.getElementById('card-link-results')
  if (!object) return
  const query = document.getElementById('card-link-search').value.trim().toLowerCase()
  const linked = new Set(cardLinks(object).map((link) => link.other))
  const matches = objects
    .filter(
      (other) =>
        other.id !== object.id &&
        !other.template &&
        !other.archived &&
        !linked.has(other.id) &&
        (!query || other.title.toLowerCase().includes(query))
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 6)
  keepFocus(box, () => {
    box.innerHTML = matches.length
      ? matches
          .map((other) => {
            const column = columns.find((entry) => entry.id === other.columnId)
            return `<button type="button" role="option" class="link-result" data-link-target="${escape(other.id)}" data-focus-key="link-target:${escape(other.id)}"><span dir="auto">${escape(other.title)}</span><span class="muted" dir="auto">${escape(column?.name || '')}</span></button>`
          })
          .join('')
      : `<span class="muted hint">${query ? 'No cards match.' : 'No other cards to link.'}</span>`
  })
  for (const button of box.querySelectorAll('[data-link-target]')) {
    button.onclick = () => addLink(button.dataset.linkTarget)
  }
}

function addLink(targetId) {
  const object = cardById(openCardId)
  if (!object) return
  const kind = document.getElementById('card-link-kind').value
  // "Blocked by" is the other card blocking this one.
  send(
    kind === 'blocked-by'
      ? {
          type: 'board:link-set',
          objectId: targetId,
          targetId: object.id,
          kind: 'blocks',
          linked: true
        }
      : { type: 'board:link-set', objectId: object.id, targetId, kind, linked: true }
  )
  linkKind = kind
  closeLinkForm({ focusButton: true })
}

function closeLinkForm({ focusButton = false } = {}) {
  const form = document.getElementById('card-link-form')
  form.hidden = true
  const button = document.getElementById('card-link-add')
  button.setAttribute('aria-expanded', 'false')
  if (focusButton) button.focus()
}

document.getElementById('card-link-add').onclick = () => {
  const form = document.getElementById('card-link-form')
  if (!form.hidden) return closeLinkForm()
  form.hidden = false
  document.getElementById('card-link-add').setAttribute('aria-expanded', 'true')
  document.getElementById('card-link-kind').value = linkKind
  const search = document.getElementById('card-link-search')
  search.value = ''
  renderLinkResults()
  search.focus()
}
document.getElementById('card-link-search').oninput = renderLinkResults
document.getElementById('card-link-search').onkeydown = (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    const first = document.querySelector('#card-link-results [data-link-target]')
    if (first) addLink(first.dataset.linkTarget)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    document.querySelector('#card-link-results [data-link-target]')?.focus()
  }
}
document.getElementById('card-link-form').onkeydown = (event) => {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  closeLinkForm({ focusButton: true })
}

document.getElementById('card-template-toggle').onchange = (event) => {
  if (openCardId) {
    send({ type: 'board:card-update', objectId: openCardId, template: event.target.checked })
  }
}

// Comments / Activity tabs in the card details.
function setCardTab(tab) {
  cardTab = tab
  for (const name of ['comments', 'activity']) {
    const selected = name === tab
    const button = document.getElementById(`card-tab-${name}`)
    button.setAttribute('aria-selected', String(selected))
    button.tabIndex = selected ? 0 : -1
    document.getElementById(`card-${name}-panel`).hidden = !selected
  }
  if (tab === 'activity') {
    document.getElementById('card-activity').innerHTML = '<p class="muted hint">Loading…</p>'
    seenActivity.delete(document.getElementById('card-activity'))
    requestCardActivity()
  }
}

function requestCardActivity() {
  if (!openCardId) return
  request('card-activity', { type: 'board:activity', cardId: openCardId, limit: 100 })
}

for (const name of ['comments', 'activity']) {
  const button = document.getElementById(`card-tab-${name}`)
  button.onclick = () => setCardTab(name)
  // Arrow keys move between tabs, as in any tablist.
  button.onkeydown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const next = name === 'comments' ? 'activity' : 'comments'
    setCardTab(next)
    document.getElementById(`card-tab-${next}`).focus()
  }
}

const activityCard = (entry, withCard) =>
  withCard
    ? ` <button type="button" class="link-title inline" data-open-card="${escape(entry.cardId)}" title="${escape(entry.cardTitle)}" dir="auto">${escape(entry.cardTitle.length > 60 ? `${entry.cardTitle.slice(0, 59)}…` : entry.cardTitle)}</button>`
    : ''

// One line per entry: who, what, which card (on the board feed), when.
function activityHtml(entry, withCard, entering = false) {
  const target = activityCard(entry, withCard)
  const self = withCard ? target : ' this card'
  const detail = escape(entry.detail)
  const phrases = {
    created: [`created${self}`, detail],
    moved: [`moved${target} to <strong dir="auto">${detail}</strong>`, ''],
    archived: [`archived${self}`, ''],
    restored: [`restored${self}`, ''],
    commented: [`commented${withCard ? ` on${target}` : ''}`, detail],
    edited: [`edited${self}`, detail],
    checklist: [`updated the checklist${withCard ? ` on${target}` : ''}`, detail],
    linked: [`changed links${withCard ? ` on${target}` : ''}`, detail],
    attached: [`added an attachment${withCard ? ` to${target}` : ''}`, ''],
    estimated: [`voted on the estimate${withCard ? ` of${target}` : ''}`, '']
  }
  const [what, more] = phrases[entry.kind] || [escape(entry.kind), detail]
  const who = escape(entry.authorName || memberName(entry.author))
  return `<div class="activity-entry${entering ? ' enter' : ''}">${avatar(entry.author)}<div class="activity-text"><span><strong dir="auto">${who}</strong> ${what}</span>${more ? `<span class="muted snippet" dir="auto">${more}</span>` : ''}</div><span class="time" title="${escape(new Date(entry.at).toLocaleString())}">${escape(relativeTime(entry.at))}</span></div>`
}

// Entries seen per feed; the first render after opening it plays no entrance.
const seenActivity = new Map()

function renderActivity(container, entries, withCard) {
  const seen = seenActivity.get(container)
  seenActivity.set(container, new Set(entries.map((entry) => entry.id)))
  container.innerHTML = entries.length
    ? entries.map((entry) => activityHtml(entry, withCard, !!seen && !seen.has(entry.id))).join('')
    : '<p class="muted hint">Nothing has happened here yet.</p>'
  for (const button of container.querySelectorAll('[data-open-card]')) {
    button.onclick = () => {
      closeOverlay(activityModal)
      openCard(button.dataset.openCard)
    }
  }
}

const duePopover = document.getElementById('due-popover')

function openDuePopover() {
  const object = cardById(openCardId)
  if (!object) return
  const due = dueInfo(object.dueDate)
  const pad = (n) => String(n).padStart(2, '0')
  const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const dateInput = document.getElementById('card-due-date')
  // A new due date starts on today; the time stays optional.
  dateInput.value = !due ? day(new Date()) : due.dateOnly ? object.dueDate : day(due.deadline)
  document.getElementById('card-due-time').value =
    due && !due.dateOnly ? `${pad(due.deadline.getHours())}:${pad(due.deadline.getMinutes())}` : ''
  document.getElementById('card-due-remove').hidden = !due
  duePopover.hidden = false
  document.getElementById('card-due-button').setAttribute('aria-expanded', 'true')
  dateInput.focus()
}

function closeDuePopover({ focusButton = false } = {}) {
  if (duePopover.hidden) return
  duePopover.hidden = true
  const button = document.getElementById('card-due-button')
  button.setAttribute('aria-expanded', 'false')
  if (focusButton) button.focus()
}

const currentLabelIds = (object) => labelDraft || object?.labelIds || []

function setCardLabels(object, labelIds) {
  labelDraft = labelIds
  send({ type: 'board:card-update', objectId: object.id, labelIds })
  renderCardLabels(object)
}

// Every board label is one chip: filled when it's on the card, outlined when
// not. A click adds or removes it.
function renderCardLabels(object) {
  const box = document.getElementById('card-labels')
  const active = currentLabelIds(object)
  const focused = document.activeElement?.dataset?.labelToggle
  box.innerHTML = labels
    .map((label) => {
      const on = active.includes(label.id)
      return `<button type="button" class="label-toggle${on ? ' on' : ''}" style="--label-color: ${label.color || '#8590a2'}" data-label-toggle="${escape(label.id)}" aria-pressed="${on}" title="${on ? 'Remove' : 'Add'} “${escape(label.name)}”">${on ? '✓ ' : ''}${escape(label.name || 'Unnamed')}</button>`
    })
    .join('')
  for (const chip of box.querySelectorAll('[data-label-toggle]')) {
    chip.onclick = () => {
      const card = cardById(openCardId)
      if (!card) return
      const id = chip.dataset.labelToggle
      const ids = currentLabelIds(card)
      setCardLabels(card, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
    }
    if (chip.dataset.labelToggle === focused) chip.focus()
  }
}

const newLabelId = () =>
  `label:${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('')}`
const nextLabelColor = () =>
  LABEL_COLORS.find((color) => !labels.some((label) => label.color === color)) ||
  LABEL_COLORS[labels.length % LABEL_COLORS.length]
const labelNamed = (name) => labels.find((label) => label.name.toLowerCase() === name.toLowerCase())

// Labels screen: rename, recolor, delete, create. Shared by the whole board.
const labelsModal = document.getElementById('labels-modal')

function renderLabelsManager() {
  const list = document.getElementById('labels-list')
  const focus = document.activeElement?.dataset?.focusKey
  const draftNames = new Map(
    [...list.querySelectorAll('input[data-label-id]')].map((input) => [
      input.dataset.labelId,
      input === document.activeElement ? input.value : null
    ])
  )
  list.innerHTML = ''
  if (!labels.length) {
    list.innerHTML = '<div class="labels-empty">No labels yet. Create the first one below.</div>'
  }
  for (const label of labels) {
    const used = objects.filter((object) => object.labelIds?.includes(label.id)).length
    const row = document.createElement('div')
    row.className = 'label-manage-row'
    row.innerHTML = `<button type="button" class="swatch" style="--label-color: ${label.color || '#8590a2'}" aria-label="Change color of ${escape(label.name)}" aria-expanded="${recoloringLabel === label.id}"></button>
      <input value="${escape(draftNames.get(label.id) ?? label.name)}" maxlength="40" aria-label="Label name" data-label-id="${escape(label.id)}" data-focus-key="label-name:${escape(label.id)}" />
      <span class="muted usage">${used} ${used === 1 ? 'card' : 'cards'}</span>
      <button type="button" class="ghost icon-only" aria-label="Delete label ${escape(label.name)}">${icon('trash')}</button>`
    const [swatch, remove] = row.querySelectorAll('button')
    const input = row.querySelector('input')
    swatch.onclick = () => {
      recoloringLabel = recoloringLabel === label.id ? null : label.id
      renderLabelsManager()
    }
    const rename = () => {
      const name = input.value.trim()
      if (name && name !== label.name) {
        send({ type: 'board:label-upsert', labelId: label.id, name, color: label.color })
      } else input.value = label.name
    }
    input.onblur = rename
    input.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        rename()
        input.blur()
      }
    }
    remove.onclick = () => {
      if (!remove.classList.contains('danger')) {
        remove.className = 'danger'
        withIcon(
          remove,
          'trash',
          used ? `Remove from ${used} ${used === 1 ? 'card' : 'cards'}?` : 'Delete?'
        )
        setTimeout(() => remove.isConnected && renderLabelsManager(), 3000)
        return
      }
      send({ type: 'board:label-delete', labelId: label.id })
    }
    if (recoloringLabel === label.id) {
      const colors = document.createElement('div')
      colors.className = 'swatches'
      colors.innerHTML = swatchButtons(label.color)
      for (const button of colors.querySelectorAll('[data-color]')) {
        button.onclick = () => {
          send({
            type: 'board:label-upsert',
            labelId: label.id,
            name: label.name,
            color: button.dataset.color
          })
          recoloringLabel = null
        }
      }
      row.append(colors)
    }
    list.append(row)
  }
  if (focus) list.querySelector(`[data-focus-key="${focus}"]`)?.focus()
  newLabelColor ??= nextLabelColor()
  document.getElementById('label-create-color').style.setProperty('--label-color', newLabelColor)
  const createColors = document.getElementById('label-create-colors')
  createColors.innerHTML = swatchButtons(newLabelColor)
  for (const button of createColors.querySelectorAll('[data-color]')) {
    button.onclick = () => {
      newLabelColor = button.dataset.color
      createColors.hidden = true
      document.getElementById('label-create-color').setAttribute('aria-expanded', 'false')
      renderLabelsManager()
    }
  }
}

function swatchButtons(selected) {
  return LABEL_COLORS.map(
    (color) =>
      `<button type="button" class="swatch" style="--label-color: ${color}" data-color="${color}" aria-label="Color ${color}" aria-pressed="${color === selected}"></button>`
  ).join('')
}

function openLabelsManager() {
  recoloringLabel = null
  newLabelColor = null
  renderLabelsManager()
  labelsModal.classList.add('open')
  document.getElementById('label-create-name').focus()
}

function closeLabelsManager() {
  labelsModal.classList.remove('open')
}

function setEditingBody(editing) {
  editingBody = editing
  const object = cardById(openCardId)
  cardBody.hidden = !editing
  document.getElementById('card-body-view').hidden = editing
  document.getElementById('card-body-actions').hidden = !editing
  document.getElementById('card-body-edit').hidden = editing
  if (editing) {
    cardBody.value = object?.body || ''
    cardBody.focus()
  }
}

function saveCardBody() {
  const object = cardById(openCardId)
  if (object && cardBody.value !== (object.body || '')) {
    send({
      type: 'board:card-update',
      objectId: object.id,
      body: cardBody.value,
      mentions: findMentions(cardBody.value, profiles)
    })
  }
  setEditingBody(false)
  refreshCard()
}

function saveCardTitle() {
  const object = cardById(openCardId)
  const title = cardTitle.value.trim()
  if (!object) return
  if (title && title !== object.title) {
    send({ type: 'board:card-update', objectId: object.id, title })
  } else cardTitle.value = object.title
}

cardTitle.onkeydown = (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    saveCardTitle()
  }
}
cardTitle.onblur = saveCardTitle
cardBody.onkeydown = (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    saveCardBody()
  }
}
document.getElementById('card-body-save').onclick = saveCardBody
document.getElementById('card-body-cancel').onclick = () => {
  setEditingBody(false)
  refreshCard()
}
document.getElementById('card-body-edit').onclick = () => setEditingBody(true)
document.getElementById('card-labels-manage').onclick = openLabelsManager
document.getElementById('labels-open').onclick = openLabelsManager
document.getElementById('close-labels-modal').onclick = closeLabelsManager
labelsModal.onclick = (event) => {
  if (event.target === labelsModal) closeLabelsManager()
}
// Type a name and press Enter: an existing label with that name is added to
// the card, otherwise a new one is created with the next unused color.
document.getElementById('card-label-new').onkeydown = (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  const input = event.target
  const name = input.value.trim()
  const object = cardById(openCardId)
  if (!name || !object) return
  const existing = labelNamed(name)
  const labelId = existing?.id || newLabelId()
  if (!existing) send({ type: 'board:label-upsert', labelId, name, color: nextLabelColor() })
  const ids = currentLabelIds(object)
  if (!ids.includes(labelId)) setCardLabels(object, [...ids, labelId])
  input.value = ''
}
document.getElementById('label-create-color').onclick = () => {
  const colors = document.getElementById('label-create-colors')
  colors.hidden = !colors.hidden
  document
    .getElementById('label-create-color')
    .setAttribute('aria-expanded', String(!colors.hidden))
}
document.getElementById('label-create').onsubmit = (event) => {
  event.preventDefault()
  const input = document.getElementById('label-create-name')
  const name = input.value.trim()
  if (!name) return input.focus()
  if (labelNamed(name)) {
    input.setCustomValidity('A label with this name already exists')
    input.reportValidity()
    return
  }
  send({ type: 'board:label-upsert', labelId: newLabelId(), name, color: newLabelColor })
  input.value = ''
  newLabelColor = null
}
document.getElementById('label-create-name').oninput = (event) => event.target.setCustomValidity('')

document.getElementById('card-due-button').onclick = () => {
  if (duePopover.hidden) openDuePopover()
  else closeDuePopover()
}
duePopover.onsubmit = (event) => {
  event.preventDefault()
  const object = cardById(openCardId)
  const date = document.getElementById('card-due-date').value
  const time = document.getElementById('card-due-time').value
  if (!object || !date) return
  const dueDate = time ? new Date(`${date}T${time}`).toISOString() : date
  if (dueDate !== object.dueDate) send({ type: 'board:card-update', objectId: object.id, dueDate })
  closeDuePopover({ focusButton: true })
}
document.getElementById('card-due-remove').onclick = () => {
  if (openCardId) send({ type: 'board:card-update', objectId: openCardId, dueDate: null })
  closeDuePopover({ focusButton: true })
}
duePopover.onkeydown = (event) => {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  closeDuePopover({ focusButton: true })
}
document.addEventListener('mousedown', (event) => {
  if (!duePopover.hidden && !event.target.closest('.due-anchor')) closeDuePopover()
})
document.getElementById('card-body-view').onclick = (event) => {
  // Links open in the browser; anywhere else starts editing.
  if (!event.target.closest('a')) setEditingBody(true)
}
cardColumn.onchange = async () => {
  const object = cardById(openCardId)
  if (!object) return
  // A cancelled confirmation puts the select back where the card is.
  if (!(await moveCard(object.id, cardColumn.value, Infinity))) cardColumn.value = object.columnId
}
for (const button of cardModal.querySelectorAll('[data-card-vote]')) {
  // Step by one: with a vote cast, either arrow first clears it.
  button.onclick = () => {
    const object = cardById(openCardId)
    if (!object) return
    const ownVote = object.votes?.[currentIdentity] || 0
    send({
      type: 'board:vote',
      objectId: object.id,
      value: ownVote ? 0 : Number(button.dataset.cardVote)
    })
  }
}
document.getElementById('card-comment-form').onsubmit = (event) => {
  event.preventDefault()
  const input = document.getElementById('card-comment')
  const text = input.value.trim()
  if (text && openCardId) {
    send({
      type: 'board:comment',
      objectId: openCardId,
      text,
      mentions: findMentions(text, profiles)
    })
  }
  input.value = ''
  stopTyping()
}
document.getElementById('card-comment').addEventListener('input', (event) => {
  if (event.target.value.trim()) noteTyping()
  else stopTyping()
})
document.getElementById('card-archive').onclick = () => {
  const object = cardById(openCardId)
  if (!object) return
  send({ type: 'board:card-archive', objectId: object.id, archived: !object.archived })
  if (!object.archived && !showArchived) closeCard()
}
document.getElementById('close-card-modal').onclick = closeCard
cardModal.onclick = (event) => {
  if (event.target === cardModal) closeCard()
}
document.getElementById('archived-toggle').onclick = () => {
  showArchived = !showArchived
  renderBoard()
}

// A joiner whose board has never synced only gets data once another member is
// online; after a short wait, say so instead of showing placeholders forever.
const WAIT_FOR_MEMBERS_MS = 6000
let waitingTimer = null
let waitedForMembers = false

function updateWaiting() {
  // Not the peer count: other joiners connect too but hold no board data.
  document.getElementById('board-waiting').hidden = !(
    waitedForMembers && boardLoading.classList.contains('visible')
  )
}

function setBoardLoading(loading) {
  clearTimeout(waitingTimer)
  waitedForMembers = false
  if (loading) {
    waitingTimer = setTimeout(() => {
      waitedForMembers = true
      updateWaiting()
    }, WAIT_FOR_MEMBERS_MS)
  }
  updateWaiting()
  boardLoading.classList.toggle('visible', loading)
  document.querySelector('.new-object-bar').style.display = loading ? 'none' : 'flex'
  applyView()
  if (loading) closeNewObject()
  updateStatusChip()
}

function openNewObject() {
  newObjectForm.classList.add('open')
  newObjectToggle.setAttribute('aria-expanded', 'true')
  document.getElementById('object-title').focus()
}

function closeNewObject() {
  newObjectForm.classList.remove('open')
  newObjectToggle.setAttribute('aria-expanded', 'false')
}

function logout() {
  if (connectionModal.classList.contains('open')) connectionModal.classList.remove('open')
  send({ type: 'boards:watch', boards: [] })
  alertBoards = []
  notifiedAlerts.clear()
  primedBoards.clear()
  updateNotifications()
  const wasInRoom = roomEntered
  identityUnlocked = false
  roomEntered = false
  boardSynced = false
  currentIdentity = ''
  currentDisplayName = ''
  currentInvite = ''
  resetBoardUi()
  recentBoards.innerHTML = ''
  identityError.innerText = ''
  roomGate.style.display = 'none'
  profileGate.style.display = 'none'
  showBoard(false)
  identityGate.style.display = 'block'
  if (wasInRoom) send({ type: 'room:leave' })
}

// OTA updates: the worker sends the plain strings 'updating' and 'updated'
// (pear-runtime updater events); applying swaps in the new build and relaunches.
function onUpdaterEvent(name) {
  const banner = document.getElementById('update-banner')
  const text = banner.querySelector('span')
  const button = document.getElementById('update-apply')
  banner.classList.add('visible')
  if (name === 'updating') {
    text.innerText = 'Downloading an update…'
    button.hidden = true
    return
  }
  text.innerText = 'A new version is ready.'
  button.hidden = false
  button.disabled = false
  button.onclick = async () => {
    button.disabled = true
    text.innerText = 'Updating…'
    try {
      await bridge.applyUpdate()
      await bridge.appAfterUpdate()
    } catch (err) {
      text.innerText = `Update failed: ${err.message}`
    }
  }
}

bridge.onWorkerIPC(workers.main, (data) => {
  const text = decoder.decode(data)
  if (text === 'updating' || text === 'updated') {
    onUpdaterEvent(text)
    return
  }
  let message
  try {
    message = JSON.parse(text)
  } catch {
    return
  }
  if (message.type === 'identity-status') {
    identityError.innerText = message.error || ''
    if (message.status === 'unlocked') {
      identityUnlocked = true
      identityGate.style.display = 'none'
      currentIdentity = message.publicKey
      showBoardManagement()
    } else {
      identityUnlocked = false
      roomEntered = false
      identityGate.style.display = 'block'
      roomGate.style.display = 'none'
      showBoard(false)
    }
  }
  if (message.type === 'room-status') {
    roomError.innerText = message.error || ''
    if (message.status === 'none') {
      showBoardManagement()
      return
    }
    if (message.status === 'ready') {
      roomEntered = true
      // Writers already hold the board; a joiner waits for its first sync.
      boardSynced = !!message.writable
      roomGate.style.display = 'none'
      const hasDisplayName = Boolean(message.displayName)
      profileGate.style.display = hasDisplayName ? 'none' : 'block'
      showBoard(hasDisplayName)
      setBoardLoading(!boardSynced)
      if (hasDisplayName) {
        document.getElementById('display-name').value = message.displayName
        currentDisplayName = message.displayName
      }
      updateIdentityMenu()
      currentInvite = message.invite || ''
      currentBoardKey = message.boardKey || ''
      // The worker sends the board's cards just before "ready".
      openPendingCard()
      if (message.boardName) {
        setBoardName(message.boardName)
        rememberBoard({ invite: message.invite, name: message.boardName })
      }
    }
  }
  if (message.type === 'room-debug') {
    networkStatus = message.status
    if (connectionModal.classList.contains('open')) {
      document.getElementById('modal-network').innerText = networkStatus
    }
  }
  if (message.type === 'peer-count') {
    peerCount = message.count || 0
    updateStatusChip()
    updateWaiting()
    if (connectionModal.classList.contains('open')) {
      document.getElementById('modal-peers').innerText = peerCount
    }
  }
  if (message.type === 'board-image') {
    imageRequests.delete(message.key)
    imageCache.set(
      message.key,
      message.data
        ? { url: `data:${message.mime};base64,${message.data}` }
        : { error: message.error || 'unavailable' }
    )
    const object = objects.find((entry) =>
      (entry.images || []).some((ref) => imageKey(ref) === message.key)
    )
    const ref = object?.images.find((entry) => imageKey(entry) === message.key)
    for (const slot of document.querySelectorAll(`[data-image-key="${message.key}"]`)) {
      if (ref) fillImageSlot(slot, ref)
    }
    for (const slot of document.querySelectorAll('[data-cover-key], [data-md-image-key]')) {
      if ((slot.dataset.coverKey || slot.dataset.mdImageKey) === message.key) fillInlineImage(slot)
    }
    if (boardInfo.icon && imageKey(boardInfo.icon) === message.key) renderBoardIcon()
    if (members.some((member) => member.avatar && imageKey(member.avatar) === message.key)) {
      refreshAvatars()
    }
    if (theme.backgroundImage && imageKey(theme.backgroundImage) === message.key) applyTheme()
    if (!document.getElementById('theme-panel').hidden) renderThemePanel()
  }
  if (message.type === 'board-media') onBoardMedia(message)
  if (message.type === 'card-media-progress') onMediaProgress(message)
  if (message.type === 'card-media-added') onMediaAdded(message)
  if (message.type === 'board-export') onBoardExport(message)
  if (message.type === 'board-action-error') onActionError(message)
  if (message.type === 'board-alerts') onBoardAlerts(message)
  if (message.type === 'board-presence') onPresence(message)
  if (message.type === 'board-activity') onBoardActivity(message)
  if (message.type === 'board-stats') onBoardStats(message)
  if (message.type === 'card-created') onCardCreated(message)
  if (message.type === 'card-images-added') {
    finishUpload(message)
  }
  if (message.type === 'board-state') {
    profiles = message.profiles || {}
    objects = message.objects || []
    columns = message.columns || []
    labels = message.labels || []
    labelDraft = null
    assigneeDraft = null
    rules = message.rules || []
    theme = {
      template: null,
      backgroundImage: null,
      ...(message.theme || { background: null, accent: null })
    }
    boardInfo = { icon: null, ...(message.info || { description: '' }) }
    boardOwner = message.owner || null
    members = message.members || []
    boardKindId = boardKind(boardInfo.kind).id
    applyKind()
    renderDescription()
    renderBoardIcon()
    updateIdentityMenu()
    if (profileModal.classList.contains('open')) renderProfileAvatar()
    document.getElementById('banned-banner').hidden = !memberById(currentIdentity)?.banned
    if (membersModal.classList.contains('open')) renderMembers()
    // A board loading or syncing in bulk isn't cards arriving: no entry motion.
    const arrived = objects.filter((object) => !seenObjects.has(object.id))
    if (arrived.length > 3) for (const object of arrived) seenObjects.add(object.id)
    applyTheme()
    renderBoard({ animate: true })
    openPendingCard()
  }
  if (message.type === 'board-name') {
    setBoardName(message.name)
    if (currentInvite) rememberBoard({ invite: currentInvite, name: message.name })
  }
  if (message.type === 'profile-status') {
    if (message.identity && message.identity !== currentIdentity) return
    currentDisplayName = message.displayName
    updateIdentityMenu()
    profileError.innerText = ''
    if (!roomEntered) return
    profileGate.style.display = 'none'
    showBoard(true)
    setBoardLoading(!boardSynced)
    openPendingCard()
  }
  if (message.type === 'board-synced') {
    boardSynced = true
    if (boardView.style.display === 'block') setBoardLoading(false)
    updateStatusChip()
  }
})
document.getElementById('app-version').innerText = `v${bridge.pkg().version}`
bridge.startWorker(workers.main)

for (const button of document.querySelectorAll('[data-icon]')) {
  withIcon(button, button.dataset.icon, button.innerText.trim())
}

identityMenu.onclick = openConnectionModal
document.getElementById('close-connection-modal').onclick = closeConnectionModal
document.getElementById('switch-board').onclick = () => {
  closeConnectionModal()
  showBoardManagement()
  send({ type: 'room:leave' })
}
document.getElementById('modal-logout').onclick = logout
document.getElementById('gate-logout').onclick = logout
connectionModal.onclick = (event) => {
  if (event.target === connectionModal) closeConnectionModal()
}

async function copyInvite() {
  const button = document.getElementById('copy-invite')
  await navigator.clipboard.writeText(inviteLink(currentInvite))
  withIcon(button, 'copy', 'Copied')
  setTimeout(() => withIcon(button, 'copy', 'Copy invite'), 1200)
}
document.getElementById('copy-invite').onclick = () => {
  if (currentInvite) copyInvite()
}
document.getElementById('share-invite').onclick = async () => {
  if (!currentInvite) return
  if (!navigator.share) {
    await copyInvite()
    return
  }
  try {
    await navigator.share({ title: 'OpenCollab board', url: inviteLink(currentInvite) })
  } catch (error) {
    if (error.name !== 'AbortError') await copyInvite()
  }
}

// The invite as a QR code, for a phone to scan from this screen. Drawn as SVG,
// dark on white whatever the theme, since scanners expect that.
function inviteQrSvg(text, moduleSize = 8) {
  const { data } = encode(text, { ecc: 'M', border: 2 })
  const size = data.length * moduleSize
  let path = ''
  const m = moduleSize
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x * m} ${y * m}h${m}v${m}h-${m}z`
    })
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}

document.getElementById('show-invite-qr').onclick = () => {
  if (!currentInvite) return
  const panel = document.getElementById('invite-qr')
  panel.hidden = !panel.hidden
  if (!panel.hidden) {
    document.getElementById('invite-qr-image').innerHTML = inviteQrSvg(inviteLink(currentInvite))
  }
}

document.getElementById('save-invite-qr').onclick = () => {
  if (!currentInvite) return
  const image = new window.Image()
  image.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    canvas.getContext('2d').drawImage(image, 0, 0)
    canvas.toBlob((blob) => {
      const name = (document.getElementById('board-name').innerText || 'board')
        .replace(/[^\w-]+/g, '-')
        .slice(0, 40)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${name || 'board'}-invite-qr.png`
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 10000)
    }, 'image/png')
  }
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(inviteQrSvg(inviteLink(currentInvite), 16))}`
}

// Board settings: the gear next to the bell holds what edits the board itself.
const settingsMenu = document.getElementById('board-settings-menu')
const settingsButton = document.getElementById('board-settings-button')

function closeSettingsMenu({ focusButton = false } = {}) {
  if (settingsMenu.hidden) return
  settingsMenu.hidden = true
  settingsButton.setAttribute('aria-expanded', 'false')
  if (focusButton) settingsButton.focus()
}

settingsButton.innerHTML = icon('settings')
settingsButton.onclick = () => {
  if (!settingsMenu.hidden) return closeSettingsMenu()
  settingsMenu.hidden = false
  settingsButton.setAttribute('aria-expanded', 'true')
  settingsMenu.querySelector('button').focus()
}
// Each entry keeps its own handler (Labels, Customize); picking one closes the menu.
settingsMenu.addEventListener('click', (event) => {
  if (event.target.closest('button')) closeSettingsMenu()
})
document.getElementById('board-edit').onclick = editDescription

// Board types: body classes hide every [data-feature] the type doesn't use
// (CSS in index.html); the card, column and menu code asks can() directly.
function applyKind() {
  for (const feature of BOARD_FEATURES) {
    document.body.classList.toggle(`without-${feature}`, !can(feature))
  }
  document.getElementById('board-kind-open').hidden = !boardOwner || boardOwner !== currentIdentity
  if (!can('due') && boardViewMode === 'calendar') setView('board')
}

const KIND_ICONS = { kanban: 'board', todo: 'checklist', feed: 'rss', recipes: 'book' }

// A radio list of board types; `onPick` gets the id.
function renderKindOptions(container, selected, onPick) {
  container.replaceChildren(
    ...BOARD_KIND_IDS.map((id) => {
      const kind = boardKind(id)
      const option = document.createElement('button')
      option.type = 'button'
      option.className = 'kind-option'
      option.setAttribute('role', 'radio')
      option.setAttribute('aria-checked', String(id === selected))
      option.innerHTML = `${icon(KIND_ICONS[id])}<div><strong>${escape(kind.name)}</strong><span>${escape(kind.description)}</span></div>`
      option.onclick = () => onPick(id)
      return option
    })
  )
}

const kindModal = document.getElementById('kind-modal')
let kindChoice = 'kanban'

function renderKindModal() {
  renderKindOptions(document.getElementById('kind-options'), kindChoice, (id) => {
    kindChoice = id
    renderKindModal()
  })
  // A type with its own sections can also rename the columns to them.
  const sections = kindChoice !== boardKindId ? boardKind(kindChoice).sections : null
  document.getElementById('kind-sections-field').hidden = !sections
  document.getElementById('kind-sections-label').textContent = sections
    ? `Rename the columns to ${sections.join(', ')} (columns holding cards are kept)`
    : ''
  document.getElementById('kind-save').disabled = kindChoice === boardKindId
}

document.getElementById('board-kind-open').onclick = () => {
  kindChoice = boardKindId
  document.getElementById('kind-sections').checked = true
  renderKindModal()
  openOverlay(kindModal)
}
document.getElementById('kind-save').onclick = () => {
  send({
    type: 'board:kind-set',
    kind: kindChoice,
    sections: !!boardKind(kindChoice).sections && document.getElementById('kind-sections').checked
  })
  closeOverlay(kindModal)
}
document.addEventListener('mousedown', (event) => {
  if (!settingsMenu.hidden && !event.target.closest('.settings-anchor')) closeSettingsMenu()
})

// Name and avatar, per board. The avatar applies as soon as it is picked; the
// name waits for Save.
const profileModal = document.getElementById('profile-modal')
const profileName = document.getElementById('profile-name')

function renderProfileAvatar() {
  document.getElementById('profile-avatar-image').innerHTML = avatar(currentIdentity)
  document.getElementById('profile-avatar-remove').hidden = !members.find(
    (member) => member.identity === currentIdentity
  )?.avatar
}

function openProfileEditor() {
  closeConnectionModal()
  profileName.value = currentDisplayName
  document.getElementById('profile-modal-error').hidden = true
  renderProfileAvatar()
  profileModal.classList.add('open')
  profileName.focus()
}

function closeProfileEditor() {
  profileModal.classList.remove('open')
}

// An avatar image arrived: redraw everywhere a member is shown.
function refreshAvatars() {
  updateIdentityMenu()
  refreshCard()
  if (membersModal.classList.contains('open')) renderMembers()
  if (profileModal.classList.contains('open')) renderProfileAvatar()
  if (connectionModal.classList.contains('open')) {
    document.getElementById('modal-identity').innerHTML = identityHtml(currentIdentity)
  }
}

document.getElementById('edit-profile').onclick = openProfileEditor
document.getElementById('profile-avatar-badge').innerHTML = icon('camera', 'icon')
const avatarInput = document.getElementById('profile-avatar-input')
document.getElementById('profile-avatar').onclick = () => avatarInput.click()
avatarInput.onchange = () => {
  const [file] = avatarInput.files
  avatarInput.value = ''
  // Avatars show small, so they don't need the full size.
  uploadBoardImage(file, 'profile:avatar-set', 'profile-modal-error', 256)
}
document.getElementById('profile-avatar-remove').onclick = () =>
  send({ type: 'profile:avatar-set', image: null })
document.getElementById('profile-form').onsubmit = (event) => {
  event.preventDefault()
  const displayName = profileName.value.trim()
  if (displayName && displayName !== currentDisplayName) send({ type: 'profile:set', displayName })
  closeProfileEditor()
}
document.getElementById('profile-cancel').onclick = closeProfileEditor
profileModal.onclick = (event) => {
  if (event.target === profileModal) closeProfileEditor()
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (confirmFinish) confirmFinish(false)
  else if (document.getElementById('image-viewer').classList.contains('open')) closeImageViewer()
  else if (labelsModal.classList.contains('open')) closeLabelsManager()
  else if (membersModal.classList.contains('open')) closeMembers()
  else if (profileModal.classList.contains('open')) closeProfileEditor()
  else if (topOverlay()) closeOverlay(topOverlay())
  else if (cardModal.classList.contains('open')) closeCard()
  else if (notificationsModal.classList.contains('open')) closeNotifications()
  else if (connectionModal.classList.contains('open')) closeConnectionModal()
  else if (!settingsMenu.hidden) closeSettingsMenu({ focusButton: true })
  else if (newObjectForm.classList.contains('open')) {
    closeNewObject()
    newObjectToggle.focus()
  }
})

function showRoomChoice() {
  document.getElementById('room-choice').style.display = 'flex'
  document.getElementById('room-sample-row').hidden = false
  document.getElementById('room-create-form').style.display = 'none'
  document.getElementById('room-join-form').style.display = 'none'
  recentBoards.style.display = ''
  roomError.innerText = ''
}
function showRoomForm(id) {
  document.getElementById('room-choice').style.display = 'none'
  document.getElementById('room-sample-row').hidden = true
  recentBoards.style.display = 'none'
  document.getElementById(id).style.display = 'grid'
  document.querySelector(`#${id} input`).focus()
}
document.getElementById('room-create-choice').onclick = () => showRoomForm('room-create-form')
document.getElementById('room-join-choice').onclick = () => showRoomForm('room-join-form')
document.getElementById('room-invite-paste').onclick = async () => {
  try {
    const value = await navigator.clipboard.readText()
    if (!value.trim()) {
      roomError.innerText = 'Clipboard is empty'
      return
    }
    document.getElementById('room-invite').value = value.trim()
    roomError.innerText = ''
  } catch (error) {
    roomError.innerText = 'Unable to read the clipboard. Paste the invitation manually.'
    console.error('Unable to read invitation from clipboard', error)
  }
}
document.getElementById('room-create-back').onclick = showRoomChoice
document.getElementById('room-join-back').onclick = showRoomChoice
let newBoardKind = 'kanban'
function renderNewBoardKind() {
  renderKindOptions(document.getElementById('room-kind'), newBoardKind, (id) => {
    newBoardKind = id
    renderNewBoardKind()
  })
}
renderNewBoardKind()
document.getElementById('room-create').onclick = () => {
  const name = document.getElementById('room-name').value.trim()
  if (!name) {
    roomError.innerText = 'Give your board a name.'
    return
  }
  roomError.innerText = ''
  send({ type: 'room:start', invite: null, name, kind: newBoardKind })
}
// A private board pre-filled by the worker with cards that show the features.
document.getElementById('room-sample').onclick = () => {
  roomError.innerText = ''
  send({ type: 'room:start', invite: null, sample: true })
}
document.getElementById('room-join').onclick = () => {
  const invite = normalizeInvite(document.getElementById('room-invite').value)
  if (!invite) {
    roomError.innerText = 'Paste an invitation first.'
    return
  }
  roomError.innerText = ''
  send({ type: 'room:start', invite })
}
document.getElementById('display-name-save').onclick = () => {
  const displayName = document.getElementById('display-name').value.trim()
  if (!displayName) {
    profileError.innerText = 'Enter a display name to continue.'
    return
  }
  profileError.innerText = ''
  send({ type: 'profile:set', displayName })
}
document.getElementById('display-name').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.getElementById('display-name-save').click()
})
newObjectToggle.onclick = () => {
  if (newObjectForm.classList.contains('open')) closeNewObject()
  else openNewObject()
}
document.getElementById('object-cancel').onclick = () => {
  closeNewObject()
  newObjectToggle.focus()
}
newObjectForm.onsubmit = (event) => {
  event.preventDefault()
  const title = document.getElementById('object-title')
  if (!title.value.trim()) {
    title.focus()
    return
  }
  send({
    type: 'board:create',
    title: title.value,
    body: document.getElementById('object-body').value,
    columnId: document.getElementById('object-column').value,
    mentions: findMentions(document.getElementById('object-body').value, profiles),
    images: pendingImages.map(({ url, type, width, height }) => ({
      data: url.slice(url.indexOf(',') + 1),
      type,
      width,
      height
    }))
  })
  title.value = ''
  document.getElementById('object-body').value = ''
  pendingImages = []
  renderPendingImages()
  closeNewObject()
}
document.getElementById('object-attach').onclick = () =>
  document.getElementById('object-images').click()
document.getElementById('object-images').onchange = async (event) => {
  const imageError = document.getElementById('image-error')
  imageError.innerText = ''
  const files = [...event.target.files]
  event.target.value = ''
  for (const file of files) {
    if (pendingImages.length >= MAX_IMAGES) {
      imageError.innerText = `Up to ${MAX_IMAGES} images per post.`
      break
    }
    try {
      const image = await prepareImage(file)
      // The worker rejects anything over 5 MB; base64 is ~4/3 of the bytes.
      if (image.url.length * 0.75 > 5 * 1024 * 1024) {
        imageError.innerText = `${file.name} is too large (max 5 MB).`
        continue
      }
      pendingImages.push(image)
    } catch {
      imageError.innerText = `${file.name} could not be read as an image.`
    }
  }
  renderPendingImages()
}
document.getElementById('image-viewer').onclick = closeImageViewer

document.getElementById('identity-use-saved').onclick = () =>
  bridge.identityKeychainLoad().catch((error) => {
    identityError.innerText = error.message
  })
document.getElementById('identity-create-new').onclick = () =>
  bridge.identityKeychainCreate().catch((error) => {
    identityError.innerText = error.message
  })
bridge.identityKeychainStatus().then(({ available }) => {
  if (!available) document.getElementById('identity-use-saved').disabled = true
})

// @mentions: typing `@` in a description or comment suggests board members.
function attachMentionPicker(field) {
  const menu = document.createElement('div')
  menu.className = 'mention-menu'
  menu.setAttribute('role', 'listbox')
  menu.hidden = true
  ;(field.closest('.comment-form') || field).insertAdjacentElement('afterend', menu)
  let matches = []
  let active = 0
  let start = -1
  const close = () => {
    menu.hidden = true
    matches = []
  }
  const render = () => {
    menu.innerHTML = matches
      .map(
        ([identity, name], index) =>
          `<div role="option" class="mention-option${index === active ? ' active' : ''}" data-index="${index}" aria-selected="${index === active}">${avatar(identity)}<span>${escape(name)}</span></div>`
      )
      .join('')
    menu.hidden = false
  }
  const update = () => {
    const caret = field.selectionStart
    const match = field.value.slice(0, caret).match(/(^|\s)@([^\s@]{0,32})$/)
    if (!match) return close()
    start = caret - match[2].length - 1
    const query = match[2].toLowerCase()
    matches = Object.entries(profiles)
      .filter(
        ([identity, name]) => identity !== currentIdentity && name.toLowerCase().startsWith(query)
      )
      .slice(0, 6)
    if (!matches.length) return close()
    active = Math.min(active, matches.length - 1)
    render()
  }
  const pick = (index) => {
    const name = matches[index][1]
    const caret = field.selectionStart
    field.value = `${field.value.slice(0, start)}@${name} ${field.value.slice(caret)}`
    const position = start + name.length + 2
    field.setSelectionRange(position, position)
    close()
    field.focus()
  }
  field.addEventListener('input', update)
  field.addEventListener('keydown', (event) => {
    if (menu.hidden) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length
      render()
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      event.stopImmediatePropagation()
      pick(active)
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  })
  menu.addEventListener('mousedown', (event) => {
    const option = event.target.closest('[data-index]')
    if (!option) return
    event.preventDefault()
    pick(Number(option.dataset.index))
  })
  field.addEventListener('blur', () => setTimeout(close, 100))
}
// The picker must see Enter before the field's own handlers (save, submit).
for (const id of ['card-body', 'card-comment', 'object-body']) {
  attachMentionPicker(document.getElementById(id))
}

const notificationsModal = document.getElementById('notifications-modal')
const NOTIFY_KINDS = ['mention', 'assigned', 'comment', 'due-soon', 'overdue']

const readAlertsKey = () => `opencollab.alerts-read.${currentIdentity}`
const alertKey = (alert) => `${alert.boardKey}:${alert.id}`

function readAlerts() {
  try {
    return new Set(JSON.parse(localStorage.getItem(readAlertsKey()) || '[]'))
  } catch {
    return new Set()
  }
}

function allAlerts() {
  return alertBoards
    .flatMap((board) =>
      board.alerts.map((alert) => ({
        ...alert,
        boardKey: board.key,
        boardName: board.name,
        invite: board.invite
      }))
    )
    .sort((a, b) => b.at - a.at)
}

function unreadAlerts() {
  const read = readAlerts()
  return allAlerts().filter((alert) => !read.has(alertKey(alert)))
}

function markAlertsRead(predicate) {
  const read = readAlerts()
  const before = read.size
  for (const alert of allAlerts().filter(predicate)) read.add(alertKey(alert))
  if (read.size === before) return
  try {
    // Alerts age out after two weeks; the newest keys are enough to remember.
    localStorage.setItem(readAlertsKey(), JSON.stringify([...read].slice(-2000)))
  } catch {}
  updateNotifications()
  const unread = unreadAlerts()
  for (const card of document.querySelectorAll('.kanban-card')) {
    if (!unread.some((alert) => alert.cardId === card.dataset.cardId)) {
      card.querySelector('.kanban-card-meta .mention-me')?.remove()
    }
  }
}

function alertText(alert) {
  const who = escape(alert.authorName || shortKey(alert.author || ''))
  const card = `<strong>${escape(alert.cardTitle)}</strong>`
  const due = alert.due ? escape(dueInfo(alert.due)?.text || alert.due) : ''
  return (
    {
      mention: `${who} mentioned you ${alert.where === 'comment' ? 'in a comment on' : 'on'} ${card}`,
      assigned: `${who} assigned you to ${card}`,
      comment: `${who} commented on ${card}`,
      moved: `${who} moved ${card}${alert.column ? ` to ${escape(alert.column)}` : ''}`,
      edited: `${who} edited ${card}`,
      'new-card': `${who} added ${card}`,
      'due-soon': `${card} is due ${due}`,
      overdue: `${card} is overdue (${due})`
    }[alert.kind] || card
  )
}

const KIND_LABELS = {
  mention: 'Mention',
  assigned: 'Assigned',
  comment: 'Comment',
  moved: 'Moved',
  edited: 'Edited',
  'new-card': 'New card',
  'due-soon': 'Due soon',
  overdue: 'Overdue'
}

function updateNotifications() {
  const unread = unreadAlerts()
  const button = document.getElementById('notifications-button')
  button.classList.toggle('unread', unread.length > 0)
  document.getElementById('notifications-count').textContent = unread.length
    ? unread.length > 99
      ? '99+'
      : unread.length
    : ''
  button.setAttribute('aria-label', `Notifications, ${unread.length} unread`)
  // A new unread alert gives the button one small pop; reading them doesn't.
  if (unread.length > lastUnreadAlerts && primedBoards.size && !reducedMotion.matches) {
    button.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 240, easing: cssToken('--ease-out') }
    )
  }
  lastUnreadAlerts = unread.length
  if (notificationsModal.classList.contains('open')) renderNotifications()
  updateMyWorkCount()

  // A board's first check only fills the list; desktop notifications are for
  // what arrives after that, while the window is in the background.
  let fresh = false
  for (const alert of unread) {
    const key = alertKey(alert)
    if (notifiedAlerts.has(key)) continue
    notifiedAlerts.add(key)
    if (!primedBoards.has(alert.boardKey)) continue
    fresh = true
    if (!NOTIFY_KINDS.includes(alert.kind) || document.hasFocus()) continue
    const text = document.createElement('div')
    text.innerHTML = alertText(alert)
    const notification = new window.Notification(alert.boardName || 'OpenCollab', {
      body: `${text.textContent}${alert.text ? `: ${alert.text.slice(0, 100)}` : ''}`
    })
    notification.onclick = () => {
      window.focus()
      openAlert(alert)
    }
  }
  if (fresh) playSound()
}

function renderNotifications() {
  const read = readAlerts()
  const list = document.getElementById('notifications-list')
  list.innerHTML = ''
  const alerts = allAlerts()
  if (!alerts.length) {
    const checking = alertBoards.some((board) => !board.checkedAt)
    list.innerHTML = `<div class="notifications-empty">${checking ? 'Checking your boards…' : 'You’re all caught up.'}</div>`
    return
  }
  for (const board of alertBoards) {
    const items = alerts.filter((alert) => alert.boardKey === board.key)
    if (!items.length) continue
    const head = document.createElement('div')
    head.className = 'notifications-board'
    head.innerHTML = `<span class="board-label"><strong dir="auto">${escape(board.name || 'Board')}</strong>${board.key === currentBoardKey ? '<span class="open-tag">&nbsp;· open</span>' : ''}</span><span class="time">${board.checkedAt ? `checked ${escape(relativeTime(board.checkedAt))}` : 'checking…'}</span>`
    list.append(head)
    for (const alert of items) {
      const entry = document.createElement('button')
      entry.className = `mention-item${read.has(alertKey(alert)) ? '' : ' unread'}`
      entry.innerHTML = `<div class="comment-meta"><span class="alert-kind ${alert.kind}">${KIND_LABELS[alert.kind]}</span><span class="time">${escape(relativeTime(alert.at))}</span></div>
        <span class="what" dir="auto">${alertText(alert)}</span>${alert.text ? `<span class="snippet" dir="auto">${escape(alert.text)}</span>` : ''}`
      entry.onclick = () => {
        closeNotifications()
        openAlert(alert)
      }
      list.append(entry)
    }
  }
}

// Opens the alert's card, switching boards first when it's on another one.
function openAlert(alert) {
  markAlertsRead((entry) => alertKey(entry) === alertKey(alert))
  openBoardCard({ key: alert.boardKey, invite: alert.invite, name: alert.boardName }, alert.cardId)
}

function openBoardCard(board, cardId) {
  if (board.key === currentBoardKey && roomEntered) {
    openCard(cardId)
    return
  }
  pendingOpenCard = { boardKey: board.key, cardId }
  closeCard()
  send({ type: 'room:start', invite: board.invite, name: board.name })
}

// A notification from another board asked for this card once that board shows.
function openPendingCard() {
  if (!pendingOpenCard || pendingOpenCard.boardKey !== currentBoardKey) return
  if (boardView.style.display !== 'block' || !cardById(pendingOpenCard.cardId)) return
  const { cardId } = pendingOpenCard
  pendingOpenCard = null
  openCard(cardId)
}

function onBoardAlerts(message) {
  alertBoards = message.boards || []
  for (const board of alertBoards) {
    if (board.checkedAt && !primedBoards.has(board.key)) {
      for (const alert of board.alerts) notifiedAlerts.add(`${board.key}:${alert.id}`)
      primedBoards.add(board.key)
    }
  }
  updateNotifications()
}

function closeNotifications() {
  notificationsModal.classList.remove('open')
}

document.getElementById('notifications-icon').innerHTML = icon('bell')
document.getElementById('notifications-button').onclick = () => {
  renderNotifications()
  notificationsModal.classList.add('open')
  document.getElementById('close-notifications-modal').focus()
}
document.getElementById('close-notifications-modal').onclick = closeNotifications
document.getElementById('notifications-read').onclick = () => markAlertsRead(() => true)
notificationsModal.onclick = (event) => {
  if (event.target === notificationsModal) closeNotifications()
}

// Board description: shared, Markdown, two lines with "More" on the board.
function renderDescription() {
  const view = document.getElementById('board-description-view')
  const text = document.getElementById('board-description')
  const form = document.getElementById('board-description-form')
  const add = document.getElementById('board-description-add')
  const more = document.getElementById('board-description-more')
  form.hidden = !editingDescription
  if (editingDescription) {
    view.hidden = true
    add.hidden = true
    return
  }
  const description = boardInfo.description || ''
  view.hidden = !description
  add.hidden = !!description || !roomEntered
  text.innerHTML = ''
  if (!description) return
  text.append(markdownFor(description, []))
  view.classList.toggle('clamped', !descriptionExpanded)
  // Only offer "More" when two lines actually cut something off.
  more.hidden = !descriptionExpanded && text.scrollHeight <= text.clientHeight + 1
  more.textContent = descriptionExpanded ? 'Less' : 'More'
}

function editDescription() {
  editingDescription = true
  renderDescription()
  const input = document.getElementById('board-description-input')
  input.value = boardInfo.description || ''
  input.focus()
}

function finishDescription(save) {
  const input = document.getElementById('board-description-input')
  if (save && input.value.trim() !== (boardInfo.description || '')) {
    send({ type: 'board:describe', description: input.value })
  }
  editingDescription = false
  renderDescription()
}

document.getElementById('board-description-add').onclick = editDescription
document.getElementById('board-description').onclick = (event) => {
  if (!event.target.closest('a')) editDescription()
}
document.getElementById('board-description-more').onclick = () => {
  descriptionExpanded = !descriptionExpanded
  renderDescription()
}
document.getElementById('board-description-form').onsubmit = (event) => {
  event.preventDefault()
  finishDescription(true)
}
document.getElementById('board-description-cancel').onclick = () => finishDescription(false)
document.getElementById('board-description-input').onkeydown = (event) => {
  if (event.key === 'Escape') {
    event.stopPropagation()
    finishDescription(false)
  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    finishDescription(true)
  }
}

// Images in a card description: upload, paste or drop. The worker stores them
// in this member's encrypted blob core; the reply's keys go into the Markdown.
async function uploadCardImages(files) {
  const error = document.getElementById('card-image-error')
  error.hidden = true
  const object = cardById(openCardId)
  const images = []
  const names = []
  for (const file of files
    .filter((entry) => entry.type.startsWith('image/'))
    .slice(0, MAX_IMAGES)) {
    try {
      const image = await prepareImage(file)
      // The worker rejects anything over 5 MB; base64 is ~4/3 of the bytes.
      if (image.url.length * 0.75 > 5 * 1024 * 1024) {
        error.textContent = `${file.name} is too large (max 5 MB).`
        error.hidden = false
        continue
      }
      images.push({
        data: image.url.slice(image.url.indexOf(',') + 1),
        type: image.type,
        width: image.width,
        height: image.height
      })
      names.push((file.name || 'image').replace(/\.[^.]+$/, '').replace(/[[\]]/g, ''))
    } catch {
      error.textContent = `${file.name} could not be read as an image.`
      error.hidden = false
    }
  }
  if (!object || !images.length) return
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  pendingUploads.set(requestId, { cardId: object.id, names })
  const button = document.getElementById('card-body-image')
  button.disabled = true
  withIcon(button, 'image', 'Uploading…')
  send({ type: 'board:card-images-add', objectId: object.id, requestId, images })
}

function finishUpload(message) {
  const upload = pendingUploads.get(message.requestId)
  if (!upload) return
  pendingUploads.delete(message.requestId)
  const button = document.getElementById('card-body-image')
  button.disabled = pendingUploads.size > 0
  if (!pendingUploads.size) withIcon(button, 'image', 'Add image')
  if (!message.keys?.length) {
    const error = document.getElementById('card-image-error')
    error.textContent = message.error || 'The image could not be added.'
    error.hidden = false
    return
  }
  const markdown = message.keys
    .map((key, index) => `![${upload.names[index] || 'image'}](image:${key})`)
    .join('\n')
  if (editingBody && openCardId === upload.cardId) {
    // Insert where the cursor is, on its own lines.
    const at = cardBody.selectionEnd
    const before = cardBody.value.slice(0, at)
    const gap = before && !before.endsWith('\n') ? '\n' : ''
    cardBody.setRangeText(`${gap}${markdown}\n`, at, at, 'end')
    cardBody.focus()
  } else {
    const object = cardById(upload.cardId)
    if (!object) return
    const body = object.body ? `${object.body}\n\n${markdown}` : markdown
    send({ type: 'board:card-update', objectId: object.id, body })
  }
}

document.getElementById('card-body-image').onclick = () =>
  document.getElementById('card-body-image-input').click()
document.getElementById('card-body-image-input').onchange = (event) => {
  const files = [...event.target.files]
  event.target.value = ''
  uploadCardImages(files)
}
cardBody.addEventListener('paste', (event) => {
  const files = [...(event.clipboardData?.files || [])]
  if (!files.some((file) => file.type.startsWith('image/'))) return
  event.preventDefault()
  uploadCardImages(files)
})
cardBody.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  cardBody.classList.add('dropping')
})
cardBody.addEventListener('dragleave', () => cardBody.classList.remove('dropping'))
cardBody.addEventListener('drop', (event) => {
  cardBody.classList.remove('dropping')
  const files = [...(event.dataTransfer?.files || [])]
  if (!files.length) return
  event.preventDefault()
  uploadCardImages(files)
})

// Members: the owner grants admin; the owner and admins remove (ban) members.
// A ban makes every peer ignore what that member signs from now on; what they
// added before stays, and they keep the invite, so they can still read.
const membersModal = document.getElementById('members-modal')
const memberById = (identity) => members.find((member) => member.identity === identity)
let confirmingBan = null

function renderMembers() {
  const me = memberById(currentIdentity)
  const myRole = me && !me.banned ? me.role : 'member'
  document.getElementById('members-hint').textContent = !boardOwner
    ? 'This board has no owner yet: it gets one the next time its creator opens it. Until then nobody can be removed.'
    : myRole === 'member'
      ? 'Only the owner and admins can remove members.'
      : 'Removed members can still see the board, but everyone ignores their changes. To lock someone out completely, create a new board and invite the others.'
  const order = { owner: 0, admin: 1, member: 2 }
  const sorted = [...members].sort(
    (a, b) =>
      a.banned - b.banned ||
      order[a.role] - order[b.role] ||
      (a.name || a.identity).localeCompare(b.name || b.identity)
  )
  const list = document.getElementById('members-list')
  list.innerHTML = ''
  for (const member of sorted) {
    const row = document.createElement('div')
    row.className = `member-row${member.banned ? ' banned' : ''}`
    const badge = member.banned
      ? '<span class="role-badge banned">Removed</span>'
      : member.role === 'member'
        ? ''
        : `<span class="role-badge ${member.role}">${member.role === 'owner' ? 'Owner' : 'Admin'}</span>`
    const you = member.identity === currentIdentity ? ' <span class="muted">(you)</span>' : ''
    row.innerHTML = `<span class="identity" dir="auto">${avatar(member.identity)}${escape(member.name || shortKey(member.identity))}${you}</span>${badge}<span class="member-actions"></span>`
    const actions = row.querySelector('.member-actions')
    const add = (label, onClick, className = 'ghost') => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = className
      button.textContent = label
      button.onclick = onClick
      actions.append(button)
    }
    const self = member.identity === currentIdentity
    if (myRole === 'owner' && member.role !== 'owner' && !member.banned) {
      const admin = member.role === 'admin'
      add(admin ? 'Remove admin' : 'Make admin', () =>
        send({
          type: 'board:member-role',
          identity: member.identity,
          role: admin ? 'member' : 'admin'
        })
      )
    }
    const canBan =
      !self &&
      member.role !== 'owner' &&
      (myRole === 'owner' || (myRole === 'admin' && member.role !== 'admin'))
    if (canBan && member.banned) {
      add('Let back in', () =>
        send({ type: 'board:member-ban', identity: member.identity, banned: false })
      )
    } else if (canBan) {
      const confirming = confirmingBan === member.identity
      add(
        confirming ? 'Confirm remove' : 'Remove',
        () => {
          if (!confirming) {
            confirmingBan = member.identity
            renderMembers()
            setTimeout(() => {
              if (confirmingBan !== member.identity) return
              confirmingBan = null
              if (membersModal.classList.contains('open')) renderMembers()
            }, 4000)
            return
          }
          confirmingBan = null
          send({ type: 'board:member-ban', identity: member.identity, banned: true })
        },
        confirming ? 'danger' : 'ghost danger'
      )
    }
    list.append(row)
  }
}

function openMembers() {
  confirmingBan = null
  renderMembers()
  membersModal.classList.add('open')
  document.getElementById('close-members-modal').focus()
}

function closeMembers() {
  membersModal.classList.remove('open')
}

document.getElementById('members-open').onclick = openMembers
document.getElementById('close-members-modal').onclick = closeMembers
membersModal.onclick = (event) => {
  if (event.target === membersModal) closeMembers()
}

function onActionError(message) {
  if (profileModal.classList.contains('open')) {
    const error = document.getElementById('profile-modal-error')
    error.textContent = message.error
    error.hidden = false
  } else if (membersModal.classList.contains('open')) {
    document.getElementById('members-hint').textContent = message.error
  } else if (rulesModal.classList.contains('open')) {
    ruleError(message.error)
  } else if (templatesModal.classList.contains('open')) {
    const error = document.getElementById('templates-error')
    error.textContent = message.error
    error.hidden = false
  } else if (message.action === 'board:template-apply') {
    showToast(message.error, 'warn')
  } else if (!document.getElementById('theme-panel').hidden) {
    const error = document.getElementById('theme-error')
    error.textContent = message.error
    error.hidden = false
  } else console.error(message.error)
}

// Export: the worker builds the JSON (no invite or secret), saved as a file.
let exportRequest = null
document.getElementById('board-export').onclick = () => {
  exportRequest = `${Date.now()}`
  send({ type: 'board:export', requestId: exportRequest })
}

function onBoardExport(message) {
  if (message.requestId !== exportRequest || !message.data) return
  exportRequest = null
  const name = (message.data.board.name || 'board').replace(/[^\w-]+/g, '-').slice(0, 40)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(
    new window.Blob([JSON.stringify(message.data, null, 2)], { type: 'application/json' })
  )
  link.download = `${name || 'board'}-${message.data.exportedAt.slice(0, 10)}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 10000)
}

// Notification sound, chosen per device. Plays once per batch of new alerts,
// never for what a board's first check finds.
const SOUND_KEY = 'opencollab.notification-sound'
const soundSelect = document.getElementById('notification-sound')

function soundSetting() {
  try {
    return localStorage.getItem(SOUND_KEY) || 'chime'
  } catch {
    return 'chime'
  }
}

function playSound(name = soundSetting()) {
  if (name === 'off') return
  const audio = new window.Audio(`sounds/${name}.wav`)
  audio.volume = 0.6
  audio.play().catch(() => {})
}

soundSelect.value = soundSetting()
soundSelect.onchange = () => {
  try {
    localStorage.setItem(SOUND_KEY, soundSelect.value)
  } catch {}
  playSound(soundSelect.value)
}

// Mode and personal template, from the theme panel. Both apply at once.
for (const button of document.querySelectorAll('[data-theme-mode]')) {
  button.onclick = () => {
    themeMode = button.dataset.themeMode
    saveDeviceSetting(THEME_MODE_KEY, themeMode)
    applyTheme()
    renderThemePanel()
  }
}
const overrideSelect = document.getElementById('theme-override')
overrideSelect.innerHTML =
  '<option value="">Board theme</option>' +
  THEME_TEMPLATES.map(
    (template) => `<option value="${template.id}">${escape(template.name)}</option>`
  ).join('')
overrideSelect.onchange = (event) => {
  themeOverride = event.target.value
  saveDeviceSetting(THEME_OVERRIDE_KEY, themeOverride)
  applyTheme()
  renderThemePanel()
}
applyTheme()

// Panels opened from the board bar and settings menu share one overlay style:
// a backdrop click, the ✕ button or Escape closes them and focus goes back.
const activityModal = document.getElementById('activity-modal')
const statsModal = document.getElementById('stats-modal')
const myWorkModal = document.getElementById('my-work-modal')
const rulesModal = document.getElementById('rules-modal')
const templatesModal = document.getElementById('templates-modal')
const confirmModal = document.getElementById('confirm-modal')
const overlayReturn = new Map()

function openOverlay(modal) {
  overlayReturn.set(modal, document.activeElement)
  modal.classList.add('open')
  modal.querySelector('[data-close]')?.focus()
}

function closeOverlay(modal) {
  if (!modal.classList.contains('open')) return
  modal.classList.remove('open')
  const target = overlayReturn.get(modal)
  overlayReturn.delete(modal)
  if (target?.isConnected) target.focus()
}

for (const modal of document.querySelectorAll('.overlay')) {
  if (modal === confirmModal) continue
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('[data-close]')) closeOverlay(modal)
  })
}

const topOverlay = () =>
  [...document.querySelectorAll('.overlay.open')].filter((modal) => modal !== confirmModal).pop()

// A styled confirm(): resolves true or false; Escape and the backdrop cancel.
let confirmFinish = null

function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  confirmFinish?.(false)
  const returnTo = document.activeElement
  document.getElementById('confirm-title').textContent = title
  document.getElementById('confirm-body').textContent = body
  const ok = document.getElementById('confirm-ok')
  ok.textContent = confirmLabel
  ok.className = danger ? 'danger' : ''
  confirmModal.classList.add('open')
  ok.focus()
  return new Promise((resolve) => {
    confirmFinish = (value) => {
      confirmFinish = null
      confirmModal.classList.remove('open')
      if (returnTo?.isConnected) returnTo.focus()
      resolve(value)
    }
  })
}

document.getElementById('confirm-ok').onclick = () => confirmFinish?.(true)
document.getElementById('confirm-cancel').onclick = () => confirmFinish?.(false)
confirmModal.onclick = (event) => {
  if (event.target === confirmModal) confirmFinish?.(false)
}

// A toast stays 4s; hovering it or leaving the window pauses the countdown.
const toast = document.getElementById('toast')
const TOAST_MS = 4000
let toastTimer = null
let toastLeft = 0
let toastStarted = 0

function runToastTimer() {
  clearTimeout(toastTimer)
  toastStarted = Date.now()
  toastTimer = setTimeout(() => (toast.hidden = true), toastLeft)
}

function pauseToast() {
  if (toast.hidden || !toastTimer) return
  clearTimeout(toastTimer)
  toastTimer = null
  toastLeft = Math.max(800, toastLeft - (Date.now() - toastStarted))
}

function resumeToast() {
  if (toast.hidden || toastTimer || toast.matches(':hover') || document.hidden) return
  runToastTimer()
}

function showToast(text, kind = '') {
  toast.textContent = text
  toast.className = `toast${kind ? ` ${kind}` : ''}`
  // Hiding first replays the entrance for a message replacing another.
  toast.hidden = true
  void toast.offsetWidth
  toast.hidden = false
  toastLeft = TOAST_MS
  toastTimer = null
  if (document.hidden) return
  runToastTimer()
}

toast.addEventListener('mouseenter', pauseToast)
toast.addEventListener('mouseleave', resumeToast)
document.addEventListener('visibilitychange', () =>
  document.hidden ? pauseToast() : resumeToast()
)

// Board activity feed and stats refresh while open; board-state can arrive in
// bursts, so the requests are coalesced.
let panelsTimer = null

function refreshPanels() {
  if (panelsTimer) return
  panelsTimer = setTimeout(() => {
    panelsTimer = null
    if (activityModal.classList.contains('open')) requestBoardActivity()
    if (statsModal.classList.contains('open')) request('stats', { type: 'board:stats' })
    if (openCardId && cardTab === 'activity') requestCardActivity()
  }, 400)
}

function requestBoardActivity() {
  request('board-activity', { type: 'board:activity', cardId: null, limit: 150 })
}

document.getElementById('activity-open').onclick = () => {
  document.getElementById('board-activity').innerHTML = '<p class="muted hint">Loading…</p>'
  seenActivity.delete(document.getElementById('board-activity'))
  openOverlay(activityModal)
  requestBoardActivity()
}

document.getElementById('stats-open').onclick = () => {
  document.getElementById('board-stats').innerHTML = '<p class="muted hint">Loading…</p>'
  openOverlay(statsModal)
  request('stats', { type: 'board:stats' })
}

function onBoardActivity(message) {
  const entries = message.entries || []
  if (message.requestId === latestRequest['board-activity']) {
    renderActivity(document.getElementById('board-activity'), entries, true)
  } else if (
    message.requestId === latestRequest['card-activity'] &&
    message.cardId === openCardId
  ) {
    renderActivity(document.getElementById('card-activity'), entries, false)
  }
}

function onBoardStats(message) {
  if (message.requestId !== latestRequest.stats || !message.stats) return
  const box = document.getElementById('board-stats')
  const scroll = box.scrollTop
  box.innerHTML = renderStats(message.stats, { avatar, memberName })
  box.scrollTop = scroll
}

function onCardCreated(message) {
  if (message.requestId !== latestRequest['card-created'] || !message.objectId) return
  // The new card shows up with the next board-state; open it then.
  pendingOpenCard = { boardKey: currentBoardKey, cardId: message.objectId }
  openPendingCard()
}

// My work: cards assigned to me on every joined board, from the background checks.
function renderMyWork() {
  const list = document.getElementById('my-work-list')
  const boards = alertBoards.filter((board) => board.mine?.length)
  if (!boards.length) {
    const checking = alertBoards.some((board) => !board.checkedAt)
    list.innerHTML = `<div class="notifications-empty">${checking ? 'Checking your boards…' : 'Nothing is assigned to you. Enjoy the quiet.'}</div>`
    return
  }
  list.innerHTML = ''
  for (const board of boards) {
    const head = document.createElement('div')
    head.className = 'notifications-board'
    head.innerHTML = `<span class="board-label"><strong dir="auto">${escape(board.name || 'Board')}</strong>${board.key === currentBoardKey ? '<span class="open-tag">&nbsp;· open</span>' : ''}</span><span class="time">${board.mine.length} ${board.mine.length === 1 ? 'card' : 'cards'}</span>`
    list.append(head)
    for (const item of board.mine) {
      const entry = document.createElement('button')
      entry.className = 'mention-item my-work-item'
      const checklist = item.checklist?.total
        ? `<span class="checklist-count${item.checklist.done === item.checklist.total ? ' complete' : ''}">${icon('checklist')}${item.checklist.done}/${item.checklist.total}</span>`
        : ''
      entry.innerHTML = `<span class="what" dir="auto">${escape(item.title)}</span><span class="kanban-card-meta"><span dir="auto">${escape(item.columnName)}</span>${dueBadge(item)}${item.blocked ? `<span class="blocked-badge">${icon('lock')}Blocked</span>` : ''}${checklist}</span>`
      entry.onclick = () => {
        closeOverlay(myWorkModal)
        openBoardCard(board, item.id)
      }
      list.append(entry)
    }
  }
}

function updateMyWorkCount() {
  const count = alertBoards.reduce((sum, board) => sum + (board.mine?.length || 0), 0)
  const button = document.getElementById('my-work-button')
  button.innerHTML = `${icon('user')}<span>My work</span>${count ? `<span class="count">${count > 99 ? '99+' : count}</span>` : ''}`
  button.setAttribute('aria-label', `My work, ${count} open ${count === 1 ? 'card' : 'cards'}`)
  if (myWorkModal.classList.contains('open')) renderMyWork()
}

document.getElementById('my-work-button').onclick = () => {
  renderMyWork()
  openOverlay(myWorkModal)
}

document.getElementById('filter-mine').onclick = () => {
  filters.assignee = filters.assignee === currentIdentity ? '' : currentIdentity
  renderBoard()
}

// Board templates: confirmed first, since they rename the columns for everyone.
document.getElementById('board-templates-open').onclick = () => {
  document.getElementById('templates-error').hidden = true
  openOverlay(templatesModal)
}
for (const button of templatesModal.querySelectorAll('[data-board-template]')) {
  button.onclick = async () => {
    const name = button.querySelector('strong').textContent
    const confirmed = await confirmDialog({
      title: `Use the ${name} template?`,
      body: 'Columns are renamed and added for everyone on this board. Cards stay, labels are added.',
      confirmLabel: 'Apply template'
    })
    if (!confirmed) return
    send({ type: 'board:template-apply', template: button.dataset.boardTemplate })
    closeOverlay(templatesModal)
    showToast(`${name} template applied`)
  }
}

// Automation rules: a list with on/off switches, and one form to add or edit.
const ruleDraft = { ruleId: null, labels: new Set(), assignees: new Set() }

function ruleSummary(rule) {
  const column = (id) => columns.find((entry) => entry.id === id)?.name || 'a deleted column'
  const trigger = rule.trigger
  const when =
    trigger.kind === 'enter'
      ? `When a card enters ${column(trigger.columnId)}`
      : trigger.kind === 'create'
        ? `When a card is created${trigger.columnId ? ` in ${column(trigger.columnId)}` : ''}`
        : `Every ${trigger.every}, create “${rule.card?.title || 'a card'}”${trigger.columnId ? ` in ${column(trigger.columnId)}` : ''}`
  const { actions } = rule
  const then = [
    actions.labelIds.length
      ? `add ${actions.labelIds.map((id) => labels.find((label) => label.id === id)?.name || 'a label').join(', ')}`
      : '',
    actions.assignees.length ? `assign ${actions.assignees.map(memberName).join(', ')}` : '',
    actions.assignActor ? 'assign whoever triggered it' : '',
    actions.dueInDays !== null
      ? `due in ${actions.dueInDays} ${actions.dueInDays === 1 ? 'day' : 'days'}`
      : '',
    actions.completeChecklist ? 'check the checklist' : '',
    actions.archive ? 'archive it' : ''
  ].filter(Boolean)
  return `${when}${then.length ? ` → ${then.join(', ')}` : ''}`
}

const ruleBody = (rule) => {
  const { id, ...body } = rule
  return body
}

function renderRules() {
  const list = document.getElementById('rules-list')
  keepFocus(list, () => {
    list.innerHTML = rules.length
      ? ''
      : '<div class="labels-empty">No rules yet. Automate the busywork below: label, assign or archive cards as they move.</div>'
    for (const rule of rules) {
      const row = document.createElement('div')
      row.className = `rule-row${rule.enabled ? '' : ' disabled'}${ruleDraft.ruleId === rule.id ? ' editing' : ''}`
      row.innerHTML = `<label class="switch"><input type="checkbox" role="switch" ${rule.enabled ? 'checked' : ''} aria-label="Rule enabled" data-focus-key="rule-on:${escape(rule.id)}" /></label>
        <div class="rule-text"><strong dir="auto">${escape(rule.name || 'Untitled rule')}</strong><span class="muted" dir="auto">${escape(ruleSummary(rule))}</span></div>
        <button type="button" class="ghost" data-focus-key="rule-edit:${escape(rule.id)}">Edit</button>
        <button type="button" class="ghost icon-only" aria-label="Delete rule ${escape(rule.name)}" data-focus-key="rule-delete:${escape(rule.id)}">${icon('trash')}</button>`
      row.querySelector('input').onchange = (event) =>
        send({
          type: 'board:rule-upsert',
          ruleId: rule.id,
          rule: { ...ruleBody(rule), enabled: event.target.checked }
        })
      const [edit, remove] = row.querySelectorAll('button')
      edit.onclick = () => editRule(rule)
      remove.onclick = () => {
        if (!remove.classList.contains('danger')) {
          remove.className = 'danger'
          withIcon(remove, 'trash', 'Delete?')
          setTimeout(() => remove.isConnected && renderRules(), 3000)
          return
        }
        send({ type: 'board:rule-delete', ruleId: rule.id })
        if (ruleDraft.ruleId === rule.id) resetRuleForm()
      }
      list.append(row)
    }
  })
  renderRuleChoices()
}

// Column options, label and member toggles follow the board; the rest of the
// form keeps what was typed.
function renderRuleChoices() {
  const trigger = document.getElementById('rule-trigger').value
  const column = document.getElementById('rule-column')
  const selected = column.value
  column.innerHTML = `${trigger === 'enter' ? '' : `<option value="">${trigger === 'schedule' ? 'First column' : 'Any column'}</option>`}${columns
    .map((entry) => `<option value="${escape(entry.id)}">${escape(entry.name)}</option>`)
    .join('')}`
  column.value = [...column.options].some((option) => option.value === selected)
    ? selected
    : column.options[0]?.value || ''
  document.getElementById('rule-column-label').textContent =
    trigger === 'schedule' ? 'In column' : trigger === 'create' ? 'In column' : 'Column'
  document.getElementById('rule-every-field').hidden = trigger !== 'schedule'
  document.getElementById('rule-card-fields').hidden = trigger !== 'schedule'
  // A scheduled card has nobody who triggered it, nothing to check off or archive yet.
  for (const id of ['rule-assign-actor', 'rule-complete', 'rule-archive']) {
    document.getElementById(id).closest('label').hidden = trigger === 'schedule'
  }

  const labelBox = document.getElementById('rule-labels')
  keepFocus(labelBox, () => {
    labelBox.innerHTML = labels.length
      ? labels
          .map((label) => {
            const on = ruleDraft.labels.has(label.id)
            return `<button type="button" class="label-toggle${on ? ' on' : ''}" style="--label-color: ${label.color || '#8590a2'}" aria-pressed="${on}" data-rule-label="${escape(label.id)}" data-focus-key="rule-label:${escape(label.id)}">${on ? '✓ ' : ''}${escape(label.name || 'Unnamed')}</button>`
          })
          .join('')
      : '<span class="muted hint">No labels on this board</span>'
  })
  for (const button of labelBox.querySelectorAll('[data-rule-label]')) {
    button.onclick = () => {
      const id = button.dataset.ruleLabel
      if (!ruleDraft.labels.delete(id)) ruleDraft.labels.add(id)
      renderRuleChoices()
    }
  }
  const people = document.getElementById('rule-assignees')
  keepFocus(people, () => {
    people.innerHTML = members
      .filter((member) => !member.banned)
      .map((member) => {
        const on = ruleDraft.assignees.has(member.identity)
        return `<button type="button" class="assign-option${on ? ' on' : ''}" aria-pressed="${on}" data-rule-assignee="${escape(member.identity)}" data-focus-key="rule-assignee:${escape(member.identity)}">${avatar(member.identity)}<span dir="auto">${escape(memberName(member.identity))}</span><span class="check-mark" aria-hidden="true">${on ? '✓' : ''}</span></button>`
      })
      .join('')
  })
  for (const button of people.querySelectorAll('[data-rule-assignee]')) {
    button.onclick = () => {
      const id = button.dataset.ruleAssignee
      if (!ruleDraft.assignees.delete(id)) ruleDraft.assignees.add(id)
      renderRuleChoices()
    }
  }
}

function resetRuleForm() {
  ruleDraft.ruleId = null
  ruleDraft.labels.clear()
  ruleDraft.assignees.clear()
  document.getElementById('rule-form').reset()
  document.getElementById('rule-form-title').textContent = 'New rule'
  document.getElementById('rule-form-reset').hidden = true
  document.getElementById('rule-save').textContent = 'Add rule'
  document.getElementById('rule-error').hidden = true
  renderRules()
}

function editRule(rule) {
  resetRuleForm()
  ruleDraft.ruleId = rule.id
  for (const id of rule.actions.labelIds) ruleDraft.labels.add(id)
  for (const id of rule.actions.assignees) ruleDraft.assignees.add(id)
  const value = (id, next) => (document.getElementById(id).value = next)
  value('rule-name', rule.name)
  value('rule-trigger', rule.trigger.kind)
  if (rule.trigger.kind === 'schedule') value('rule-every', rule.trigger.every)
  value('rule-card-title', rule.card?.title || '')
  value('rule-card-checklist', (rule.card?.checklist || []).join('\n'))
  document.getElementById('rule-assign-actor').checked = rule.actions.assignActor
  document.getElementById('rule-due-on').checked = rule.actions.dueInDays !== null
  if (rule.actions.dueInDays !== null) value('rule-due-days', rule.actions.dueInDays)
  document.getElementById('rule-complete').checked = rule.actions.completeChecklist
  document.getElementById('rule-archive').checked = rule.actions.archive
  document.getElementById('rule-form-title').textContent = 'Edit rule'
  document.getElementById('rule-form-reset').hidden = false
  document.getElementById('rule-save').textContent = 'Save rule'
  renderRules()
  value('rule-column', rule.trigger.columnId || '')
  document.getElementById('rule-name').focus()
}

function ruleError(text) {
  const error = document.getElementById('rule-error')
  error.textContent = text
  error.hidden = !text
}

document.getElementById('rules-open').onclick = () => {
  resetRuleForm()
  openOverlay(rulesModal)
}
document.getElementById('rule-trigger').onchange = renderRuleChoices
document.getElementById('rule-form-reset').onclick = resetRuleForm
document.getElementById('rule-form').onsubmit = (event) => {
  event.preventDefault()
  const field = (id) => document.getElementById(id)
  const kind = field('rule-trigger').value
  const columnId = field('rule-column').value || null
  const days = Number(field('rule-due-days').value)
  if (field('rule-due-on').checked && !(Number.isInteger(days) && days >= 0 && days <= 365)) {
    return ruleError('Due dates can be 0 to 365 days out.')
  }
  if (kind === 'schedule' && !field('rule-card-title').value.trim()) {
    field('rule-card-title').focus()
    return ruleError('A scheduled rule needs the title of the card it creates.')
  }
  if (kind === 'enter' && !columnId) return ruleError('Pick the column the rule watches.')
  const rule = {
    name: field('rule-name').value.trim(),
    enabled: rules.find((entry) => entry.id === ruleDraft.ruleId)?.enabled ?? true,
    trigger:
      kind === 'schedule'
        ? { kind, every: field('rule-every').value, columnId }
        : { kind, columnId },
    actions: {
      labelIds: [...ruleDraft.labels],
      assignees: [...ruleDraft.assignees],
      assignActor: kind !== 'schedule' && field('rule-assign-actor').checked,
      dueInDays: field('rule-due-on').checked ? days : null,
      completeChecklist: kind !== 'schedule' && field('rule-complete').checked,
      archive: kind !== 'schedule' && field('rule-archive').checked
    }
  }
  if (kind === 'schedule') {
    rule.card = {
      title: field('rule-card-title').value.trim(),
      body: '',
      checklist: field('rule-card-checklist')
        .value.split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    }
  }
  send({
    type: 'board:rule-upsert',
    ...(ruleDraft.ruleId && { ruleId: ruleDraft.ruleId }),
    rule,
    requestId: `rule-${Date.now()}`
  })
  resetRuleForm()
}

// j / k move between cards in whichever view shows; Enter opens one.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'j' && event.key !== 'k') return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.target.closest?.('input, textarea, select, [contenteditable]')) return
  const modals = '.overlay.open, #card-modal.open, #labels-modal.open, #members-modal.open'
  if (document.querySelector(`${modals}, #profile-modal.open, #notifications-modal.open`)) return
  if (document.querySelector('#connection-modal.open')) return
  if (boardView.style.display !== 'block') return
  const cards = [
    ...viewContainers[boardViewMode].querySelectorAll(
      '.kanban-card, tr[data-card-id], .calendar-card'
    )
  ]
  if (!cards.length) return
  event.preventDefault()
  const current = cards.indexOf(document.activeElement)
  const next =
    current === -1
      ? 0
      : Math.max(0, Math.min(cards.length - 1, current + (event.key === 'j' ? 1 : -1)))
  cards[next].focus()
  cards[next].scrollIntoView({ block: 'nearest', inline: 'nearest' })
})
