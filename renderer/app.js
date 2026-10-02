const bridge = window.bridge
const normalizeInvite = (value) => {
  const invite = String(value || '').trim()
  const match = invite.match(
    /^(?:opencollab:\/\/board\/|opencollab:\/\/|https?:\/\/[^/]+\/board\/)?(.+)$/i
  )
  return decodeURIComponent(match ? match[1] : invite).replace(/\/$/, '')
}
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
let currentIdentity = ''
let currentDisplayName = ''
let objects = []
let profiles = {}
let boardSynced = false
let roomEntered = false
let identityUnlocked = false

function send(message) {
  bridge.writeWorkerIPC(workers.main, JSON.stringify(message))
}

function showBoardManagement() {
  if (!identityUnlocked) return
  roomEntered = false
  boardSynced = false
  roomGate.style.display = 'block'
  profileGate.style.display = 'none'
  boardView.style.display = 'none'
  showRoomChoice()
  showRecentBoards()
}

async function showRecentBoards() {
  const boards = await bridge.recentBoardsList()
  recentBoards.innerHTML = boards.length ? '<p class="muted">Joined boards</p>' : ''
  for (const board of boards) {
    const row = document.createElement('div')
    row.className = 'recent-board'

    const join = document.createElement('button')
    join.className = 'secondary'
    join.innerText = board.name || 'Board name loading…'
    join.onclick = () => send({ type: 'room:start', invite: board.invite, name: board.name })

    const remove = document.createElement('button')
    remove.className = 'secondary'
    remove.innerText = 'Remove'
    remove.setAttribute('aria-label', `Remove ${board.name || 'joined board'}`)
    remove.onclick = async () => {
      if (!window.confirm(`Remove “${board.name || 'this board'}” from joined boards?`)) return
      await bridge.recentBoardsRemove(board.invite)
      await showRecentBoards()
    }

    row.append(join, remove)
    recentBoards.appendChild(row)
  }
}

async function rememberBoard(board) {
  await bridge.recentBoardsSave(board)
  await showRecentBoards()
}

function updateIdentityMenu() {
  identityMenu.innerText = '@' + (currentDisplayName || 'DisplayName')
}

function openConnectionModal() {
  document.getElementById('modal-identity').innerText = currentIdentity
  document.getElementById('modal-network').innerText =
    document.getElementById('room-network').innerText
  document.getElementById('modal-peers').innerText =
    document.getElementById('peer-status').innerText
  document.getElementById('modal-invite').innerText =
    document.getElementById('active-invite').innerText
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
function renderBoard(nextObjects) {
  objects = nextObjects
  boardObjects.innerHTML = ''
  if (!objects.length) {
    boardObjects.innerHTML = '<div class="card muted">No objects yet. Add the first proposal.</div>'
    return
  }
  for (const object of objects) {
    const card = document.createElement('article')
    card.className = 'card'
    const votes = Object.values(object.votes || {})
    const score = votes.reduce((sum, value) => sum + value, 0)
    const displayName = (identity) => profiles[identity] || (identity || '').slice(0, 12)
    const comments = (object.comments || [])
      .map(
        (comment) =>
          `<div class="comment"><b>${escape(displayName(comment.author))}</b> ${escape(comment.text)}<br><small>${new Date(comment.createdAt).toLocaleString()}</small></div>`
      )
      .join('')
    card.innerHTML = `<div class="object-header"><div><div class="object-title">${escape(object.title)}</div><div class="muted">by ${escape(displayName(object.author))}</div></div><div class="votes"><button class="secondary" data-vote="1">▲</button><span class="score">${score}</span><button class="secondary" data-vote="-1">▼</button></div></div><div class="object-body">${escape(object.body)}</div><div class="comments">${comments || '<span class="muted">No comments yet.</span>'}</div><form class="comment-form"><input placeholder="Add a comment" /><button>Comment</button></form>`
    card.querySelector('[data-vote="1"]').onclick = () =>
      send({ type: 'board:vote', objectId: object.id, value: 1 })
    card.querySelector('[data-vote="-1"]').onclick = () =>
      send({ type: 'board:vote', objectId: object.id, value: -1 })
    card.querySelector('form').onsubmit = (event) => {
      event.preventDefault()
      const input = event.currentTarget.querySelector('input')
      if (input.value.trim())
        send({ type: 'board:comment', objectId: object.id, text: input.value.trim() })
      input.value = ''
    }
    boardObjects.appendChild(card)
  }
}

function setBoardLoading(loading) {
  boardLoading.classList.toggle('visible', loading)
  document.querySelector('.new-object').style.display = loading ? 'none' : 'grid'
  boardObjects.style.display = loading ? 'none' : 'grid'
}

bridge.onWorkerIPC(workers.main, (data) => {
  let message
  try {
    message = JSON.parse(decoder.decode(data))
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
      if (hasDisplayName) document.getElementById('display-name').value = message.displayName
      if (hasDisplayName) {
        currentDisplayName = message.displayName
        updateIdentityMenu()
      }
      document.getElementById('active-invite').innerText = message.invite
      if (message.boardName) document.getElementById('board-name').innerText = message.boardName
      if (message.boardName) rememberBoard({ invite: message.invite, name: message.boardName })
    }
  }
  if (message.type === 'room-debug') {
    roomError.innerText = 'Room: ' + message.status
    document.getElementById('room-network').innerText = 'Network: ' + message.status
  }
  if (message.type === 'peer-count')
    document.getElementById('peer-status').innerText = message.count
  if (message.type === 'board-state') {
    profiles = message.profiles || {}
    renderBoard(message.objects)
  }
  if (message.type === 'board-name') {
    document.getElementById('board-name').innerText = message.name
    const invite = document.getElementById('active-invite').innerText
    if (invite) rememberBoard({ invite, name: message.name })
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
  }
})
bridge.startWorker(workers.main)

identityMenu.onclick = openConnectionModal
document.getElementById('close-connection-modal').onclick = closeConnectionModal
document.getElementById('switch-board').onclick = () => {
  closeConnectionModal()
  showBoardManagement()
  send({ type: 'room:leave' })
}
connectionModal.onclick = (event) => {
  if (event.target === connectionModal) closeConnectionModal()
}
document.getElementById('copy-invite').onclick = async () => {
  await navigator.clipboard.writeText(document.getElementById('modal-invite').innerText)
  document.getElementById('copy-invite').innerText = 'Copied'
  setTimeout(
    () => (document.getElementById('copy-invite').innerText = 'Copy invitation link'),
    1200
  )
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && connectionModal.classList.contains('open')) closeConnectionModal()
})

function showRoomChoice() {
  document.getElementById('room-choice').style.display = 'flex'
  document.getElementById('room-create-form').style.display = 'none'
  document.getElementById('room-join-form').style.display = 'none'
  roomError.innerText = ''
}
document.getElementById('room-create-choice').onclick = () => {
  document.getElementById('room-choice').style.display = 'none'
  document.getElementById('room-create-form').style.display = 'block'
}
document.getElementById('room-join-choice').onclick = () => {
  document.getElementById('room-choice').style.display = 'none'
  document.getElementById('room-join-form').style.display = 'block'
}
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
document.getElementById('room-create').onclick = () =>
  send({ type: 'room:start', invite: null, name: document.getElementById('room-name').value })
document.getElementById('room-join').onclick = () =>
  send({
    type: 'room:start',
    invite: normalizeInvite(document.getElementById('room-invite').value)
  })
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
document.getElementById('object-add').onclick = () => {
  const title = document.getElementById('object-title')
  if (!title.value.trim()) return
  send({
    type: 'board:create',
    title: title.value,
    body: document.getElementById('object-body').value
  })
  title.value = ''
  document.getElementById('object-body').value = ''
}

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
