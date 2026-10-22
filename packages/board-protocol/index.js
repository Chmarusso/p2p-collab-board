const board = require('./board')
const alerts = require('./alerts')

const messageTypes = Object.freeze({
  identityLoad: 'identity:load',
  identityCreate: 'identity:create-mobile',
  roomStart: 'room:start',
  roomLeave: 'room:leave',
  profileSet: 'profile:set',
  boardCreate: 'board:create',
  boardVote: 'board:vote',
  boardComment: 'board:comment',
  cardUpdate: 'board:card-update',
  cardMove: 'board:card-move',
  cardArchive: 'board:card-archive',
  columnCreate: 'board:column-create',
  columnUpdate: 'board:column-update',
  columnDelete: 'board:column-delete',
  labelUpsert: 'board:label-upsert',
  labelDelete: 'board:label-delete',
  themeSet: 'board:theme-set',
  boardDescribe: 'board:describe',
  boardsWatch: 'boards:watch',
  boardAlerts: 'board-alerts',
  cardImagesAdd: 'board:card-images-add',
  identityStatus: 'identity-status',
  roomStatus: 'room-status',
  boardState: 'board-state',
  boardSynced: 'board-synced',
  profileStatus: 'profile-status'
})

function command(type, fields = {}) {
  return { type, ...fields }
}

function normalizeInvite(value) {
  if (typeof value !== 'string') return ''
  const invite = value.trim()
  if (!invite) return ''
  const match = invite.match(
    /^(?:opencollab:\/\/board\/|opencollab:\/\/|https?:\/\/[^/]+\/board\/)?(.+)$/i
  )
  return decodeURIComponent(match ? match[1] : invite).replace(/\/$/, '')
}

function inviteLink(invite) {
  const normalized = normalizeInvite(invite)
  return normalized ? `opencollab://board/${encodeURIComponent(normalized)}` : ''
}

module.exports = { messageTypes, command, normalizeInvite, inviteLink, ...board, ...alerts }
