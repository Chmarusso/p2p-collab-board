// The board as a to-do list: open cards grouped by when they are due. Cards
// already in the last column are done and left out. It is the screen's own
// scroller, with the board header on top, so long boards stay virtualized.
import React, { useState } from 'react'
import { Pressable, SectionList, Text, View } from 'react-native'
import { t } from '../i18n'
import { colors, mono, themed } from '../ui'
import { Card, agenda } from './model'

export function Agenda({
  cards,
  header,
  renderCard
}: {
  cards: Card[]
  header: React.ReactElement
  renderCard: (card: Card) => React.ReactNode
}) {
  // Undated cards are usually the bulk of a board; they wait behind a tap.
  const [showUndated, setShowUndated] = useState(false)
  const sections = agenda(cards)
    .filter((group) => group.cards.length)
    .map((group) => ({
      name: group.name,
      total: group.cards.length,
      data: group.name === 'No date' && !showUndated ? [] : group.cards
    }))
  return (
    <SectionList
      sections={sections}
      keyExtractor={(card) => card.id}
      ListHeaderComponent={header}
      ListHeaderComponentStyle={styles.header}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps='handled'
      stickySectionHeadersEnabled={false}
      initialNumToRender={12}
      ListEmptyComponent={
        <Text style={styles.empty}>
          {t('No open cards match. Everything is done, or filtered out.')}
        </Text>
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.head}>
          <Text
            style={[styles.name, { color: groupColor(section.name) }]}
            accessibilityRole='header'
          >
            {t(section.name)}
          </Text>
          <Text style={styles.count}>{section.total}</Text>
          {section.name === 'No date' ? (
            <Pressable
              onPress={() => setShowUndated(!showUndated)}
              hitSlop={10}
              style={styles.toggle}
              accessibilityRole='button'
            >
              <Text style={styles.link}>{showUndated ? t('Hide') : t('Show')}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      renderItem={({ item }) => <View style={styles.item}>{renderCard(item)}</View>}
    />
  )
}

const groupColor = (name: string) =>
  name === 'Overdue' ? colors.danger : name === 'Today' ? colors.warn : colors.text

const styles = themed(() => ({
  page: { paddingTop: 64, paddingBottom: 120 },
  header: { marginBottom: 6 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8
  },
  name: { fontSize: 17, fontWeight: '700' },
  count: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  toggle: { marginLeft: 'auto' },
  link: { color: colors.info, fontWeight: '600', fontSize: 14 },
  item: { paddingHorizontal: 16, paddingBottom: 8 }
}))
