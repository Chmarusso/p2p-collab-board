// Board chat: one conversation for everyone on the board, synced like
// comments. Long-press a message to delete it (yours, or any as an admin).
import React, { useEffect, useRef, useState } from 'react'
import { Alert, FlatList, Pressable, Text, View } from 'react-native'
import { messageTypes } from '@opencollab/board-protocol'
import { Avatar, Button, CachedImage, ImageRef, colors, mono, themed } from '../ui'
import { Markdown, Mention } from './Markdown'
import { MentionInput } from './MentionInput'
import { Sheet } from './Panels'
import { BoardData, ChatMessage, avatarOf, findMentions } from './model'

export function ChatSheet(props: {
  data: BoardData
  me: string
  send: (message: object) => void
  nameFor: (identity: string) => string
  relativeTime: (iso?: string) => string
  cache: Record<string, CachedImage>
  requestImage: (ref: ImageRef) => void
  onClose: () => void
}) {
  const { data, me, send } = props
  const chat = data.chat || []
  const [text, setText] = useState('')
  const list = useRef<FlatList<ChatMessage>>(null)
  const mentions: Mention[] = Object.entries(data.profiles).map(([identity, name]) => ({
    identity,
    name
  }))
  const role = data.members.find((member) => member.identity === me)?.role
  const canDelete = (entry: ChatMessage) =>
    entry.author === me || role === 'owner' || role === 'admin'

  // New messages scroll into view.
  useEffect(() => {
    const timer = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50)
    return () => clearTimeout(timer)
  }, [chat.length])

  const submit = () => {
    const message = text.trim()
    if (!message) return
    send({
      type: messageTypes.chatSend,
      text: message,
      mentions: findMentions(message, data.profiles)
    })
    setText('')
  }
  const confirmDelete = (entry: ChatMessage) =>
    Alert.alert('Delete message?', entry.text.slice(0, 120), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => send({ type: messageTypes.chatDelete, messageId: entry.id })
      }
    ])

  return (
    <Sheet title='Chat' onClose={props.onClose} scroll={false}>
      <FlatList
        ref={list}
        style={styles.flex}
        contentContainerStyle={styles.feed}
        data={chat}
        keyExtractor={(entry) => entry.id}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No messages yet. Everyone on this board sees the chat; @name mentions someone.
          </Text>
        }
        renderItem={({ item: entry }) => (
          <Pressable
            onLongPress={canDelete(entry) ? () => confirmDelete(entry) : undefined}
            style={[styles.message, entry.mentions?.includes(me) && styles.mentionsMe]}
            accessibilityHint={canDelete(entry) ? 'Long-press to delete' : undefined}
          >
            <View style={styles.meta}>
              <Avatar
                hex={entry.author}
                size={12}
                image={avatarOf(data, entry.author)}
                cache={props.cache}
                requestImage={props.requestImage}
              />
              <Text style={styles.author}>{props.nameFor(entry.author)}</Text>
              <Text style={styles.time}>{props.relativeTime(entry.createdAt)}</Text>
            </View>
            <Markdown
              text={entry.text}
              mentions={mentions.filter((m) => entry.mentions?.includes(m.identity))}
              self={me}
            />
          </Pressable>
        )}
      />
      <View style={styles.composer}>
        <MentionInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          profiles={data.profiles}
          me={me}
          placeholder='Message the board'
          onSubmitEditing={submit}
          returnKeyType='send'
          maxLength={2000}
        />
        <Button title='Send' icon='send' onPress={submit} />
      </View>
    </Sheet>
  )
}

const styles = themed(() => ({
  flex: { flex: 1 },
  feed: { paddingHorizontal: 20, paddingBottom: 16, gap: 14 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 32 },
  message: { gap: 4 },
  mentionsMe: { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 9 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { color: colors.text, fontWeight: '700', fontSize: 13 },
  time: { color: colors.muted, fontFamily: mono, fontSize: 11 },
  composer: {
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 44,
    color: colors.text
  }
}))
