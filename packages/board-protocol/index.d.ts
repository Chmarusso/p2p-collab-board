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
  profiles: Record<string, string>
  maxTs: number
}
export declare function isPosition(value: unknown): boolean
export declare function positionBetween(a?: string | null, b?: string | null): string
export declare function positionAt(items: Array<{ position: string }>, index?: number): string
