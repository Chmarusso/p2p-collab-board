const board = require('./board')
const alerts = require('./alerts')
const activity = require('./activity')
const themes = require('./themes')
const kinds = require('./kinds')

const messageTypes = Object.freeze({
  identityLoad: 'identity:load',
  identityCreate: 'identity:create-mobile',
  roomStart: 'room:start',
  roomLeave: 'room:leave',
  profileSet: 'profile:set',
  profileAvatarSet: 'profile:avatar-set',
  blindPeersSet: 'blind-peers:set',
  boardCreate: 'board:create',
  boardVote: 'board:vote',
  boardComment: 'board:comment',
  chatSend: 'board:chat-send',
  chatDelete: 'board:chat-delete',
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
  boardKindSet: 'board:kind-set',
  boardsWatch: 'boards:watch',
  boardAlerts: 'board-alerts',
  cardImagesAdd: 'board:card-images-add',
  cardMediaAdd: 'board:card-media-add',
  boardMedia: 'board:media',
  boardIconSet: 'board:icon-set',
  backgroundImageSet: 'board:background-image-set',
  memberRole: 'board:member-role',
  memberBan: 'board:member-ban',
  boardExport: 'board:export',
  checklistSet: 'board:checklist-set',
  reactionSet: 'board:reaction-set',
  linkSet: 'board:link-set',
  estimateSet: 'board:estimate-set',
  ruleUpsert: 'board:rule-upsert',
  ruleDelete: 'board:rule-delete',
  templateApply: 'board:template-apply',
  sampleReady: 'board:sample-ready',
  cardFromTemplate: 'board:card-from-template',
  activityGet: 'board:activity',
  statsGet: 'board:stats',
  presenceSet: 'board:presence-set',
  boardActivity: 'board-activity',
  boardStats: 'board-stats',
  boardPresence: 'board-presence',
  // Ops from other members just arrived (who, which cards); live only.
  peerActivity: 'peer-activity',
  identityStatus: 'identity-status',
  roomStatus: 'room-status',
  boardState: 'board-state',
  boardSynced: 'board-synced',
  profileStatus: 'profile-status'
})

// Blind peers that keep encrypted copies of every board online (see apps/blind-peer).
// Add your deployed blind peer's public key here; hosts can override the list at
// runtime with `blindPeersSet`.
const BLIND_PEERS = Object.freeze([])

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

module.exports = {
  messageTypes,
  BLIND_PEERS,
  command,
  normalizeInvite,
  inviteLink,
  ...board,
  ...alerts,
  ...activity,
  ...themes,
  ...kinds
}
