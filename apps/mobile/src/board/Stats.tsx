// Board numbers: totals, weekly throughput, cycle time, columns against their
// WIP limits and who holds what. The worker computes them from the log.
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { messageTypes } from '@opencollab/board-protocol'
import { colors, mono, themed, mix } from '../ui'
import { locale, plural, t, tx } from '../i18n'
import { useWorkerReply } from './Activity'
import { Sheet } from './Panels'
import { BoardData, BoardStats, formatDuration, wipState } from './model'

type WorkerMessage = { type: string; [key: string]: any }

const CHART_HEIGHT = 120

export function StatsSheet({
  data,
  send,
  subscribe,
  nameFor,
  accent,
  onClose
}: {
  data: BoardData
  send: (message: object) => void
  subscribe: (listener: (message: WorkerMessage) => void) => () => void
  nameFor: (identity: string) => string
  accent: string
  onClose: () => void
}) {
  const stats = useWorkerReply<BoardStats>(
    send,
    subscribe,
    { type: messageTypes.statsGet },
    messageTypes.boardStats,
    (message) => message.stats,
    data
  )
  return (
    <Sheet title={t('Stats')} onClose={onClose}>
      {!stats ? (
        <Text style={[styles.muted, styles.center]}>{t('Counting…')}</Text>
      ) : (
        <StatsBody stats={stats} nameFor={nameFor} accent={accent} />
      )}
    </Sheet>
  )
}

function StatsBody({
  stats,
  nameFor,
  accent
}: {
  stats: BoardStats
  nameFor: (identity: string) => string
  accent: string
}) {
  const { totals } = stats
  const peak = Math.max(1, ...stats.weeks.flatMap((week) => [week.done, week.created]))
  // The busiest column sets the scale, over-limit ones included; a limit
  // beyond it has no marker.
  const columnPeak = Math.max(1, ...stats.columns.map((column) => column.count))
  return (
    <>
      <View style={styles.tiles}>
        <Tile label={t('Open')} value={totals.open} />
        <Tile label={tx('stats', 'Done')} value={totals.done} />
        <Tile label={t('Overdue')} value={totals.overdue} warn={totals.overdue > 0} />
        <Tile label={tx('stats', 'Blocked')} value={totals.blocked} warn={totals.blocked > 0} />
        <Tile label={t('Points open')} value={totals.pointsOpen} />
        <Tile label={t('Points done')} value={totals.pointsDone} />
      </View>

      <Text style={styles.sectionLabel}>
        {plural(
          stats.weeks.length,
          ['Throughput, last {n} week', 'Throughput, last {n} weeks'],
          [
            'Przepustowość, ostatni {n} tydzień',
            'Przepustowość, ostatnie {n} tygodnie',
            'Przepustowość, ostatnie {n} tygodni'
          ]
        )}
      </Text>
      <View style={styles.legend}>
        <View style={[styles.key, { backgroundColor: accent }]} />
        <Text style={styles.muted}>{tx('stats', 'Done')}</Text>
        <View style={[styles.key, styles.keyCreated]} />
        <Text style={styles.muted}>{t('Created')}</Text>
      </View>
      <View
        style={styles.chart}
        accessible
        accessibilityLabel={t('Cards done per week: {counts}', {
          counts: stats.weeks.map((week) => week.done).join(', ')
        })}
      >
        {stats.weeks.map((week) => (
          <View key={week.start} style={styles.week}>
            {/* Keeps room above a full-height bar for its value. */}
            <Text style={styles.barValue}> </Text>
            <View style={styles.bars}>
              <View>
                {week.done ? (
                  <Text
                    style={[
                      styles.barValue,
                      styles.barValueAbove,
                      { bottom: (week.done / peak) * CHART_HEIGHT + 2 }
                    ]}
                  >
                    {week.done}
                  </Text>
                ) : null}
                <View
                  style={[
                    styles.bar,
                    { height: (week.done / peak) * CHART_HEIGHT, backgroundColor: accent }
                  ]}
                />
              </View>
              <View
                style={[
                  styles.bar,
                  styles.barCreated,
                  { height: (week.created / peak) * CHART_HEIGHT }
                ]}
              />
            </View>
            <Text style={styles.axis}>
              {new Date(week.start).toLocaleDateString(locale(), {
                month: 'numeric',
                day: 'numeric'
              })}
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t('Cycle time')}</Text>
      <View style={styles.tiles}>
        <Tile label={t('Median')} value={formatDuration(stats.cycleTime.median)} />
        <Tile label={t('85th percentile')} value={formatDuration(stats.cycleTime.p85)} />
        <Tile label={t('Cards measured')} value={stats.cycleTime.count} />
      </View>

      <Text style={styles.sectionLabel}>{t('Columns')}</Text>
      {stats.columns.map((column) => {
        const state = wipState(column.count, column.wipLimit)
        return (
          <View key={column.id} style={styles.columnRow}>
            <View style={styles.columnHead}>
              <Text style={styles.columnName} numberOfLines={1}>
                {column.name}
              </Text>
              <Text
                style={[
                  styles.mono,
                  state === 'over' && styles.over,
                  state === 'full' && styles.full
                ]}
              >
                {column.wipLimit ? `${column.count}/${column.wipLimit}` : column.count}
                {column.points ? ` · ${t('{n} pts', { n: column.points })}` : ''}
              </Text>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.min(100, (column.count / columnPeak) * 100)}%`,
                    backgroundColor:
                      state === 'over' ? colors.danger : state === 'full' ? colors.warn : accent
                  }
                ]}
              />
              {column.wipLimit && column.wipLimit <= columnPeak ? (
                <View
                  style={[styles.limit, { left: `${(column.wipLimit / columnPeak) * 100}%` }]}
                />
              ) : null}
            </View>
          </View>
        )
      })}

      <Text style={styles.sectionLabel}>{t('People')}</Text>
      {stats.members.length ? (
        <View style={styles.table}>
          <View style={styles.tableRow}>
            <Text style={[styles.cell, styles.nameCell, styles.muted]}>{t('Member')}</Text>
            <Text style={[styles.cell, styles.muted]}>{t('Open')}</Text>
            <Text style={[styles.cell, styles.muted]}>{t('Done/wk')}</Text>
          </View>
          {stats.members.map((member) => (
            <View key={member.identity} style={styles.tableRow}>
              <Text style={[styles.cell, styles.nameCell, styles.text]} numberOfLines={1}>
                {member.name || nameFor(member.identity)}
              </Text>
              <Text style={[styles.cell, styles.mono]}>{member.open}</Text>
              <Text style={[styles.cell, styles.mono]}>{member.doneThisWeek}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>{t('Assign cards to see who holds what.')}</Text>
      )}
    </>
  )
}

function Tile({ label, value, warn }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <View style={styles.tile}>
      <Text
        style={[styles.tileValue, warn && styles.over]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
      >
        {typeof value === 'number' ? value.toLocaleString(locale()) : value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  )
}

const styles = themed(() => {
  // The neutral "created" series, between muted text and the card surface.
  const created = mix(colors.muted, colors.surface, 0.45)
  return {
    flex: { flex: 1 },
    muted: { color: colors.muted, fontSize: 13 },
    text: { color: colors.text },
    center: { textAlign: 'center', paddingVertical: 24 },
    mono: { color: colors.text, fontFamily: mono, fontSize: 12 },
    over: { color: colors.danger },
    full: { color: colors.warn },
    sectionLabel: {
      color: colors.muted,
      fontFamily: mono,
      fontSize: 11,
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginTop: 10
    },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tile: {
      flexGrow: 1,
      flexBasis: '30%',
      gap: 2,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceRaised
    },
    tileValue: { color: colors.text, fontFamily: mono, fontSize: 20, fontWeight: '700' },
    tileLabel: { color: colors.muted, fontSize: 12 },
    legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    key: { width: 10, height: 10, borderRadius: 2, marginLeft: 4 },
    keyCreated: { backgroundColor: created },
    chart: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 6,
      paddingTop: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    week: { flex: 1, alignItems: 'center', gap: 4 },
    bars: {
      height: CHART_HEIGHT,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 2
    },
    bar: { width: 9, minHeight: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
    barCreated: { backgroundColor: created },
    barValue: { color: colors.text, fontFamily: mono, fontSize: 11, minHeight: 14 },
    // Centred over the 9pt done bar.
    barValueAbove: { position: 'absolute', left: -16, width: 41, textAlign: 'center' },
    axis: { color: colors.muted, fontFamily: mono, fontSize: 11, marginBottom: 4 },
    columnRow: { gap: 6 },
    columnHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    columnName: { flex: 1, color: colors.text, fontWeight: '600' },
    track: { height: 8, borderRadius: 4, backgroundColor: colors.border },
    fill: { height: 8, borderRadius: 4 },
    limit: {
      position: 'absolute',
      top: -3,
      width: 2,
      height: 14,
      marginLeft: -1,
      backgroundColor: colors.text
    },
    table: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden'
    },
    tableRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      minHeight: 40,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border
    },
    cell: { width: 64, textAlign: 'right' },
    nameCell: { flex: 1, width: 'auto', textAlign: 'left' }
  }
})
