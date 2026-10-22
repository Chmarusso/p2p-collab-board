export declare const messageTypes: Readonly<Record<string, string>>
export declare function command<T extends string, F extends object>(
  type: T,
  fields?: F
): { type: T } & F
export declare function normalizeInvite(value: unknown): string
export declare function inviteLink(invite: string): string

export type BoardColumn = { id: string; name: string; position: string; color: string | null }
export type BoardLabel = { id: string; name: string; color: string | null }
export type BoardTheme = { background: string | null; accent: string | null }
export type BoardInfo = { description: string }

export declare const DEFAULT_COLUMNS: ReadonlyArray<Omit<BoardColumn, 'color'>>
export declare const DEFAULT_COLUMN: string
export declare const LIMITS: Readonly<Record<string, number>>
export declare const OP_TYPES: ReadonlyArray<string>
export declare function deriveBoard(
  messages: Array<{ identity: string; payload: { type: string; [key: string]: any } }>,
  options?: { images?: (list: unknown) => unknown[] }
): {
  objects: Array<Record<string, any>>
  columns: BoardColumn[]
  labels: BoardLabel[]
  theme: BoardTheme
  info: BoardInfo
  profiles: Record<string, string>
  maxTs: number
}
export type BoardAlert = {
  id: string
  kind: 'mention' | 'comment' | 'moved' | 'edited' | 'new-card' | 'due-soon' | 'overdue'
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
