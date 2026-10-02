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
let profiles = {}
let boardSynced = false
let roomEntered = false
let identityUnlocked = false
// Board state re-renders often; keep per-object UI state outside the DOM.
const expandedComments = new Set()
const commentDrafts = new Map()
const seenObjects = new Set()
const seenComments = new Set()
const lastScores = new Map()
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
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
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
  boardView.style.display = 'none'
  document.getElementById('gate-identity').innerHTML = identityHtml(currentIdentity)
  showRoomChoice()
  showRecentBoards()
}

function resetBoardUi() {
  expandedComments.clear()
  commentDrafts.clear()
  seenObjects.clear()
  seenComments.clear()
  lastScores.clear()
  closeNewObject()
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

function captureFocus() {
  const active = document.activeElement
  if (!active?.dataset?.commentFor) return null
  return {
    objectId: active.dataset.commentFor,
    start: active.selectionStart,
    end: active.selectionEnd
  }
}

function restoreFocus(focus) {
  if (!focus) return
  const input = [...boardObjects.querySelectorAll('[data-comment-for]')].find(
    (element) => element.dataset.commentFor === focus.objectId
  )
  if (!input) return
  input.focus()
  input.setSelectionRange(focus.start, focus.end)
}

function renderComment(comment) {
  const element = document.createElement('div')
  element.className = 'comment'
  if (!seenComments.has(comment.id)) {
    seenComments.add(comment.id)
    element.classList.add('enter')
  }
  element.innerHTML = `<div class="comment-meta">${identityHtml(comment.author)}<span class="time" title="${escape(new Date(comment.createdAt).toLocaleString())}">${escape(relativeTime(comment.createdAt))}</span></div><div>${escape(comment.text)}</div>`
  return element
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

function renderObject(object) {
  const card = document.createElement('article')
  card.className = 'card object-card'
  if (!seenObjects.has(object.id)) {
    seenObjects.add(object.id)
    card.classList.add('enter')
  }
  const votes = object.votes || {}
  const score = Object.values(votes).reduce((sum, value) => sum + value, 0)
  const ownVote = votes[currentIdentity] || 0
  const comments = [...(object.comments || [])].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  )
  const expanded = expandedComments.has(object.id)
  const bump = lastScores.has(object.id) && lastScores.get(object.id) !== score
  lastScores.set(object.id, score)

  card.innerHTML = `<div class="votes">
      <button class="${ownVote === 1 ? 'voted-up' : ''}" data-vote="1" aria-label="Upvote" aria-pressed="${ownVote === 1}">${icon('up')}</button>
      <span class="score${bump ? ' bump' : ''}" aria-label="Score">${score}</span>
      <button class="${ownVote === -1 ? 'voted-down' : ''}" data-vote="-1" aria-label="Downvote" aria-pressed="${ownVote === -1}">${icon('down')}</button>
    </div>
    <div>
      <div class="object-title">${escape(object.title)}</div>
      <div class="comment-meta">${identityHtml(object.author)}<span class="time">${escape(relativeTime(object.createdAt))}</span></div>
      <div class="object-body">${escape(object.body)}</div>
      ${object.images?.length ? '<div class="object-images"></div>' : ''}
      <button class="ghost comments-toggle" aria-expanded="${expanded}">${icon('message')}<span>${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}</span>${icon('right', 'icon chevron')}</button>
      <div class="comments-panel${expanded ? ' open' : ''}">
        ${comments.length ? '<div class="comments"></div>' : ''}
        <form class="comment-form"><input placeholder="Add a comment" aria-label="Add a comment" /><button>Comment</button></form>
      </div>
    </div>`

  if (object.images?.length) renderImages(card, object)

  const commentList = card.querySelector('.comments')
  for (const comment of comments) commentList.appendChild(renderComment(comment))

  // Step by one: with a vote cast, either arrow first clears it.
  const vote = (value) =>
    send({ type: 'board:vote', objectId: object.id, value: ownVote ? 0 : value })
  card.querySelector('[data-vote="1"]').onclick = () => vote(1)
  card.querySelector('[data-vote="-1"]').onclick = () => vote(-1)

  const toggle = card.querySelector('.comments-toggle')
  const panel = card.querySelector('.comments-panel')
  const input = card.querySelector('.comment-form input')
  input.dataset.commentFor = object.id
  input.value = commentDrafts.get(object.id) || ''
  input.oninput = () => commentDrafts.set(object.id, input.value)
  toggle.onclick = () => {
    const open = !expandedComments.has(object.id)
    if (open) expandedComments.add(object.id)
    else expandedComments.delete(object.id)
    toggle.setAttribute('aria-expanded', String(open))
    panel.classList.toggle('open', open)
    if (open) input.focus()
  }
  card.querySelector('form').onsubmit = (event) => {
    event.preventDefault()
    const text = input.value.trim()
    if (text) send({ type: 'board:comment', objectId: object.id, text })
    input.value = ''
    commentDrafts.delete(object.id)
  }
  return card
}

function renderBoard(nextObjects) {
  // Newest first; worker order follows storage keys, not creation time.
  objects = [...(nextObjects || [])].sort(
    (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
  )
  const focus = captureFocus()
  boardObjects.innerHTML = ''
  if (!objects.length) {
    boardObjects.innerHTML =
      '<div class="card muted prompt">No objects yet. Add the first proposal.</div>'
    return
  }
  for (const object of objects) boardObjects.appendChild(renderObject(object))
  restoreFocus(focus)
}

function setBoardLoading(loading) {
  boardLoading.classList.toggle('visible', loading)
  document.querySelector('.new-object-bar').style.display = loading ? 'none' : 'flex'
  boardObjects.style.display = loading ? 'none' : 'grid'
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
  boardView.style.display = 'none'
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
      boardView.style.display = 'none'
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
      boardSynced = false
      roomGate.style.display = 'none'
      const hasDisplayName = Boolean(message.displayName)
      profileGate.style.display = hasDisplayName ? 'none' : 'block'
      boardView.style.display = hasDisplayName ? 'block' : 'none'
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
    renderBoard(message.objects)
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
    boardView.style.display = 'block'
    setBoardLoading(!boardSynced)
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

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (document.getElementById('image-viewer').classList.contains('open')) closeImageViewer()
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
