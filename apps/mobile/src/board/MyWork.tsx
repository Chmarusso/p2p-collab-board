// Cards assigned to me on every joined board, soonest due first. The worker
// keeps the lists current with the notification checks, so boards that aren't
// open show up too.
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { t } from '../i18n'
import { PressableScale, colors, mono, themed } from '../ui'
import { ProgressBar } from './CardExtras'
import { Sheet } from './Panels'
import { AlertBoard, MyCard, dueInfo } from './model'

export function MyWorkSheet({
  boards,
  currentKey,
  onOpen,
  onClose
}: {
  boards: AlertBoard[]
  currentKey: string
  onOpen: (board: AlertBoard, card: MyCard) => void
  onClose: () => void
}) {
  // The open board first, then the rest as the worker lists them.
  const withCards = boards
    .filter((board) => board.mine?.length)
    .sort((a, b) => Number(b.key === currentKey) - Number(a.key === currentKey))
  const total = withCards.reduce((sum, board) => sum + (board.mine?.length || 0), 0)
  return (
    <Sheet title={total ? t('My work ({n})', { n: total }) : t('My work')} onClose={onClose}>
      {!withCards.length ? (
        <View style={styles.empty}>
          <Feather name='check-circle' size={24} color={colors.muted} />
          <Text style={styles.muted}>
            {boards.some((board) => !board.checkedAt)
              ? t('Checking your boards…')
              : t('Nothing is assigned to you on any board.')}
          </Text>
        </View>
      ) : null}
      {withCards.map((board) => (
        <View key={board.key} style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupName} numberOfLines={1}>
              {board.name || t('Board')}
            </Text>
            {board.key === currentKey ? (
              <Text style={styles.openTag}>{` · ${t('open')}`}</Text>
            ) : null}
          </View>
          {(board.mine || []).map((card) => {
            const due = dueInfo(card.dueDate)
            return (
              <PressableScale
                key={card.id}
                onPress={() => onOpen(board, card)}
                style={[styles.card]}
                scaleTo={0.98}
                accessibilityRole='button'
                accessibilityLabel={[
                  card.title,
                  card.columnName,
                  card.blocked ? t('blocked') : '',
                  due ? t('due {date}', { date: due.text }) : ''
                ]
                  .filter(Boolean)
                  .join(', ')}
              >
                <Text style={styles.title} numberOfLines={3}>
                  {card.title}
                </Text>
                <View style={styles.meta}>
                  <Text style={styles.mono} numberOfLines={1}>
                    {card.columnName}
                  </Text>
                  {due ? (
                    <Text
                      style={[
                        styles.mono,
                        due.status === 'overdue' && styles.overdue,
                        due.status === 'soon' && styles.soon
                      ]}
                    >
                      {due.status === 'overdue' ? `${t('overdue')} · ` : ''}
                      {due.text}
                    </Text>
                  ) : null}
                  {card.blocked ? (
                    <Text style={[styles.mono, styles.overdue]}>{t('blocked')}</Text>
                  ) : null}
                </View>
                {card.checklist.total ? (
                  <View style={styles.meta}>
                    <Text style={styles.mono}>
                      {card.checklist.done}/{card.checklist.total}
                    </Text>
                    <View style={styles.flex}>
                      <ProgressBar done={card.checklist.done} total={card.checklist.total} />
                    </View>
                  </View>
                ) : null}
              </PressableScale>
            )
          })}
        </View>
      ))}
    </Sheet>
  )
}

const styles = themed(() => ({
  flex: { flex: 1 },
  muted: { color: colors.muted, lineHeight: 20, textAlign: 'center' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  group: { gap: 8, marginTop: 6 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline' },
  groupName: { color: colors.text, fontWeight: '700', flexShrink: 1 },
  openTag: { color: colors.muted, flexShrink: 0 },
  card: {
    gap: 6,
    padding: 12,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  title: { color: colors.text, fontWeight: '600', fontSize: 15, lineHeight: 20 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  mono: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  overdue: { color: colors.danger },
  soon: { color: colors.warn }
}))
