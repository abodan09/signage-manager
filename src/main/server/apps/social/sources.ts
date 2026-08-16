import type { AppConnection } from '../types'

// Where Instagram posts come from.
//
// Meta shut down the Basic Display API on 4 December 2024. What replaced it —
// "Instagram API with Instagram Login" — needs a Business or Creator account,
// forbids loopback redirect URIs, has no PKCE, and requires the app secret for
// the token exchange. Meta's own wording: do not "store it in a device". A
// desktop app on a customer LAN therefore *cannot* complete this flow alone,
// and no amount of cleverness changes that.
//
// So the app reads through a source, and there are three real ones:
//
//   feed    A hosted feed service (Behold and friends) that already holds the
//           Meta credentials and hands back plain JSON. Works today, needs no
//           OAuth, and rehosts the media. This is the path most operators
//           should take.
//   broker  Our own OAuth broker, which holds the app secret and the 60-day
//           token server-side. The correct long-term answer; the client half
//           lives here and starts working the day the broker is deployed.
//   token   A long-lived token the operator obtained themselves. Refreshing
//           one does NOT need the secret, so the manager can keep it alive —
//           but minting the first one still needs a reviewed Meta app.
//
// Every source normalises to the same Post, so the four views never learn
// where the data came from.

export type MediaType = 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'

export interface Post {
  id: string
  caption: string
  mediaType: MediaType
  /** Remote URL as fetched. Mirrored to a local path before it reaches a TV. */
  imageUrl: string
  permalink?: string
  timestamp: string
  username: string
  displayName: string
  avatarUrl?: string
  width?: number
  height?: number
}

export interface Profile {
  username: string
  displayName: string
  avatarUrl?: string
  followers?: number
}

export interface FeedPayload {
  profile: Profile
  posts: Post[]
}

const UA = 'SignageManager/1.0'

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init?.headers ?? {}) } })
    const body = await res.text()
    if (!res.ok) {
      // Meta and the feed services both put something useful in the body;
      // surfacing it is the difference between a fixable error and a shrug.
      let detail = ''
      try {
        const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
        detail = parsed.error?.message ?? parsed.message ?? ''
      } catch { detail = body.slice(0, 140) }
      throw new Error(detail ? `${res.status}: ${detail}` : `HTTP ${res.status}`)
    }
    return JSON.parse(body)
  } finally {
    clearTimeout(timer)
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

// ── hosted feed service ──────────────────────────────────────────────────────

/** Behold-shaped JSON: https://feeds.behold.so/<feedId>
 *  Chosen as the reference shape because it is public, keyless, documented,
 *  and already rehosts media to a stable CDN. Other services that return a
 *  posts array with the same field names drop straight in. */
export async function fetchFeedService(feedUrl: string): Promise<FeedPayload> {
  const raw = await getJson(feedUrl) as Record<string, unknown>
  const rawPosts = Array.isArray(raw.posts) ? raw.posts : Array.isArray(raw) ? raw : []

  const username = str(raw.username) || 'instagram'
  const displayName = str(raw.fullName) || str(raw.name) || username
  const avatarUrl = str(raw.profilePictureUrl) || str(raw.avatarUrl) || undefined

  const posts: Post[] = []
  for (const p of rawPosts as Array<Record<string, unknown>>) {
    const sizes = (p.sizes ?? {}) as Record<string, unknown>
    const large = (sizes.large ?? sizes.medium ?? sizes.full ?? {}) as Record<string, unknown>
    const image = str(large.mediaUrl) || str(p.mediaUrl) || str(p.thumbnailUrl) || str(p.imageUrl)
    if (!image) continue
    const type = str(p.mediaType).toUpperCase()
    posts.push({
      id: str(p.id) || image,
      caption: str(p.prunedCaption) || str(p.caption),
      mediaType: type === 'VIDEO' || type === 'CAROUSEL_ALBUM' ? type as MediaType : 'IMAGE',
      // A video's own mediaUrl is an .mp4; the thumbnail is what a wall shows.
      imageUrl: type === 'VIDEO' ? (str(p.thumbnailUrl) || image) : image,
      permalink: str(p.permalink) || undefined,
      timestamp: str(p.timestamp) || new Date().toISOString(),
      username,
      displayName,
      avatarUrl,
      width: Number(large.width) || Number(p.width) || undefined,
      height: Number(large.height) || Number(p.height) || undefined,
    })
  }

  return {
    profile: { username, displayName, avatarUrl, followers: Number(raw.followersCount) || undefined },
    posts,
  }
}

// ── Meta, via a long-lived token ─────────────────────────────────────────────

const IG_FIELDS = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username'

/** Reads the connected account's own media from graph.instagram.com. Used both
 *  by the manual-token source and, with a broker-supplied token, by the broker
 *  source when the broker chooses to delegate rather than proxy. */
export async function fetchGraph(token: string, limit: number): Promise<FeedPayload> {
  const me = await getJson(
    `https://graph.instagram.com/me?fields=id,username,account_type,media_count&access_token=${encodeURIComponent(token)}`,
  ) as Record<string, unknown>

  const media = await getJson(
    `https://graph.instagram.com/me/media?fields=${IG_FIELDS}&limit=${Math.min(100, Math.max(1, limit))}` +
    `&access_token=${encodeURIComponent(token)}`,
  ) as { data?: Array<Record<string, unknown>> }

  const username = str(me.username) || 'instagram'
  const posts: Post[] = []
  for (const m of media.data ?? []) {
    const type = str(m.media_type).toUpperCase()
    // media_url is absent when a post is flagged for copyright — skipping is
    // right; a wall with a hole in it beats a wall with a broken image in it.
    const image = type === 'VIDEO' ? str(m.thumbnail_url) : str(m.media_url)
    if (!image) continue
    posts.push({
      id: str(m.id),
      caption: str(m.caption),
      mediaType: type === 'VIDEO' || type === 'CAROUSEL_ALBUM' ? type as MediaType : 'IMAGE',
      imageUrl: image,
      permalink: str(m.permalink) || undefined,
      timestamp: str(m.timestamp) || new Date().toISOString(),
      username: str(m.username) || username,
      displayName: username,
    })
  }

  return { profile: { username, displayName: username }, posts }
}

/** Long-lived tokens last 60 days and die permanently if not refreshed inside
 *  that window — a real hazard for a manager switched off over a holiday. The
 *  refresh call is the one step that does NOT need the app secret, so the
 *  manager can and must do it itself. */
export async function refreshGraphToken(token: string): Promise<{ token: string; expiresAt: number } | null> {
  try {
    const out = await getJson(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
    ) as { access_token?: string; expires_in?: number }
    if (!out.access_token) return null
    return {
      token: out.access_token,
      expiresAt: Date.now() + (Number(out.expires_in) || 5_183_944) * 1000,
    }
  } catch {
    return null
  }
}

// ── Facebook Pages, via the Graph API ────────────────────────────────────────

const FB_VERSION = 'v21.0'
const FB_FIELDS = 'id,message,story,created_time,full_picture,permalink_url,attachments{media_type,media}'

/** Reads a Page's own posts.
 *
 *  Operationally easier than Instagram in one respect: a Page token derived
 *  from a long-lived user token does not expire, so there is no 60-day cliff
 *  to nurse. Getting that token still needs the same OAuth flow Meta only
 *  permits a confidential client to complete, which is why the broker exists. */
export async function fetchFacebookPage(pageId: string, token: string, limit: number): Promise<FeedPayload> {
  const base = `https://graph.facebook.com/${FB_VERSION}`
  const id = encodeURIComponent(pageId.trim())

  const page = await getJson(
    `${base}/${id}?fields=name,username,picture.type(large)&access_token=${encodeURIComponent(token)}`,
  ) as Record<string, unknown>

  const feed = await getJson(
    `${base}/${id}/posts?fields=${FB_FIELDS}&limit=${Math.min(100, Math.max(1, limit))}` +
    `&access_token=${encodeURIComponent(token)}`,
  ) as { data?: Array<Record<string, unknown>> }

  const displayName = str(page.name) || 'Facebook'
  const username = str(page.username) || displayName
  const pic = (page.picture as { data?: { url?: string } } | undefined)?.data?.url

  const posts: Post[] = []
  for (const p of feed.data ?? []) {
    // A post with neither a picture nor words is a like or a share with no
    // body — nothing a wall can usefully draw.
    const image = str(p.full_picture)
    const caption = str(p.message) || str(p.story)
    if (!image && !caption) continue

    const media = (p.attachments as { data?: Array<{ media_type?: string }> } | undefined)?.data?.[0]
    const kind = String(media?.media_type ?? '').toLowerCase()

    posts.push({
      id: str(p.id),
      caption,
      mediaType: kind === 'video' ? 'VIDEO' : kind === 'album' ? 'CAROUSEL_ALBUM' : 'IMAGE',
      imageUrl: image,
      permalink: str(p.permalink_url) || undefined,
      timestamp: str(p.created_time) || new Date().toISOString(),
      username,
      displayName,
      avatarUrl: pic,
    })
  }

  return {
    profile: { username, displayName, avatarUrl: pic },
    posts,
  }
}

/** True once a token is old enough to refresh (24h) and close enough to expiry
 *  to be worth refreshing. Renewing at 30 days leaves a month of slack. */
export function shouldRefresh(conn: AppConnection): boolean {
  if (!conn.expiresAt) return false
  const age = Date.now() - Date.parse(conn.connectedAt)
  if (age < 24 * 60 * 60_000) return false
  return conn.expiresAt - Date.now() < 30 * 24 * 60 * 60_000
}

// ── broker ───────────────────────────────────────────────────────────────────

export const DEFAULT_BROKER = process.env.SIGNAGE_BROKER_URL || 'https://signage.frozenbit.eu'

/** Reads a normalised feed from our own broker, which holds the Meta app
 *  secret and the account token. The install token identifies this manager and
 *  is revocable on its own, so a decommissioned PC is cut off without
 *  disturbing the customer's Instagram connection. */
export async function fetchBroker(brokerUrl: string, installToken: string, limit: number): Promise<FeedPayload> {
  const url = `${brokerUrl.replace(/\/$/, '')}/feed/instagram?limit=${encodeURIComponent(String(limit))}`
  const raw = await getJson(url, { headers: { Authorization: `Bearer ${installToken}` } }) as Record<string, unknown>
  // The broker already returns our shape; run it through the feed normaliser
  // so a schema drift on their side cannot put junk on a screen.
  return fetchFeedService(url).catch(() => normaliseBroker(raw))
}

function normaliseBroker(raw: Record<string, unknown>): FeedPayload {
  const profile = (raw.profile ?? {}) as Record<string, unknown>
  const posts = Array.isArray(raw.posts) ? raw.posts as Array<Record<string, unknown>> : []
  return {
    profile: {
      username: str(profile.username) || 'instagram',
      displayName: str(profile.displayName) || str(profile.username) || 'instagram',
      avatarUrl: str(profile.avatarUrl) || undefined,
    },
    posts: posts.filter(p => str(p.imageUrl)).map(p => ({
      id: str(p.id),
      caption: str(p.caption),
      mediaType: (str(p.mediaType).toUpperCase() as MediaType) || 'IMAGE',
      imageUrl: str(p.imageUrl),
      permalink: str(p.permalink) || undefined,
      timestamp: str(p.timestamp) || new Date().toISOString(),
      username: str(p.username) || str(profile.username),
      displayName: str(p.displayName) || str(profile.displayName) || str(profile.username),
      avatarUrl: str(p.avatarUrl) || str(profile.avatarUrl) || undefined,
    })),
  }
}

// ── filtering ────────────────────────────────────────────────────────────────

/** "last 30 days" / "last 10 posts", applied after fetch so switching the
 *  filter never costs an API call. */
export function applyFilter(posts: Post[], filter: string, count: number): Post[] {
  const sorted = [...posts].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
  if (filter === 'count') return sorted.slice(0, Math.max(1, count))
  if (filter === 'days') {
    const cutoff = Date.now() - Math.max(1, count) * 86_400_000
    const recent = sorted.filter(p => Date.parse(p.timestamp) >= cutoff)
    // An account that has not posted this month would otherwise blank the
    // screen; showing the most recent post is a better failure.
    return recent.length ? recent : sorted.slice(0, 1)
  }
  return sorted
}
