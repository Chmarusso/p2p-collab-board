// Polish: English source text → Polish. One file per area of the app, so each
// can be edited on its own; scripts/check-translations.mjs lists any t('…')
// string that has no Polish entry.
import app from './app'
import board from './board'
import card from './card'
import panels from './panels'
import chat from './chat'
import shorts from './shorts'
import notify from './notify'

const pl: Record<string, string> = {
  ...app,
  ...board,
  ...card,
  ...panels,
  ...shorts,
  ...chat,
  ...notify
}

export default pl
