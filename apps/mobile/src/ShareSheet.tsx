// Shown when a link or post is shared to OpenCollab from another app: pick the
// board it goes to. The card itself is written in the usual composer.
import React from 'react'
import { Sheet } from './board/Panels'
import { BoardList, SharedPreview } from './SharedItems'
import type { ShareBoard } from './SharedItems'
import type { SharedRecord } from './sharedHistory'
import { t } from './i18n'

export type { ShareBoard }

export function ShareSheet({
  item,
  loading,
  boards,
  hiddenCount,
  onPick,
  onClose
}: {
  item: SharedRecord
  loading: boolean
  boards: ShareBoard[]
  hiddenCount: number
  onPick: (board: ShareBoard) => void
  onClose: () => void
}) {
  return (
    <Sheet title={t('Add to board')} onClose={onClose}>
      <SharedPreview record={item} loading={loading} />
      <BoardList boards={boards} hiddenCount={hiddenCount} onPick={onPick} />
    </Sheet>
  )
}
