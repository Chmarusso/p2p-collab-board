import { renderMarkdown, findMentions } from './markdown.js'

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
let theme = { background: null, accent: null }
let colorPickerColumn = null
let colorPickerEntering = false
// Moves made here land where the user put them; only peers' moves animate.
const localCardMoves = new Set()
const localColumnMoves = new Set()
let lastUnreadMentions = 0
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
let recoloringLabel = null
let newLabelColor = null
const filters = { labels: new Set(), member: '', due: '' }
// Trello's label palette.
const LABEL_COLORS = ['#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef']
LABEL_COLORS.push('#579dff', '#6cc3e0', '#94c748', '#e774bb', '#8590a2')
// Mentions: what this device has read is kept locally, per identity and board.
const notifiedMentions = new Set()
let mentionsPrimed = false
// Image attachments: bytes live encrypted in each author's Hyperblobs core;
// the worker fetches them on demand and they are cached here as data URLs.
const MAX_IMAGES = 4
const MAX_IMAGE_SIDE = 1600
const imageCache = new Map()
const imageRequests = new Set()
let pendingImages = []

const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>',
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
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  palette:
    '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a5 5 0 0 0 5-5c0-5.5-4.5-10-10-10z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'
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

function identityHtml(identity) {
  const name = profiles[identity]
  return `<span class="identity" title="${escape(identity)}">${identicon(identity)}${name ? `<span class="name">${escape(name)}</span>` : ''}<span>${escape(shortKey(identity))}</span></span>`
}

function relativeTime(value) {
  const time = new Date(value).getTime()
  if (!time) return ''
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(time).toLocaleDateString()
}

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
  notifiedMentions.clear()
  mentionsPrimed = false
  lastUnreadMentions = 0
  filters.labels.clear()
  filters.member = ''
  filters.due = ''
  document.getElementById('filter-panel').hidden = true
  document.getElementById('theme-panel').hidden = true
  closeLabelsManager()
  colorPickerColumn = null
  theme = { background: null, accent: null }
  closeCard()
  closeMentions()
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

// Theme values are validated by the worker: a preset id or #rrggbb.
function applyTheme() {
  const root = document.documentElement
  const open = document.body.classList.contains('board-open')
  const background = open ? theme.background : null
  const accent = open ? theme.accent : null
  if (background) {
    root.style.setProperty(
      '--board-bg',
      BACKGROUNDS[background] || (background.startsWith('#') ? background : 'var(--bg)')
    )
  } else root.style.removeProperty('--board-bg')
  document.body.classList.toggle('themed', !!background)
  // Text sitting on a light custom background turns dark.
  if (background?.startsWith('#') && luminance(background) > 0.35) {
    root.style.setProperty('--board-ink', '#0b0f14')
  } else root.style.removeProperty('--board-ink')
  if (accent) {
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-ink', luminance(accent) > 0.4 ? '#04110a' : '#ffffff')
  } else {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-ink')
  }
}

function setTheme(change) {
  send({ type: 'board:theme-set', ...change })
}

function renderThemePanel() {
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

  const accents = document.getElementById('theme-accents')
  accents.innerHTML =
    ACCENTS.map(
      (color, index) =>
        `<button type="button" class="swatch" style="--label-color: ${color}" data-accent="${index === 0 ? '' : color}" aria-label="Accent ${color}" aria-pressed="${(theme.accent || ACCENTS[0]) === color}"></button>`
    ).join('') +
    `<label class="swatch custom" title="Custom accent">+<input type="color" aria-label="Custom accent color" value="${theme.accent || ACCENTS[0]}" /></label>`
  for (const button of accents.querySelectorAll('[data-accent]')) {
    button.onclick = () => setTheme({ accent: button.dataset.accent || null })
  }
  accents.querySelector('input').onchange = (event) => setTheme({ accent: event.target.value })
}

async function showRecentBoards() {
  if (!currentIdentity) {
    recentBoards.innerHTML = ''
    return
  }
  const boards = await bridge.recentBoardsList(currentIdentity)
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

function updateIdentityMenu() {
  identityMenu.innerHTML = `${identicon(currentIdentity)}<span>@${escape(currentDisplayName || 'DisplayName')}</span>`
}

function updateStatusChip() {
  const chip = document.getElementById('status-chip')
  chip.classList.toggle('online', peerCount > 0)
  document.getElementById('peer-status').innerText =
    `${peerCount} ${peerCount === 1 ? 'peer' : 'peers'}`
  document.getElementById('sync-status').innerText = boardSynced ? 'synced' : 'syncing…'
}

function openConnectionModal() {
  document.getElementById('modal-identity').innerHTML = identityHtml(currentIdentity)
  document.getElementById('modal-network').innerText = networkStatus
  document.getElementById('modal-peers').innerText = peerCount
  document.getElementById('copy-invite').disabled = !currentInvite
  document.getElementById('share-invite').disabled = !currentInvite
  connectionModal.classList.add('open')
  document.getElementById('close-connection-modal').focus()
}

function closeConnectionModal() {
  connectionModal.classList.remove('open')
  identityMenu.focus()
}

function escape(value) {
  const div = document.createElement('div')
  div.textContent = value ?? ''
  return div.innerHTML
}

function renderComment(comment) {
  const element = document.createElement('div')
  element.className = 'comment'
  if (!seenComments.has(comment.id)) {
    seenComments.add(comment.id)
    element.classList.add('enter')
  }
  element.innerHTML = `<div class="comment-meta">${identityHtml(comment.author)}<span class="time" title="${escape(new Date(comment.createdAt).toLocaleString())}">${escape(relativeTime(comment.createdAt))}</span></div><div class="markdown"></div>`
  element.querySelector('.markdown').append(markdownFor(comment.text, comment.mentions))
  return element
}

function markdownFor(text, mentions) {
  return renderMarkdown(text, {
    mentions: (mentions || [])
      .filter((identity) => profiles[identity])
      .map((identity) => ({ identity, name: profiles[identity] })),
    self: currentIdentity
  })
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

function openImageViewer(url) {
  const viewer = document.getElementById('image-viewer')
  viewer.querySelector('img').src = url
  viewer.classList.add('open')
}

function closeImageViewer() {
  document.getElementById('image-viewer').classList.remove('open')
}

// Downscale to MAX_IMAGE_SIDE and re-encode as JPEG to keep transfers small.
// GIFs are kept as-is so animations survive.
async function prepareImage(file) {
  if (file.type === 'image/gif') {
    const url = await readAsDataUrl(file)
    const bitmap = await window.createImageBitmap(file)
    return { url, type: file.type, width: bitmap.width, height: bitmap.height }
  }
  const bitmap = await window.createImageBitmap(file)
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
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
const visibleCards = (columnId) =>
  cardsIn(columnId).filter((object) => (showArchived || !object.archived) && matchesFilters(object))

// Date-only due dates are due at the end of that day, local time.
function dueInfo(dueDate) {
  if (!dueDate) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
  const [year, month, day] = dueDate.split('-').map(Number)
  const deadline = dateOnly ? new Date(year, month - 1, day, 23, 59, 59) : new Date(dueDate)
  if (Number.isNaN(deadline.getTime())) return null
  const left = deadline - Date.now()
  const text = deadline.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

function labelChips(labelIds) {
  return (labelIds || [])
    .map((id) => labels.find((label) => label.id === id))
    .filter(Boolean)
    .map(
      (label) =>
        `<span class="label-chip" style="--label-color: ${label.color || '#8590a2'}" title="${escape(label.name)}">${escape(label.name)}</span>`
    )
    .join('')
}

const mentionsMember = (object, identity) =>
  object.mentions?.includes(identity) ||
  object.comments?.some((comment) => comment.mentions?.includes(identity))

function matchesFilters(object) {
  if (filters.labels.size && !object.labelIds?.some((id) => filters.labels.has(id))) return false
  if (filters.member && !mentionsMember(object, filters.member)) return false
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

const filterCount = () => filters.labels.size + (filters.member ? 1 : 0) + (filters.due ? 1 : 0)

// The worker places a card by index among all cards of the column, archived
// ones included; the UI counts only the cards it shows.
function moveCard(cardId, columnId, visibleIndex) {
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
  const images = object.images?.length || 0
  const chips = labelChips(object.labelIds)
  card.innerHTML = `${chips ? `<div class="label-list">${chips}</div>` : ''}<div class="kanban-card-title">${escape(object.title)}</div>
    <div class="kanban-card-meta">${[
      dueBadge(object),
      Object.keys(object.votes || {}).length
        ? `<span title="Score">${icon(score < 0 ? 'down' : 'up')}${score}</span>`
        : '',
      object.body?.trim() ? `<span title="Has a description">${icon('text')}</span>` : '',
      comments ? `<span title="Comments">${icon('message')}${comments}</span>` : '',
      unreadMentions().some((item) => item.cardId === object.id)
        ? '<span class="mention mention-me" title="You were mentioned">@</span>'
        : '',
      images ? `<span title="Images">${icon('image')}${images}</span>` : '',
      object.archived ? '<span>archived</span>' : ''
    ].join('')}</div>`
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
    name.title = 'Rename column'
    name.onclick = () => {
      renamingColumn = { id: column.id, text: column.name }
      renderBoard()
      document.querySelector(`[data-focus-key="rename:${column.id}"]`)?.select()
    }
    head.append(name)
  }
  const count = document.createElement('span')
  count.className = 'column-count'
  count.textContent = cards.length
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
  head.append(count, tools)
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
    foot.append(add)
  }

  element.append(head)
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
  const before = animate ? boardRects() : null
  renderDeferred = false
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
    input?.setSelectionRange?.(focus.start, focus.end)
  } else if (focus?.cardId) {
    document.querySelector(`[data-card-id="${focus.cardId}"]`)?.focus()
  }
  if (before) {
    animateBoardChanges(before)
    localCardMoves.clear()
    localColumnMoves.clear()
  }

  const archived = objects.filter((object) => object.archived).length
  const archivedToggle = document.getElementById('archived-toggle')
  archivedToggle.hidden = !archived && !showArchived
  archivedToggle.textContent = `${showArchived ? 'Hide' : 'Show'} archived (${archived})`
  archivedToggle.setAttribute('aria-pressed', String(showArchived))
  renderColumnOptions(document.getElementById('object-column'))
  renderFilters()
  if (!document.getElementById('theme-panel').hidden) renderThemePanel()
  if (labelsModal.classList.contains('open')) renderLabelsManager()
  refreshCard()
  updateMentions()
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
  document.getElementById('filter-due').value = filters.due
  const shown = objects.filter((o) => (showArchived || !o.archived) && matchesFilters(o)).length
  const total = objects.filter((o) => showArchived || !o.archived).length
  document.getElementById('filter-summary').textContent = count
    ? `Showing ${shown} of ${total} cards`
    : ''
  document.getElementById('filter-clear').hidden = !count
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
document.getElementById('filter-due').onchange = (event) => {
  filters.due = event.target.value
  renderBoard()
}
document.getElementById('filter-clear').onclick = () => {
  filters.labels.clear()
  filters.member = ''
  filters.due = ''
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
  document.getElementById('card-label-new').value = ''
  closeDuePopover()
  document.getElementById('card-comment').value = ''
  const images = document.getElementById('card-images')
  images.innerHTML = ''
  if (object.images?.length) renderImages(cardModal, object)
  images.hidden = !object.images?.length
  refreshCard()
  cardModal.classList.add('open')
  cardTitle.focus()
}

function closeCard() {
  if (!openCardId) return
  openCardId = null
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
    if (object.body?.trim()) view.append(markdownFor(object.body, object.mentions))
    else view.textContent = 'Add a more detailed description…'
  }
  document.getElementById('card-author').innerHTML =
    `${identityHtml(object.author)}<span class="time">${escape(relativeTime(object.createdAt))}</span>`
  renderColumnOptions(cardColumn, object.columnId)
  document.getElementById('card-archived-badge').hidden = !object.archived
  renderCardLabels(object)
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
  list.innerHTML = ''
  const comments = [...(object.comments || [])].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  )
  for (const comment of comments) list.appendChild(renderComment(comment))
  markMentionsRead((item) => item.cardId === object.id)
}

function refreshDue(object) {
  const due = dueInfo(object.dueDate)
  const button = document.getElementById('card-due-button')
  button.className = `ghost due-button${due ? ` set ${due.status}` : ''}`
  button.innerHTML = due
    ? `${icon('clock')}<span>${escape(due.text)}${due.status === 'overdue' ? ' · overdue' : due.status === 'soon' ? ' · due soon' : ''}</span>`
    : `${icon('plus')}<span>Add due date</span>`
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
cardColumn.onchange = () => {
  if (openCardId) moveCard(openCardId, cardColumn.value, Infinity)
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
}
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
  boardObjects.style.display = loading ? 'none' : 'flex'
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
      if (message.boardName) {
        document.getElementById('board-name').innerText = message.boardName
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
  }
  if (message.type === 'board-state') {
    profiles = message.profiles || {}
    objects = message.objects || []
    columns = message.columns || []
    labels = message.labels || []
    labelDraft = null
    theme = message.theme || { background: null, accent: null }
    // A board loading or syncing in bulk isn't cards arriving: no entry motion.
    const arrived = objects.filter((object) => !seenObjects.has(object.id))
    if (arrived.length > 3) for (const object of arrived) seenObjects.add(object.id)
    applyTheme()
    renderBoard({ animate: true })
  }
  if (message.type === 'board-name') {
    document.getElementById('board-name').innerText = message.name
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
  }
  if (message.type === 'board-synced') {
    boardSynced = true
    updateMentions()
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

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (document.getElementById('image-viewer').classList.contains('open')) closeImageViewer()
  else if (labelsModal.classList.contains('open')) closeLabelsManager()
  else if (cardModal.classList.contains('open')) closeCard()
  else if (mentionsModal.classList.contains('open')) closeMentions()
  else if (connectionModal.classList.contains('open')) closeConnectionModal()
  else if (newObjectForm.classList.contains('open')) {
    closeNewObject()
    newObjectToggle.focus()
  }
})

function showRoomChoice() {
  document.getElementById('room-choice').style.display = 'flex'
  document.getElementById('room-create-form').style.display = 'none'
  document.getElementById('room-join-form').style.display = 'none'
  recentBoards.style.display = ''
  roomError.innerText = ''
}
function showRoomForm(id) {
  document.getElementById('room-choice').style.display = 'none'
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
document.getElementById('room-create').onclick = () => {
  const name = document.getElementById('room-name').value.trim()
  if (!name) {
    roomError.innerText = 'Give your board a name.'
    return
  }
  roomError.innerText = ''
  send({ type: 'room:start', invite: null, name })
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
          `<div role="option" class="mention-option${index === active ? ' active' : ''}" data-index="${index}" aria-selected="${index === active}">${identicon(identity)}<span>${escape(name)}</span></div>`
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

const mentionsModal = document.getElementById('mentions-modal')

function hashText(text) {
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}

const readMentionsKey = () =>
  `opencollab.mentions-read.${currentIdentity}.${hashText(currentInvite)}`

function readMentions() {
  try {
    return new Set(JSON.parse(localStorage.getItem(readMentionsKey()) || '[]'))
  } catch {
    return new Set()
  }
}

function markMentionsRead(predicate) {
  const items = mentionItems().filter(predicate)
  if (!items.length) return
  const read = readMentions()
  const before = read.size
  for (const item of items) read.add(item.key)
  if (read.size === before) return
  try {
    localStorage.setItem(readMentionsKey(), JSON.stringify([...read]))
  } catch {}
  updateMentions()
  for (const card of document.querySelectorAll('.kanban-card')) {
    if (items.some((item) => item.cardId === card.dataset.cardId)) {
      card.querySelector('.kanban-card-meta .mention-me')?.remove()
    }
  }
}

// Every card description and comment by someone else that mentions me.
function mentionItems() {
  if (!currentIdentity) return []
  const items = []
  for (const object of objects) {
    if (object.author !== currentIdentity && object.mentions?.includes(currentIdentity)) {
      items.push({
        key: `card:${object.id}:${hashText(object.body || '')}`,
        cardId: object.id,
        author: object.author,
        title: object.title,
        text: object.body,
        at: object.createdAt
      })
    }
    for (const comment of object.comments || []) {
      if (comment.author === currentIdentity || !comment.mentions?.includes(currentIdentity)) {
        continue
      }
      items.push({
        key: `comment:${comment.id}`,
        cardId: object.id,
        author: comment.author,
        title: object.title,
        text: comment.text,
        at: comment.createdAt
      })
    }
  }
  return items.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
}

function unreadMentions() {
  const read = readMentions()
  return mentionItems().filter((item) => !read.has(item.key))
}

function updateMentions() {
  const items = mentionItems()
  const unread = unreadMentions()
  const button = document.getElementById('mentions-button')
  button.hidden = !items.length
  button.classList.toggle('unread', unread.length > 0)
  document.getElementById('mentions-count').textContent = unread.length || ''
  // A new unread mention gives the button one small pop; reading them doesn't.
  if (mentionsPrimed && unread.length > lastUnreadMentions && !reducedMotion.matches) {
    button.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 240, easing: cssToken('--ease-out') }
    )
  }
  lastUnreadMentions = unread.length
  button.setAttribute('aria-label', `Mentions, ${unread.length} unread`)
  if (mentionsModal.classList.contains('open')) renderMentions()

  // Notify only about mentions that arrive while the app runs, and only when
  // the window isn't in front; the badge covers the rest.
  for (const item of unread) {
    if (notifiedMentions.has(item.key)) continue
    notifiedMentions.add(item.key)
    if (!mentionsPrimed || document.hasFocus()) continue
    const notification = new window.Notification(
      `${profiles[item.author] || 'Someone'} mentioned you`,
      {
        body: `${item.title}: ${(item.text || '').slice(0, 120)}`
      }
    )
    notification.onclick = () => {
      window.focus()
      openCard(item.cardId)
    }
  }
  if (boardSynced) mentionsPrimed = true
}

function renderMentions() {
  const read = readMentions()
  const list = document.getElementById('mentions-list')
  list.innerHTML = ''
  for (const item of mentionItems()) {
    const entry = document.createElement('button')
    entry.className = `mention-item${read.has(item.key) ? '' : ' unread'}`
    entry.innerHTML = `<div class="comment-meta">${identityHtml(item.author)}<span class="time">${escape(relativeTime(item.at))}</span></div>
      <strong>${escape(item.title)}</strong><span class="snippet">${escape(item.text || '')}</span>`
    entry.onclick = () => {
      closeMentions()
      openCard(item.cardId)
    }
    list.append(entry)
  }
}

function closeMentions() {
  mentionsModal.classList.remove('open')
}

document.getElementById('mentions-button').onclick = () => {
  renderMentions()
  mentionsModal.classList.add('open')
  document.getElementById('close-mentions-modal').focus()
}
document.getElementById('close-mentions-modal').onclick = closeMentions
document.getElementById('mentions-read').onclick = () => markMentionsRead(() => true)
mentionsModal.onclick = (event) => {
  if (event.target === mentionsModal) closeMentions()
}
