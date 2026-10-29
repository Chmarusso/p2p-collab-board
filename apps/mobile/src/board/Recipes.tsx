// The Recipes layout (board-protocol/kinds.js, layout 'sections'): the board's
// sections as tabs over a two-column grid of photo cards.
import React, { useState } from 'react'
import { Dimensions, Image, Pressable, ScrollView, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { CachedImage, ImageRef, colors, mono, themed, tint } from '../ui'
import { useImageUri } from './Panels'
import { Card, Column, imagesOf, sourceSite } from './model'

const GUTTER = 16
const GAP = 12
const TILE = (Dimensions.get('window').width - GUTTER * 2 - GAP) / 2

export function RecipesView({
  columns,
  visible,
  cache,
  requestImage,
  accent,
  ink,
  onOpen,
  onAdd
}: {
  columns: Column[]
  visible: (columnId: string) => Card[]
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  accent: string
  // Text on the accent colour.
  ink: string
  onOpen: (cardId: string) => void
  onAdd: (columnId: string) => void
}) {
  // null: every section, newest first.
  const [section, setSection] = useState<string | null>(null)
  const current = columns.find((column) => column.id === section) || null
  const cards = current
    ? visible(current.id)
    : columns
        .flatMap((column) => visible(column.id))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  const tab = (id: string | null, name: string, count: number) => {
    const on = section === id
    return (
      <Pressable
        key={id || 'all'}
        onPress={() => setSection(id)}
        style={[styles.tab, on && { backgroundColor: accent, borderColor: accent }]}
        accessibilityRole='tab'
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${name}, ${count}`}
      >
        <Text style={[styles.tabText, on && { color: ink }]}>{name}</Text>
        <Text style={[styles.tabCount, on && { color: ink }]}>{count}</Text>
      </Pressable>
    )
  }
  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
        accessibilityRole='tablist'
      >
        {tab(
          null,
          'All',
          columns.reduce((sum, column) => sum + visible(column.id).length, 0)
        )}
        {columns.map((column) => tab(column.id, column.name, visible(column.id).length))}
      </ScrollView>
      <View style={styles.grid}>
        {cards.map((card) => (
          <Tile
            key={card.id}
            card={card}
            section={current ? null : columns.find((c) => c.id === card.columnId)?.name}
            cache={cache}
            requestImage={requestImage}
            onPress={() => onOpen(card.id)}
          />
        ))}
        <Pressable
          onPress={() => onAdd(current?.id || columns[0]?.id)}
          style={({ pressed }) => [styles.tile, styles.add, pressed && styles.pressed]}
          accessibilityRole='button'
          accessibilityLabel={`Add a recipe${current ? ` to ${current.name}` : ''}`}
        >
          <Feather name='plus' size={22} color={colors.muted} />
          <Text style={styles.addText}>{current ? `Add to ${current.name}` : 'Add a recipe'}</Text>
        </Pressable>
      </View>
      {!cards.length ? (
        <Text style={styles.empty}>
          Share a recipe from TikTok, Instagram or a website and pick this board, or add one here.
        </Text>
      ) : null}
    </View>
  )
}

function Tile({
  card,
  section,
  cache,
  requestImage,
  onPress
}: {
  card: Card
  section?: string | null
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  onPress: () => void
}) {
  const cover = imagesOf(card)[0]
  const uri = useImageUri(cover, cache, requestImage)
  const meta = [section, card.source ? sourceSite(card.source) : null].filter(Boolean).join(' · ')
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      accessibilityRole='button'
      accessibilityLabel={card.title}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.cover} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.cover, styles.coverEmpty]}>
          <Feather name='book-open' size={28} color={colors.muted} />
        </View>
      )}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={2}>
          {card.title}
        </Text>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

const styles = themed(() => ({
  root: { gap: 12 },
  tabs: { gap: 8, paddingHorizontal: GUTTER },
  tab: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  tabText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  tabCount: { color: colors.muted, fontFamily: mono, fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingHorizontal: GUTTER },
  tile: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    width: TILE
  },
  pressed: { opacity: 0.75 },
  cover: { width: '100%', aspectRatio: 1, backgroundColor: colors.surface },
  coverEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tint(colors.accent, 0.08)
  },
  text: { gap: 4, padding: 10 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  meta: { color: colors.muted, fontSize: 12 },
  add: {
    alignItems: 'center',
    aspectRatio: 1,
    borderStyle: 'dashed',
    gap: 6,
    justifyContent: 'center'
  },
  addText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  empty: { color: colors.muted, lineHeight: 20, paddingHorizontal: GUTTER }
}))
