// Markdown for card descriptions, comments and the board description. Text
// comes from other peers, so nothing in it can run or load anything: raw HTML
// shows as text, remote images are dropped (they would leak the reader's IP),
// and only http(s)/mailto links open. `![alt](image:<key>)` shows one of the
// card's own encrypted attachments, the same convention as on desktop.
import React, { useEffect } from 'react'
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Lexer, type Token, type Tokens } from 'marked'
import { CachedImage, ImageRef, colors, imageKey, mono } from '../ui'

export type Mention = { identity: string; name: string }

type Props = {
  text: string
  mentions?: Mention[]
  self?: string
  images?: ImageRef[]
  cache?: Record<string, CachedImage>
  onRequestImage?: (ref: ImageRef) => void
  onOpenImage?: (uri: string) => void
  numberOfLines?: number
}

const openLink = (href: string) => {
  if (/^(https?|mailto):/i.test(href)) void Linking.openURL(href)
}

export function Markdown(props: Props) {
  const tokens = Lexer.lex(props.text || '', { gfm: true, breaks: true })
  // Compact previews (the board description) render plain text, clamped.
  if (props.numberOfLines) {
    return (
      <Text style={styles.text} numberOfLines={props.numberOfLines}>
        {renderInline(tokens.flatMap(inlineOf), props, 'p')}
      </Text>
    )
  }
  return (
    <View style={styles.block}>{tokens.map((token, i) => renderBlock(token, props, `${i}`))}</View>
  )
}

const inlineOf = (token: Token): Token[] =>
  'tokens' in token && token.tokens ? [...token.tokens, { type: 'text', raw: ' ', text: ' ' }] : []

function renderBlock(token: Token, props: Props, key: string): React.ReactNode {
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading
      return (
        <Text key={key} style={[styles.text, heading.depth <= 2 ? styles.h1 : styles.h3]}>
          {renderInline(heading.tokens, props, key)}
        </Text>
      )
    }
    case 'paragraph':
      return renderParagraph((token as Tokens.Paragraph).tokens, props, key)
    case 'text': {
      const text = token as Tokens.Text
      return text.tokens ? (
        renderParagraph(text.tokens, props, key)
      ) : (
        <Text key={key} style={styles.text}>
          {text.text}
        </Text>
      )
    }
    case 'list': {
      const list = token as Tokens.List
      return (
        <View key={key} style={styles.list}>
          {list.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>
                {item.task
                  ? item.checked
                    ? '☑'
                    : '☐'
                  : list.ordered
                    ? `${Number(list.start || 1) + i}.`
                    : '•'}
              </Text>
              <View style={styles.flex}>
                {item.tokens
                  .filter((child) => child.type !== 'checkbox')
                  .map((child, j) => renderBlock(child, props, `${key}.${i}.${j}`))}
              </View>
            </View>
          ))}
        </View>
      )
    }
    case 'code':
      return (
        <ScrollView key={key} horizontal style={styles.codeBlock}>
          <Text style={styles.code}>{(token as Tokens.Code).text}</Text>
        </ScrollView>
      )
    case 'blockquote':
      return (
        <View key={key} style={styles.quote}>
          {(token as Tokens.Blockquote).tokens.map((child, i) =>
            renderBlock(child, props, `${key}.${i}`)
          )}
        </View>
      )
    case 'table': {
      const table = token as Tokens.Table
      const row = (cells: Tokens.TableCell[], header: boolean, rowKey: string) => (
        <View key={rowKey} style={styles.tableRow}>
          {cells.map((cell, i) => (
            <Text key={i} style={[styles.text, styles.tableCell, header && styles.bold]}>
              {renderInline(cell.tokens, props, `${rowKey}.${i}`)}
            </Text>
          ))}
        </View>
      )
      return (
        <ScrollView key={key} horizontal>
          <View style={styles.table}>
            {row(table.header, true, `${key}.h`)}
            {table.rows.map((cells, i) => row(cells, false, `${key}.${i}`))}
          </View>
        </ScrollView>
      )
    }
    case 'hr':
      return <View key={key} style={styles.hr} />
    case 'space':
      return null
    default:
      // html and anything unknown: shown as the text it is.
      return (
        <Text key={key} style={styles.text}>
          {token.raw.trim()}
        </Text>
      )
  }
}

// Images can't sit inside <Text>, so a paragraph is split into text runs and
// image blocks.
function renderParagraph(tokens: Token[], props: Props, key: string) {
  const parts: React.ReactNode[] = []
  let run: Token[] = []
  const flush = () => {
    if (!run.length) return
    parts.push(
      <Text key={`${key}.t${parts.length}`} style={styles.text}>
        {renderInline(run, props, `${key}.${parts.length}`)}
      </Text>
    )
    run = []
  }
  for (const token of tokens) {
    if (token.type === 'image' && (token as Tokens.Image).href.startsWith('image:')) {
      flush()
      parts.push(
        <MdImage key={`${key}.i${parts.length}`} token={token as Tokens.Image} props={props} />
      )
    } else run.push(token)
  }
  flush()
  return parts.length === 1 ? parts[0] : <View key={key}>{parts}</View>
}

function MdImage({ token, props }: { token: Tokens.Image; props: Props }) {
  const ref = props.images?.find((image) => imageKey(image) === token.href.slice(6))
  const cached = ref ? props.cache?.[imageKey(ref)] : undefined
  useEffect(() => {
    if (ref && !cached) props.onRequestImage?.(ref)
  }, [ref, cached])
  if (!ref || cached?.error) {
    return <Text style={styles.missing}>{token.text || 'Image'} (image unavailable)</Text>
  }
  const ratio = ref.width && ref.height ? ref.width / ref.height : 4 / 3
  return (
    <Pressable
      onPress={() => cached?.uri && props.onOpenImage?.(cached.uri)}
      accessibilityRole='imagebutton'
      accessibilityLabel={token.text || 'Image'}
      style={[styles.image, { aspectRatio: ratio }]}
    >
      {cached?.uri ? <Image source={{ uri: cached.uri }} style={styles.fill} /> : null}
    </Pressable>
  )
}

function renderInline(tokens: Token[] | undefined, props: Props, key: string): React.ReactNode[] {
  return (tokens || []).map((token, i) => {
    const k = `${key}.${i}`
    switch (token.type) {
      case 'strong':
        return (
          <Text key={k} style={styles.bold}>
            {renderInline((token as Tokens.Strong).tokens, props, k)}
          </Text>
        )
      case 'em':
        return (
          <Text key={k} style={styles.italic}>
            {renderInline((token as Tokens.Em).tokens, props, k)}
          </Text>
        )
      case 'del':
        return (
          <Text key={k} style={styles.strike}>
            {renderInline((token as Tokens.Del).tokens, props, k)}
          </Text>
        )
      case 'codespan':
        return (
          <Text key={k} style={styles.codespan}>
            {(token as Tokens.Codespan).text}
          </Text>
        )
      case 'link': {
        const link = token as Tokens.Link
        return (
          <Text key={k} style={styles.link} onPress={() => openLink(link.href)}>
            {renderInline(link.tokens, props, k)}
          </Text>
        )
      }
      case 'br':
        return '\n'
      case 'image':
        // Remote images never load; the alt text stands in.
        return (token as Tokens.Image).text
      case 'text': {
        const text = token as Tokens.Text
        return text.tokens ? (
          <Text key={k}>{renderInline(text.tokens, props, k)}</Text>
        ) : (
          withMentions(text.text, props, k)
        )
      }
      default:
        return token.raw
    }
  })
}

// `@Name` of a mentioned member becomes a highlighted run.
function withMentions(text: string, props: Props, key: string): React.ReactNode {
  const mentions = props.mentions || []
  if (!mentions.length) return text
  const names = [...mentions].sort((a, b) => b.name.length - a.name.length)
  const pattern = new RegExp(
    `@(${names.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w])`,
    'g'
  )
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(last, match.index))
    const mention = names.find((m) => m.name === match[1])
    parts.push(
      <Text
        key={`${key}.m${match.index}`}
        style={mention?.identity === props.self ? styles.mentionMe : styles.mention}
      >
        {match[0]}
      </Text>
    )
    last = (match.index || 0) + match[0].length
  }
  parts.push(text.slice(last))
  return <Text key={key}>{parts}</Text>
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  flex: { flex: 1 },
  fill: { width: '100%', height: '100%' },
  text: { color: colors.text, lineHeight: 21, fontSize: 15 },
  h1: { fontSize: 19, fontWeight: '700' },
  h3: { fontSize: 16, fontWeight: '700' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { color: colors.info, textDecorationLine: 'underline' },
  codespan: {
    fontFamily: mono,
    fontSize: 13,
    backgroundColor: colors.bg,
    color: colors.text
  },
  codeBlock: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10
  },
  code: { fontFamily: mono, fontSize: 12.5, color: colors.text, lineHeight: 18 },
  list: { gap: 4 },
  listItem: { flexDirection: 'row', gap: 8 },
  bullet: { color: colors.muted, width: 18, lineHeight: 21 },
  quote: { borderLeftColor: colors.border, borderLeftWidth: 3, paddingLeft: 10, gap: 6 },
  table: { borderColor: colors.border, borderWidth: 1, borderRadius: 6 },
  tableRow: { flexDirection: 'row', borderBottomColor: colors.border, borderBottomWidth: 1 },
  tableCell: { minWidth: 70, maxWidth: 220, padding: 6 },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  image: {
    width: '100%',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised
  },
  missing: { color: colors.muted, fontSize: 13 },
  mention: { color: colors.info, fontWeight: '600' },
  mentionMe: { color: colors.accent, fontWeight: '700' }
})
