import type { AppDefinition } from './types'
import { instagram } from './instagram'

// Every app the manager can create instances of. Adding one is a single import
// plus an entry here — the config form, validation, storage, caching, playlist
// plumbing and player page are all generic and come for free.
export const APPS: AppDefinition[] = [
  instagram,
]

const BY_ID = new Map(APPS.map(a => [a.id, a]))

export function getApp(id: string): AppDefinition | undefined {
  return BY_ID.get(id)
}
