// Everything shared to OpenCollab from other apps, kept on this device per
// identity so it can be looked at again and added to a board later. Each item
// is its own secure-store entry (they stay small); an index keeps the order.
import * as SecureStore from 'expo-secure-store'

export type SharedRecord = {
  id: string
  at: number
  title: string
  body: string
  link?: string
  titleFromLink?: boolean
  // From the page's preview tags, once fetched. `image` is the page's image
  // address: the list loads it from the site, it isn't copied to the device.
  description?: string
  image?: string
  site?: string
  previewed?: boolean
  // Set when a card was added from it.
  board?: string
  addedAt?: number
}

const MAX_RECORDS = 100
const indexKey = (identity: string) => `opencollab.shared.${identity}`
const recordKey = (identity: string, id: string) => `opencollab.shared.${identity}.${id}`

export const newSharedId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export async function loadShared(identity: string): Promise<SharedRecord[]> {
  let ids: string[] = []
  try {
    ids = JSON.parse((await SecureStore.getItemAsync(indexKey(identity))) || '[]')
  } catch {}
  const records = await Promise.all(
    ids.map(async (id) => {
      try {
        return JSON.parse((await SecureStore.getItemAsync(recordKey(identity, id))) || 'null')
      } catch {
        return null
      }
    })
  )
  return records.filter(Boolean)
}

// Puts `record` first (or updates it in place) and returns the new list.
export function upsertShared(
  identity: string,
  list: SharedRecord[],
  record: SharedRecord
): SharedRecord[] {
  const present = list.some((item) => item.id === record.id)
  const next = present
    ? list.map((item) => (item.id === record.id ? record : item))
    : [record, ...list]
  const kept = next.slice(0, MAX_RECORDS)
  const stored = {
    ...record,
    body: record.body.slice(0, 1000),
    description: record.description?.slice(0, 500)
  }
  void SecureStore.setItemAsync(recordKey(identity, record.id), JSON.stringify(stored))
  for (const dropped of next.slice(MAX_RECORDS)) {
    void SecureStore.deleteItemAsync(recordKey(identity, dropped.id))
  }
  if (!present) writeIndex(identity, kept)
  return kept
}

export function removeShared(identity: string, list: SharedRecord[], id: string) {
  const next = list.filter((item) => item.id !== id)
  void SecureStore.deleteItemAsync(recordKey(identity, id))
  writeIndex(identity, next)
  return next
}

function writeIndex(identity: string, list: SharedRecord[]) {
  void SecureStore.setItemAsync(indexKey(identity), JSON.stringify(list.map((item) => item.id)))
}
