import crypto from 'crypto'
import type { AppContext, AppRefreshResult } from '../types'
import {
  ACCEPT_MEDIA, extensionFor, filterItems, kindOf, orderItems,
  type FolderPayload, type MediaItem, type Order, type RawItem, type SkippedItem,
} from './core'
import { folderSettings } from './page'

// Turning a listing into local files, one bounded batch at a time.

/** How many new files one refresh will copy before returning.
 *
 *  refresh() writes its cache once, at the end, so a first sync of a hundred
 *  files would leave the screen empty for as long as the whole download takes.
 *  Copying a few each pass and asking to be called back soon puts something on
 *  the wall within a minute, and fills the rest in behind it. */
const BATCH = 12
/** While a backlog remains, come back quickly rather than at the operator's
 *  chosen interval — which may be four hours. */
const FILLING_TTL = 30

/** Stable, unguessable, and content-addressed.
 *
 *  Unguessable because /app-media is served to the whole LAN without a
 *  password, so a name derived only from a public file id would let anyone on
 *  the network enumerate the folder. Content-addressed because a replaced file
 *  must land on a new name — express.static caches, and reusing the name would
 *  leave screens showing the old picture. */
function localName(instanceId: string, item: RawItem): string {
  const salt = crypto.createHash('sha256').update(`folder:${instanceId}`).digest('hex').slice(0, 12)
  const body = crypto.createHash('sha256').update(`${item.id}:${item.version}`).digest('hex').slice(0, 20)
  return salt + body + extensionFor(item.mimeType, item.name)
}

export interface SyncOptions {
  /** Lists the folder. The only provider-specific part of this file. */
  list: () => Promise<RawItem[]>
  /** Sent when fetching the bytes — Drive needs none, Graph needs none either,
   *  but a provider that does can supply them. */
  headers?: Record<string, string>
}

/** One pass: list, filter, order, cap, then copy what is missing. */
export async function syncFolder(ctx: AppContext, o: SyncOptions): Promise<AppRefreshResult> {
  const s = folderSettings(ctx.instance.config)
  const raw = await o.list()

  const { keep, skipped } = filterItems(raw, {
    includeVideo: s.includeVideo,
    maxBytes: s.maxBytes,
  })

  // Seeded from the sync time so a shuffle is the same on every screen showing
  // this instance, and different on the next sync.
  const seed = Math.floor(Date.now() / 1000)
  const ordered = orderItems(keep, s.order as Order, seed)

  const capped = ordered.slice(0, s.maxItems)
  if (ordered.length > s.maxItems) {
    skipped.push({
      name: `${ordered.length - s.maxItems} more files`,
      reason: `Only the first ${s.maxItems} are used.`,
    })
  }

  const previous = (ctx.data as FolderPayload | null)?.items ?? []
  const known = new Map(previous.map(i => [i.src, i]))

  const items: MediaItem[] = []
  const failed: SkippedItem[] = []
  let copied = 0
  let filling = false

  for (const it of capped) {
    const name = localName(ctx.instance.id, it)
    const src = `/app-media/${name}`

    // Already have this exact content: nothing to fetch.
    if (known.has(src)) { items.push(known.get(src)!); continue }

    if (copied >= BATCH) { filling = true; continue }
    copied++

    const path = await ctx.mirrorFile(it.downloadUrl, {
      name,
      maxBytes: s.maxBytes,
      accept: ACCEPT_MEDIA,
      headers: o.headers,
    })
    if (!path) {
      failed.push({ name: it.name, reason: 'Could not be copied from the folder.' })
      continue
    }
    items.push({
      kind: kindOf(it.mimeType),
      src: path,
      name: it.name,
      seconds: kindOf(it.mimeType) === 'video' ? 0 : s.imageSeconds,
    })
  }

  const payload: FolderPayload = {
    items,
    skipped: skipped.concat(failed),
    filling,
    syncedAt: new Date().toISOString(),
  }

  return {
    data: payload,
    ttlSeconds: filling ? FILLING_TTL : s.refreshMinutes * 60,
  }
}

/** The page wants absolute paths for nothing and relative for everything, so
 *  this only trims. Kept here so both providers serialise identically. */
export function serializeFolder(ctx: AppContext) {
  const d = ctx.data as FolderPayload | null
  if (!d) return null
  return { items: d.items, syncedAt: d.syncedAt }
}
