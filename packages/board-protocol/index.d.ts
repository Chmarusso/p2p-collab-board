export declare const messageTypes: Readonly<Record<string, string>>
export declare const BLIND_PEERS: ReadonlyArray<string>
export declare function command<T extends string, F extends object>(
  type: T,
  fields?: F
): { type: T } & F
export declare function normalizeInvite(value: unknown): string
export declare function inviteLink(invite: string): string

export type BoardColumn = {
  id: string
  name: string
  position: string
  color: string | null
  wipLimit: number | null
}
export type Reactions = Record<string, string[]>
export type ChecklistItem = { id: string; text: string; done: boolean; position: string }
export type CardLink = { cardId: string; kind: 'blocks' | 'relates' }
export type RuleTrigger =
  | { kind: 'enter'; columnId: string }
  | { kind: 'create'; columnId: string | null }
  | { kind: 'schedule'; every: 'day' | 'week' | 'month'; columnId: string | null }
export type BoardRule = {
  id: string
  name: string
  enabled: boolean
  trigger: RuleTrigger
  actions: {
    labelIds: string[]
    assignees: string[]
    assignActor: boolean
    dueInDays: number | null
    completeChecklist: boolean
    archive: boolean
  }
  card?: { title: string; body: string; checklist: string[] }
}
export type BoardCard = {
  id: string
  title: string
  body: string
  author: string
  createdAt: string
  images: MediaRef[]
  mentions: string[]
  dueDate: string | null
  labelIds: string[]
  columnId: string
  position: string
  archived: boolean
  assignees: string[]
  points: number | null
  revealEstimates: boolean
  template: boolean
  checklist: ChecklistItem[]
  links: CardLink[]
  blockedBy: string[]
  estimates: Record<string, number>
  reactions: Reactions
  updatedAt: number
  votes: Record<string, number>
  comments: Array<{
    id: string
    author: string
    text: string
    createdAt: string
    mentions: string[]
    reactions: Reactions
  }>
  [key: string]: any
}
export type BoardLabel = { id: string; name: string; color: string | null }
export type MediaRef = {
  core: string
  id: { byteOffset: number; blockOffset: number; blockLength: number; byteLength: number }
  type: string
  width: number | null
  height: number | null
  name?: string | null
}
export type BoardTheme = {
  background: string | null
  accent: string | null
  template: string | null
  backgroundImage: MediaRef | null
}
export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemePalette = {
  bg: string
  surface: string
  surfaceRaised: string
  border: string
  text: string
  muted: string
  accent: string
  accentInk: string
  info: string
  magenta: string
  error: string
  danger: string
  warn: string
  success: string
}
export type ThemeTemplate = { id: string; name: string; dark: ThemePalette; light: ThemePalette }
export declare const DEFAULT_TEMPLATE: string
export declare const THEME_TEMPLATES: readonly ThemeTemplate[]
export declare const THEME_MODES: readonly ThemeMode[]
export declare function isTemplateId(value: unknown): value is string
export declare function themeTemplate(id: string | null | undefined): ThemeTemplate
export type BoardInfo = { description: string; icon: MediaRef | null }
export type MemberRole = 'owner' | 'admin' | 'member'
export type BoardMember = {
  identity: string
  name: string | null
  avatar: MediaRef | null
  role: MemberRole
  banned: boolean
  bannedBy: string | null
}

export declare const DEFAULT_COLUMNS: ReadonlyArray<Omit<BoardColumn, 'color'>>
export declare const DEFAULT_COLUMN: string
export declare const LIMITS: Readonly<Record<string, number>>
export declare const ROLES: ReadonlyArray<'admin' | 'member'>
export declare const OP_TYPES: ReadonlyArray<string>
export declare const REACTIONS: ReadonlyArray<string>
export declare const LINK_KINDS: ReadonlyArray<'blocks' | 'relates'>
export declare const RULE_EVERY: ReadonlyArray<'day' | 'week' | 'month'>
export declare function cleanRule(value: unknown): Omit<BoardRule, 'id'> | null
export declare function deriveBoard(
  messages: Array<{ identity: string; payload: { type: string; [key: string]: any } }>,
  options?: { images?: (list: unknown) => unknown[]; owner?: string | null }
): {
  objects: BoardCard[]
  columns: BoardColumn[]
  labels: BoardLabel[]
  theme: BoardTheme
  info: BoardInfo
  rules: BoardRule[]
  profiles: Record<string, string>
  owner: string | null
  members: BoardMember[]
  maxTs: number
}
export type BoardAlert = {
  id: string
  kind:
    | 'mention'
    | 'assigned'
    | 'comment'
    | 'moved'
    | 'edited'
    | 'new-card'
    | 'due-soon'
    | 'overdue'
  cardId: string
  cardTitle: string
  author: string | null
  authorName: string | null
  at: number
  where?: 'description' | 'comment'
  text?: string
  column?: string | null
  due?: string
}
export declare function boardAlerts(
  messages: Array<{ id: string; identity: string; payload: Record<string, any> }>,
  state: ReturnType<typeof deriveBoard>,
  me: string,
  options?: { now?: number; since?: number }
): BoardAlert[]
export declare function isPosition(value: unknown): boolean
export declare function positionBetween(a?: string | null, b?: string | null): string
export declare function positionAt(items: Array<{ position: string }>, index?: number): string

export type ActivityEntry = {
  id: string
  kind:
    | 'created'
    | 'moved'
    | 'archived'
    | 'restored'
    | 'commented'
    | 'edited'
    | 'checklist'
    | 'linked'
    | 'attached'
    | 'estimated'
  detail: string
  cardId: string
  cardTitle: string
  author: string
  authorName: string | null
  at: number
}
export declare function boardActivity(
  messages: Array<{ id: string; identity: string; payload: Record<string, any> }>,
  state: ReturnType<typeof deriveBoard>,
  options?: { cardId?: string | null; limit?: number }
): ActivityEntry[]
export type BoardStats = {
  doneColumnId: string | null
  weeks: Array<{ start: number; done: number; created: number; points: number }>
  cycleTime: { median: number | null; p85: number | null; count: number }
  columns: Array<{
    id: string
    name: string
    count: number
    points: number
    wipLimit: number | null
  }>
  members: Array<{ identity: string; name: string | null; open: number; doneThisWeek: number }>
  totals: {
    open: number
    done: number
    archived: number
    overdue: number
    blocked: number
    pointsOpen: number
    pointsDone: number
  }
}
export declare function boardStats(
  messages: Array<{ id: string; identity: string; payload: Record<string, any> }>,
  state: ReturnType<typeof deriveBoard>,
  options?: { now?: number; weeks?: number }
): BoardStats
export type MyCard = {
  id: string
  title: string
  dueDate: string | null
  columnId: string
  columnName: string
  blocked: boolean
  checklist: { done: number; total: number }
}
export declare function myCards(state: ReturnType<typeof deriveBoard>, me: string): MyCard[]
export type PresenceEntry = {
  identity: string
  name: string | null
  cardId: string | null
  typing: boolean
  at: number
}
