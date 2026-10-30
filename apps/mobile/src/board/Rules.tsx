// Automation: rules that act on cards when they enter a column, are created,
// or on a schedule; and the board templates that set up columns and labels.
// The member whose device first sees the trigger runs the rule.
import React, { useState } from 'react'
import { Alert, Pressable, Switch, Text, TextInput, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { messageTypes } from '@opencollab/board-protocol'
import { Button, colors, mono, themed } from '../ui'
import { plural, t } from '../i18n'
import { Chip } from './CardSheet'
import { Sheet } from './Panels'
import { BoardData, BoardRule, RuleActions, RuleTrigger, assignable } from './model'

type Send = (message: object) => void
type Draft = Omit<BoardRule, 'id'> & { id: string | null }

const EVERY: Array<{ id: 'day' | 'week' | 'month'; label: () => string }> = [
  { id: 'day', label: () => t('Every day') },
  { id: 'week', label: () => t('Every week') },
  { id: 'month', label: () => t('Every month') }
]

const blankActions = (): RuleActions => ({
  labelIds: [],
  assignees: [],
  assignActor: false,
  dueInDays: null,
  completeChecklist: false,
  archive: false
})

function describeTrigger(trigger: RuleTrigger, data: BoardData) {
  const column = (id: string | null) =>
    data.columns.find((entry) => entry.id === id)?.name || t('a deleted column')
  if (trigger.kind === 'enter') {
    return t('When a card enters {column}', { column: column(trigger.columnId) })
  }
  if (trigger.kind === 'create') {
    return trigger.columnId
      ? t('When a card is added to {column}', { column: column(trigger.columnId) })
      : t('When a card is added')
  }
  const every = EVERY.find((entry) => entry.id === trigger.every)?.label() || trigger.every
  return trigger.columnId
    ? t('{every}, add a card to {column}', { every, column: column(trigger.columnId) })
    : t('{every}, add a card', { every })
}

function describeActions(actions: RuleActions, data: BoardData, nameFor: (id: string) => string) {
  const parts: string[] = []
  const labels = actions.labelIds
    .map((id) => data.labels.find((label) => label.id === id)?.name)
    .filter(Boolean)
  if (labels.length) parts.push(t('label {labels}', { labels: labels.join(', ') }))
  if (actions.assignees.length) {
    parts.push(t('assign {people}', { people: actions.assignees.map(nameFor).join(', ') }))
  }
  if (actions.assignActor) parts.push(t('assign whoever moved it'))
  if (actions.dueInDays !== null) {
    parts.push(
      actions.dueInDays
        ? plural(
            actions.dueInDays,
            ['due in {n} day', 'due in {n} days'],
            ['termin za {n} dzień', 'termin za {n} dni', 'termin za {n} dni']
          )
        : t('due today')
    )
  }
  if (actions.completeChecklist) parts.push(t('tick the checklist'))
  if (actions.archive) parts.push(t('archive it'))
  return parts.length ? parts.join(' · ') : t('no actions')
}

export function RulesSheet({
  data,
  me,
  send,
  nameFor,
  onClose
}: {
  data: BoardData
  me: string
  send: Send
  nameFor: (identity: string) => string
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const rules = data.rules || []
  const save = (rule: Draft) => {
    const { id, ...body } = rule
    send({ type: messageTypes.ruleUpsert, ...(id && { ruleId: id }), rule: body })
    setDraft(null)
  }
  if (draft) {
    return (
      <RuleForm
        draft={draft}
        data={data}
        me={me}
        nameFor={nameFor}
        onSave={save}
        onCancel={() => setDraft(null)}
      />
    )
  }
  return (
    <Sheet title={t('Automation')} onClose={onClose}>
      <Text style={styles.muted}>
        {t(
          'Rules act on cards for everyone on the board. Whoever is online when a rule is due runs it.'
        )}
      </Text>
      {rules.length ? null : (
        <View style={styles.empty}>
          <Feather name='zap' size={22} color={colors.muted} />
          <Text style={styles.muted}>{t('No rules yet.')}</Text>
        </View>
      )}
      {rules.map((rule) => (
        <View key={rule.id} style={styles.rule}>
          <Pressable
            style={[styles.ruleMain, !rule.enabled && styles.ruleOff]}
            onPress={() => setDraft({ ...rule, actions: { ...rule.actions } })}
            accessibilityRole='button'
            accessibilityLabel={t('Edit rule {rule}', {
              rule: rule.name || describeTrigger(rule.trigger, data)
            })}
          >
            {rule.name ? (
              <Text style={styles.ruleName} numberOfLines={2}>
                {rule.name}
              </Text>
            ) : null}
            <Text style={styles.ruleText}>{describeTrigger(rule.trigger, data)}</Text>
            <Text style={styles.ruleMeta} numberOfLines={3}>
              {rule.trigger.kind === 'schedule' && rule.card ? `“${rule.card.title}” · ` : ''}
              {describeActions(rule.actions, data, nameFor)}
            </Text>
          </Pressable>
          <View style={styles.ruleSide}>
            <Switch
              value={rule.enabled}
              onValueChange={(enabled) => save({ ...rule, enabled })}
              trackColor={{ true: colors.accent, false: colors.border }}
              accessibilityLabel={rule.enabled ? t('Disable rule') : t('Enable rule')}
            />
            <Pressable
              onPress={() =>
                Alert.alert(t('Delete this rule?'), t('It stops for everyone on the board.'), [
                  { text: t('Cancel'), style: 'cancel' },
                  {
                    text: t('Delete'),
                    style: 'destructive',
                    onPress: () => send({ type: messageTypes.ruleDelete, ruleId: rule.id })
                  }
                ])
              }
              style={styles.iconHit}
              accessibilityRole='button'
              accessibilityLabel={t('Delete rule')}
            >
              <Feather name='trash-2' size={16} color={colors.muted} />
            </Pressable>
          </View>
        </View>
      ))}
      <Button
        title={t('New rule')}
        icon='plus'
        onPress={() =>
          setDraft({
            id: null,
            name: '',
            enabled: true,
            trigger: { kind: 'enter', columnId: data.columns[data.columns.length - 1]?.id || '' },
            actions: blankActions()
          })
        }
      />
    </Sheet>
  )
}

function RuleForm({
  draft: initial,
  data,
  me,
  nameFor,
  onSave,
  onCancel
}: {
  draft: Draft
  data: BoardData
  me: string
  nameFor: (identity: string) => string
  onSave: (rule: Draft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Draft>(initial)
  const [due, setDue] = useState(
    initial.actions.dueInDays === null ? '' : String(initial.actions.dueInDays)
  )
  const [checklist, setChecklist] = useState((initial.card?.checklist || []).join('\n'))
  const [error, setError] = useState('')
  const { trigger, actions } = draft
  const columnId = trigger.columnId
  const setTrigger = (next: RuleTrigger) => setDraft({ ...draft, trigger: next })
  const setActions = (change: Partial<RuleActions>) =>
    setDraft({ ...draft, actions: { ...actions, ...change } })
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]
  const card = draft.card || { title: '', body: '', checklist: [] }

  const submit = () => {
    const days = due.trim() === '' ? null : Number(due)
    if (days !== null && !(Number.isInteger(days) && days >= 0 && days <= 365)) {
      return setError(t('Due in days must be a whole number from 0 to 365.'))
    }
    if (trigger.kind === 'enter' && !trigger.columnId) return setError(t('Pick a column.'))
    if (trigger.kind === 'schedule' && !card.title.trim()) {
      return setError(t('A scheduled rule needs a card title.'))
    }
    onSave({
      ...draft,
      name: draft.name.trim(),
      actions: { ...actions, dueInDays: days },
      ...(trigger.kind === 'schedule'
        ? {
            card: {
              title: card.title.trim(),
              body: card.body,
              checklist: checklist
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
            }
          }
        : { card: undefined })
    })
  }

  return (
    <Sheet title={initial.id ? t('Edit rule') : t('New rule')} onClose={onCancel}>
      <Text style={styles.sectionLabel}>{t('Name (optional)')}</Text>
      <TextInput
        style={styles.input}
        value={draft.name}
        onChangeText={(name) => setDraft({ ...draft, name })}
        placeholder={t('e.g. Done cards get archived')}
        placeholderTextColor={colors.muted}
        maxLength={80}
      />

      <Text style={styles.sectionLabel}>{t('When')}</Text>
      <View style={styles.chips}>
        <Chip
          label={t('Card enters a column')}
          selected={trigger.kind === 'enter'}
          onPress={() =>
            setTrigger({ kind: 'enter', columnId: columnId || data.columns[0]?.id || '' })
          }
        />
        <Chip
          label={t('Card is added')}
          selected={trigger.kind === 'create'}
          onPress={() => setTrigger({ kind: 'create', columnId: columnId || null })}
        />
        <Chip
          label={t('On a schedule')}
          selected={trigger.kind === 'schedule'}
          onPress={() =>
            setTrigger({ kind: 'schedule', every: 'week', columnId: columnId || null })
          }
        />
      </View>
      {trigger.kind === 'schedule' ? (
        <View style={styles.chips}>
          {EVERY.map((entry) => (
            <Chip
              key={entry.id}
              label={entry.label()}
              selected={trigger.every === entry.id}
              onPress={() => setTrigger({ ...trigger, every: entry.id })}
            />
          ))}
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>
        {trigger.kind === 'enter'
          ? t('Column')
          : trigger.kind === 'create'
            ? t('In column')
            : t('Add to')}
      </Text>
      <View style={styles.chips}>
        {trigger.kind !== 'enter' ? (
          <Chip
            label={trigger.kind === 'create' ? t('Any column') : t('First column')}
            selected={!columnId}
            onPress={() => setTrigger({ ...trigger, columnId: null })}
          />
        ) : null}
        {data.columns.map((column) => (
          <Chip
            key={column.id}
            label={column.name}
            color={column.color}
            selected={columnId === column.id}
            filled={!!column.color && columnId === column.id}
            onPress={() => setTrigger({ ...trigger, columnId: column.id } as RuleTrigger)}
          />
        ))}
      </View>

      {trigger.kind === 'schedule' ? (
        <>
          <Text style={styles.sectionLabel}>{t('Card to add')}</Text>
          <TextInput
            style={styles.input}
            value={card.title}
            onChangeText={(title) => setDraft({ ...draft, card: { ...card, title } })}
            placeholder={t('Card title, e.g. Weekly review')}
            placeholderTextColor={colors.muted}
            maxLength={200}
          />
          <TextInput
            style={[styles.input, styles.multiline]}
            value={card.body}
            onChangeText={(body) => setDraft({ ...draft, card: { ...card, body } })}
            placeholder={t('Description (optional)')}
            placeholderTextColor={colors.muted}
            multiline
          />
          <TextInput
            style={[styles.input, styles.multiline]}
            value={checklist}
            onChangeText={setChecklist}
            placeholder={t('Checklist, one item per line (optional)')}
            placeholderTextColor={colors.muted}
            multiline
          />
        </>
      ) : null}

      <Text style={styles.sectionLabel}>{t('Then')}</Text>
      {data.labels.length ? (
        <>
          <Text style={styles.hint}>{t('Add labels')}</Text>
          <View style={styles.chips}>
            {data.labels.map((label) => {
              const on = actions.labelIds.includes(label.id)
              return (
                <Chip
                  key={label.id}
                  label={label.name || t('Unnamed')}
                  color={label.color || '#8590a2'}
                  filled={on}
                  selected={on}
                  onPress={() => setActions({ labelIds: toggle(actions.labelIds, label.id) })}
                />
              )
            })}
          </View>
        </>
      ) : null}
      <Text style={styles.hint}>{t('Assign')}</Text>
      <View style={styles.chips}>
        {trigger.kind !== 'schedule' ? (
          <Chip
            label={t('Whoever did it')}
            selected={actions.assignActor}
            onPress={() => setActions({ assignActor: !actions.assignActor })}
          />
        ) : null}
        {assignable(data, me).map((member) => (
          <Chip
            key={member.identity}
            label={member.name || nameFor(member.identity)}
            selected={actions.assignees.includes(member.identity)}
            onPress={() => setActions({ assignees: toggle(actions.assignees, member.identity) })}
          />
        ))}
      </View>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleText}>{t('Due in days')}</Text>
        <TextInput
          style={[styles.input, styles.days]}
          value={due}
          onChangeText={setDue}
          placeholder='–'
          placeholderTextColor={colors.muted}
          keyboardType='number-pad'
          maxLength={3}
          accessibilityLabel={t('Set the due date this many days ahead; empty leaves it')}
        />
      </View>
      <ToggleRow
        label={t('Tick every checklist item')}
        value={actions.completeChecklist}
        onChange={(completeChecklist) => setActions({ completeChecklist })}
      />
      <ToggleRow
        label={t('Archive the card')}
        value={actions.archive}
        onChange={(archive) => setActions({ archive })}
      />
      <ToggleRow
        label={t('Rule is on')}
        value={draft.enabled}
        onChange={(enabled) => setDraft({ ...draft, enabled })}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.chips}>
        <Button title={initial.id ? t('Save rule') : t('Create rule')} grow onPress={submit} />
        <Button title={t('Cancel')} variant='ghost' onPress={onCancel} />
      </View>
    </Sheet>
  )
}

function ToggleRow({
  label,
  value,
  onChange
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleText}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.border }}
        accessibilityLabel={label}
      />
    </View>
  )
}

// The columns stay English: the worker creates them with these names.
const TEMPLATES: Array<{
  id: 'sprint' | 'bugs' | 'personal'
  name: () => string
  columns: string
}> = [
  {
    id: 'sprint',
    name: () => t('Sprint'),
    columns: 'Backlog · To do · In progress · Review · Done'
  },
  {
    id: 'bugs',
    name: () => t('Bug triage'),
    columns: 'Reported · Triaged · Fixing · Verifying · Closed'
  },
  {
    id: 'personal',
    name: () => t('Personal'),
    columns: 'Inbox · Today · This week · Waiting · Done'
  }
]

export function BoardTemplatesSheet({ send, onClose }: { send: Send; onClose: () => void }) {
  return (
    <Sheet title={t('Start from a template')} onClose={onClose}>
      <Text style={styles.muted}>
        {t(
          "Renames the board's columns in order, adds the missing ones, removes empty extra columns and adds missing labels. Cards stay where they are."
        )}
      </Text>
      {TEMPLATES.map((template) => (
        <Pressable
          key={template.id}
          style={({ pressed }) => [styles.rule, pressed && styles.pressed]}
          onPress={() =>
            Alert.alert(
              t('Use the {name} template?', { name: template.name() }),
              t('Columns are renamed for everyone on the board.'),
              [
                { text: t('Cancel'), style: 'cancel' },
                {
                  text: t('Apply'),
                  onPress: () => {
                    send({ type: messageTypes.templateApply, template: template.id })
                    onClose()
                  }
                }
              ]
            )
          }
          accessibilityRole='button'
        >
          <View style={styles.ruleMain}>
            <Text style={styles.ruleName}>{template.name()}</Text>
            <Text style={styles.ruleMeta}>{template.columns}</Text>
          </View>
          <Feather name='chevron-right' size={18} color={colors.muted} />
        </Pressable>
      ))}
    </Sheet>
  )
}

const styles = themed(() => ({
  muted: { color: colors.muted, lineHeight: 20 },
  hint: { color: colors.muted, fontSize: 12 },
  error: { color: colors.error },
  pressed: { opacity: 0.8 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 18 },
  sectionLabel: {
    color: colors.muted,
    fontFamily: mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 6
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  input: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
    minHeight: 44,
    color: colors.text
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  days: { width: 72, textAlign: 'center' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44
  },
  toggleText: { flex: 1, color: colors.text, fontSize: 15 },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised
  },
  ruleOff: { opacity: 0.6 },
  ruleMain: { flex: 1, gap: 3 },
  ruleSide: { alignItems: 'center', gap: 4 },
  ruleName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  ruleText: { color: colors.text, lineHeight: 19 },
  ruleMeta: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  iconHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }
}))
