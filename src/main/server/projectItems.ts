import type { JsonDB } from './database'
import type { ContentItem, Project } from './types'

// One playlist, flattened into the handful of fields a page needs to play it.
//
// Two features now consume this — the split-screen zone player and the Live TV
// advert overlay — and they must never disagree about what "the playlist" is.
// Ordering, the active filter and the duration precedence live here so that a
// third consumer inherits them rather than reinventing them slightly wrong.

export interface PlayItem {
  type: ContentItem['type']
  /** Manager-relative media path, or '' for items that are not a file. */
  src: string
  /** Page to iframe: manager-relative for our own, absolute for an html item. */
  url: string
  text: string
  seconds: number
}

/** Only the two schemes that make sense in an iframe. `htmlUrl` is stored
 *  unvalidated, and a `javascript:` src in an iframe runs in the embedding
 *  page's origin — so it is filtered here, at the one place both players read
 *  through, rather than trusted at either of them. */
function safePageUrl(url: string | undefined): string {
  const s = String(url ?? '').trim()
  return /^https?:\/\//i.test(s) ? s : ''
}

/** The active items of a project, in order. `getContentByProjectId` does no
 *  sorting of its own.
 *
 *  Paths back to this manager are left relative, and that is the important
 *  part. Every page that consumes these items is served by this manager, so a
 *  relative path resolves against the address the screen has already proved it
 *  can reach. Absolutising them instead means baking in the manager's guess at
 *  its own LAN address — and a PC with a VPN, a second NIC or a Docker bridge
 *  has several. Guess wrong and the advert is a broken image over a live feed,
 *  or a blank zone, with nothing logged anywhere. Only `html` items stay
 *  absolute, because those genuinely point somewhere else. */
export function projectPlayItems(db: JsonDB, project: Project): PlayItem[] {
  return db.getContentByProjectId(project.id)
    .filter(i => i.isActive)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(i => ({
      type: i.type,
      src: i.filePath ? i.filePath : '',
      url: i.type === 'html' ? safePageUrl(i.htmlUrl)
        : i.type === 'design' ? `/tv/scene/${encodeURIComponent(String(i.designId ?? ''))}`
        : i.type === 'app' ? `/tv/app/${encodeURIComponent(String(i.appInstanceId ?? ''))}`
        : '',
      text: i.textContent ?? '',
      // The item's own duration wins; the project's is the fallback.
      seconds: i.durationSeconds || project.durationSeconds || 10,
    }))
    // An html item whose address was rejected has nothing left to show, and a
    // blank iframe for its full duration reads as a broken screen.
    .filter(i => !(i.type === 'html' && !i.url))
}
