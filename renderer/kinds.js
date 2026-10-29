// Mirrors packages/board-protocol/kinds.js (the renderer loads plain ES modules
// and cannot require it); scripts/test-kinds.mjs checks the copies match.
//
// Board types. A type changes how a board is shown, not what it stores: every
// board keeps the same cards, sections (columns), images, comments and
// reactions. The type picks the layout, which card features are on show and
// the sections a new board starts with. Hiding a feature never deletes its
// data, so switching back brings it all back.
//
// The board's owner sets the type (`board:info` with `kind`); every client
// reads it from `info.kind`. Clients that predate types ignore the field and
// show the board as Kanban, sections as columns.

// Features a type can turn off. Comments, images and reactions are always on.
const BOARD_FEATURES = Object.freeze([
  'checklist', // checklist items on cards
  'due', // due dates, the Agenda view
  'assignees', // assigned people, "Assigned to me"
  'labels',
  'points', // story points and planning-poker estimates
  'links', // blocks / relates-to links between cards
  'votes',
  'rules', // automation rules
  'wip', // WIP limits on columns
  'stats',
  'templates' // template cards and board templates
])

const BOARD_KINDS = Object.freeze({
  kanban: Object.freeze({
    name: 'Kanban',
    description: 'Columns for work in progress, with checklists, due dates and people.',
    layout: 'columns',
    sections: null, // the default columns
    features: BOARD_FEATURES
  }),
  todo: Object.freeze({
    name: 'To-do list',
    description: 'One list to tick off. Done items fold away.',
    layout: 'list',
    sections: Object.freeze(['To do', 'Done']),
    features: Object.freeze(['due', 'assignees'])
  }),
  feed: Object.freeze({
    name: 'Feed',
    description: 'Posts, links and photos, newest first.',
    layout: 'feed',
    sections: Object.freeze(['Posts']),
    features: Object.freeze([])
  }),
  recipes: Object.freeze({
    name: 'Recipes',
    description: 'Photos and how-tos, sorted into meals.',
    layout: 'sections',
    sections: Object.freeze(['Breakfast', 'Lunch', 'Dinner', 'Desserts']),
    features: Object.freeze(['labels'])
  })
})

const BOARD_KIND_IDS = Object.freeze(Object.keys(BOARD_KINDS))
const DEFAULT_BOARD_KIND = 'kanban'

const isBoardKind = (value) => typeof value === 'string' && BOARD_KIND_IDS.includes(value)

// The type's definition with its id; unknown or missing types are Kanban, so a
// board from a newer client still opens.
function boardKind(kind) {
  const id = isBoardKind(kind) ? kind : DEFAULT_BOARD_KIND
  return { id, ...BOARD_KINDS[id] }
}

const hasFeature = (kind, feature) => boardKind(kind).features.includes(feature)

// Feed posts without a photo get a cover: a two-colour gradient with the post's
// text on it. The colours come from the card id, so every client draws the
// same cover for the same post. `ink` is the text colour on it.
const FEED_COVERS = Object.freeze([
  Object.freeze({ from: '#ff7a59', to: '#ff3d77', ink: '#1b0a05' }),
  Object.freeze({ from: '#5b3fd9', to: '#2f6fdb', ink: '#ffffff' }),
  Object.freeze({ from: '#00b894', to: '#00cec9', ink: '#04110a' }),
  Object.freeze({ from: '#fdcb6e', to: '#e17055', ink: '#1b1305' }),
  Object.freeze({ from: '#0a6abf', to: '#5a49d6', ink: '#ffffff' }),
  Object.freeze({ from: '#2d3436', to: '#636e72', ink: '#ffffff' }),
  Object.freeze({ from: '#b8296f', to: '#d6447f', ink: '#ffffff' }),
  Object.freeze({ from: '#55efc4', to: '#81ecec', ink: '#04110a' })
])

function feedCover(id) {
  let hash = 0
  for (const char of String(id || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return FEED_COVERS[hash % FEED_COVERS.length]
}

export {
  BOARD_FEATURES,
  BOARD_KINDS,
  BOARD_KIND_IDS,
  DEFAULT_BOARD_KIND,
  isBoardKind,
  boardKind,
  hasFeature,
  FEED_COVERS,
  feedCover
}
