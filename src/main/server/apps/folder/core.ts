// A cloud folder, turned into a slideshow.
//
// Google Drive and OneDrive are the same app wearing two logos: sign in or
// paste a link, point at a folder, and whatever is in it plays. Everything that
// is not "how do I list this folder" lives here, so the two providers are a
// listing adapter each and nothing more.

/** One file, as a provider reports it. */
export interface RawItem {
  id: string
  name: string
  mimeType: string
  /** Bytes. 0 when the provider does not say. */
  size: number
  /** ISO. Used for newest/oldest ordering. */
  modifiedAt: string
  /** Changes when the contents change — Drive's md5, Graph's cTag. Part of the
   *  stored file name, so replacing a file cannot leave a screen showing the
   *  old one out of the media cache. */
  version: string
  /** Where the bytes are. May be short-lived; it is fetched immediately. */
  downloadUrl: string
}

/** One file, once the manager has a local copy. */
export interface MediaItem {
  kind: 'image' | 'video'
  /** Manager-relative, e.g. /app-media/ab12….jpg */
  src: string
  name: string
  seconds: number
}

export interface SkippedItem {
  name: string
  reason: string
}

/** What the TV page is handed. */
export interface FolderPayload {
  items: MediaItem[]
  /** Shown in the manager only. A wall must never explain itself to a viewer. */
  skipped: SkippedItem[]
  /** True while the manager is still copying a backlog of files. */
  filling: boolean
  syncedAt: string
}

export type Order = 'name' | 'nameDesc' | 'newest' | 'oldest' | 'random'

/** Formats every screen can decode. Deliberately narrow: the floor is a webOS 4
 *  panel, and a file it cannot draw is worse than a file that is not there —
 *  it holds the rotation for its full dwell showing nothing. */
const IMAGE_OK = /^image\/(jpeg|png|gif|webp|bmp)$/i
const VIDEO_OK = /^video\/(mp4|webm)$/i
/** Not a hard rule of the format, but of the panels: H.265 and 4K are where a
 *  signage TV gives up, and the container name is the only hint we get. */
const RISKY_NAME = /\.(mov|avi|mkv|wmv|flv|m4v|mpg|mpeg|3gp)$/i

export interface FilterOptions {
  includeVideo: boolean
  maxBytes: number
}

export interface Filtered {
  keep: RawItem[]
  skipped: SkippedItem[]
}

/** Splits a listing into what a screen can play and what it cannot, with a
 *  reason for each rejection that an operator could act on. */
export function filterItems(items: RawItem[], o: FilterOptions): Filtered {
  const keep: RawItem[] = []
  const skipped: SkippedItem[] = []

  for (const it of items) {
    const isImage = IMAGE_OK.test(it.mimeType)
    const isVideo = VIDEO_OK.test(it.mimeType)

    if (!isImage && !isVideo) {
      if (RISKY_NAME.test(it.name)) {
        skipped.push({ name: it.name, reason: 'Screens cannot play this kind of video. Save it as MP4.' })
      } else if (/^application\/vnd\.google-apps\./.test(it.mimeType)) {
        // A Doc or a Slide deck is not a picture; saying "not supported" would
        // read as a fault rather than a category error.
        skipped.push({ name: it.name, reason: 'Only pictures and videos can be shown.' })
      } else {
        skipped.push({ name: it.name, reason: 'Not a picture or a video.' })
      }
      continue
    }
    if (isVideo && !o.includeVideo) {
      skipped.push({ name: it.name, reason: 'Videos are switched off for this screen.' })
      continue
    }
    if (it.size && it.size > o.maxBytes) {
      const mb = Math.round(it.size / (1024 * 1024))
      skipped.push({ name: it.name, reason: `Too big (${mb} MB).` })
      continue
    }
    keep.push(it)
  }
  return { keep, skipped }
}

/** Numbers inside names sort as numbers.
 *
 *  Operators order a folder by naming files 1, 2, 3 — and a plain string sort
 *  puts 10 straight after 1, which looks like the app ignoring them. */
export function compareNatural(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g
  const ax = String(a).toLowerCase().match(re) ?? []
  const bx = String(b).toLowerCase().match(re) ?? []
  for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
    const an = /^\d/.test(ax[i]), bn = /^\d/.test(bx[i])
    if (an && bn) {
      const d = Number(ax[i]) - Number(bx[i])
      if (d) return d
    } else if (ax[i] !== bx[i]) {
      return ax[i] < bx[i] ? -1 : 1
    }
  }
  return ax.length - bx.length
}

/** Ordered in the manager, never on the screen, so a wall of six panels showing
 *  one folder shows the same picture at the same moment. `seed` makes a shuffle
 *  reproducible for one sync rather than different on every screen. */
export function orderItems(items: RawItem[], order: Order, seed: number): RawItem[] {
  const out = items.slice()
  if (order === 'name') return out.sort((a, b) => compareNatural(a.name, b.name))
  if (order === 'nameDesc') return out.sort((a, b) => compareNatural(b.name, a.name))
  if (order === 'newest') return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  if (order === 'oldest') return out.sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt))

  // Deterministic shuffle: same seed, same order, on every screen.
  let s = seed || 1
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = out[i]; out[i] = out[j]; out[j] = t
  }
  return out
}

export function kindOf(mimeType: string): 'image' | 'video' {
  return VIDEO_OK.test(mimeType) ? 'video' : 'image'
}

export function extensionFor(mimeType: string, name: string): string {
  const m = /^[a-z]+\/([a-z0-9.+-]+)$/i.exec(mimeType)
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)
  if (fromName) return `.${fromName[1].toLowerCase()}`
  if (!m) return '.bin'
  const sub = m[1].toLowerCase()
  return sub === 'jpeg' ? '.jpg' : `.${sub}`
}

export const ACCEPT_MEDIA = /^(image|video)\//i
