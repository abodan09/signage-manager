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

export type SocialPlatform = 'instagram' | 'facebook' | 'twitter'

export interface Post {
  id: string
  caption: string
  mediaType: MediaType
  /** Remote URL as fetched. Mirrored to a local path before it reaches a TV.
   *  Empty for a text-only post, which every network has and X is mostly
   *  made of. */
  imageUrl: string
  permalink?: string
  timestamp: string
  username: string
  displayName: string
  avatarUrl?: string
  width?: number
  height?: number
  /** Which network this came from. Set only by a wall that mixes several: a
   *  single-account wall leaves it undefined, and every post then wears that
   *  app's own badge rather than a per-post one. */
  platform?: SocialPlatform
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

/** One fetch, body returned as text. Split out from getJson so a source that
 *  might be RSS can look at what actually arrived before deciding how to read
 *  it — sniffing costs a second request otherwise. */
async function getText(url: string, init?: RequestInit): Promise<{ body: string; contentType: string }> {
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
    return { body, contentType: res.headers.get('content-type') || '' }
  } finally {
    clearTimeout(timer)
  }
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  return JSON.parse((await getText(url, init)).body)
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

// ── hosted feed service ──────────────────────────────────────────────────────

/** Behold-shaped JSON: https://feeds.behold.so/<feedId>
 *  Chosen as the reference shape because it is public, keyless, documented,
 *  and already rehosts media to a stable CDN. Other services that return a
 *  posts array with the same field names drop straight in. */
export async function fetchFeedService(feedUrl: string): Promise<FeedPayload> {
  return normaliseFeedJson(await getJson(feedUrl))
}

/** The parsing half of fetchFeedService, callable on a body already in hand. */
export function normaliseFeedJson(input: unknown): FeedPayload {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const rawPosts = Array.isArray(raw.posts) ? raw.posts : Array.isArray(input) ? input : []

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

// ── RSS / Atom ───────────────────────────────────────────────────────────────
//
// The second shape a feed link can arrive in, and for X the only one that is
// reachable without money: X retired its free API tier, so a wall showing X
// posts is fed either by a paid wall service or by an RSS bridge. Both come
// down this path, as does any ordinary blog or news feed an operator points at
// a screen.
//
// Written against a real bridge feed rather than the spec, because the spec is
// not what arrives: pictures are buried in CDATA HTML rather than in an
// <enclosure>, items are not in date order, and links point back at the bridge
// instead of at the network. Each of those is handled below.

/** The entities a feed actually emits. A full HTML table would be a page of
 *  code for characters no feed contains. &amp; is decoded last so that a
 *  double-escaped "&amp;lt;" survives as text rather than becoming a tag. */
function decodeEntities(s: string): string {
  // fromCodePoint throws on anything above U+10FFFF, and "&#9999999;" in one
  // post would otherwise abort the whole feed. An entity we cannot decode is
  // left standing as text, which is ugly but is still a wall.
  const codePoint = (n: number) => (n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '')
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d{1,7});/g, (whole, d: string) => codePoint(Number(d)) || whole)
    .replace(/&#x([0-9a-f]{1,6});/gi, (whole, h: string) => codePoint(parseInt(h, 16)) || whole)
    .replace(/&amp;/g, '&')
}

/** Text of the first <name> element, CDATA unwrapped. */
function tagText(xml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'i').exec(xml)
  if (!m) return ''
  const inner = m[1].trim()
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner)
  return cdata ? cdata[1] : decodeEntities(inner)
}

function attrOf(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)
  return m ? decodeEntities(m[1]) : ''
}

function htmlToText(html: string): string {
  return decodeEntities(
    html.replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function hostOf(url: string): string {
  try { return new URL(url).host.toLowerCase() } catch { return '' }
}

/** A bridge rehosts every picture through its own proxy, with the real address
 *  percent-encoded into the path. Unwrapping it means the manager mirrors from
 *  the network's own CDN: better pictures, and one fewer volunteer-run host
 *  that has to be up for a lobby screen to work.
 *
 *  Only applied to pictures served by the feed's own host, so an ordinary feed
 *  that happens to have "/pic/" in an image path is left alone. */
function unproxyImage(url: string, feedUrl: string): string {
  if (!/\/pic\//.test(url) || hostOf(url) !== hostOf(feedUrl)) return url
  const m = /\/pic\/(.+)$/.exec(url)
  if (!m) return url
  let decoded: string
  try { decoded = decodeURIComponent(m[1]) } catch { return url }
  if (/^https?:\/\//i.test(decoded)) return decoded
  return /^(media|card_img|amplify_video_thumb|tweet_video_thumb|ext_tw_video_thumb|profile_images)\//.test(decoded)
    ? `https://pbs.twimg.com/${decoded}`
    : url
}

/** A bridge's own permalink points back at the bridge, which will not be there
 *  in a year. A /status/ path is X's shape, so it can be sent home. */
function unproxyLink(url: string, feedUrl: string): string {
  if (!url || hostOf(url) !== hostOf(feedUrl)) return url
  const m = /^https?:\/\/[^/]+\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(url)
  return m ? `https://x.com/${m[1]}/status/${m[2]}` : url
}

function firstImageIn(html: string, feedUrl: string): string {
  const m = /<img\b[^>]*\bsrc\s*=\s*"([^"]+)"/i.exec(html)
  return m ? unproxyImage(decodeEntities(m[1]), feedUrl) : ''
}

/** RSS 2.0 or Atom into the same Post shape every view already draws. */
export function parseRssFeed(xml: string, feedUrl: string): FeedPayload {
  // Everything before the first item is the channel, so a per-item <title> or
  // <image> cannot be mistaken for the feed's own.
  const head = xml.split(/<(?:item|entry)[\s>]/i)[0]
  const channelTitle = tagText(head, 'title')
  const imageBlock = /<image(?:\s[^>]*)?>[\s\S]*?<\/image\s*>/i.exec(head)
  const channelAvatar = imageBlock ? tagText(imageBlock[0], 'url') : (tagText(head, 'logo') || tagText(head, 'icon'))

  // "Display Name / @handle" is how the bridges title a profile feed.
  const handleInTitle = /@([A-Za-z0-9_]{1,15})/.exec(channelTitle)
  const fallbackUser = handleInTitle ? handleInTitle[1] : (hostOf(feedUrl) || 'feed')
  const fallbackName = channelTitle.split('/')[0].trim() || fallbackUser

  const posts: Post[] = []
  const itemRe = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null) {
    const item = m[2]

    const rawTitle = tagText(item, 'title')
    const descRaw = tagText(item, 'description') || tagText(item, 'content:encoded') || tagText(item, 'content')
    const descText = htmlToText(descRaw)
    // A bridge puts the whole post in <title> and a marked-up copy of it in
    // <description>; a blog puts a headline in one and a summary in the other.
    // Telling them apart by content: when the two say the same thing the title
    // is the clean copy — no proxied anchors, no "Link" markers — so it wins,
    // unless it is so much shorter that it is plainly just a headline.
    const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const t = key(rawTitle), d = key(descText)
    const sameThing = !!t && !!d && (d.indexOf(t.slice(0, 40)) !== -1 || t.indexOf(d.slice(0, 40)) !== -1)
    const caption = !descText ? rawTitle
      : !rawTitle ? descText
        : sameThing && rawTitle.length >= descText.length * 0.4 ? rawTitle
          : `${rawTitle}\n\n${descText}`

    // Pictures, in the order a feed is likely to carry them.
    const mediaTag = /<media:(?:content|thumbnail)\b[^>]*>/i.exec(item)
    const enclosure = /<enclosure\b[^>]*>/i.exec(item)
    const enclosureType = enclosure ? attrOf(enclosure[0], 'type') : ''
    const image =
      (mediaTag ? unproxyImage(attrOf(mediaTag[0], 'url'), feedUrl) : '') ||
      (enclosure && /^image\//i.test(enclosureType) ? unproxyImage(attrOf(enclosure[0], 'url'), feedUrl) : '') ||
      firstImageIn(descRaw, feedUrl)

    // Atom puts the link in an attribute, RSS in the element's text.
    const linkTag = /<link\b[^>]*\bhref\s*=\s*"[^"]*"[^>]*>/i.exec(item)
    const link = unproxyLink(
      (linkTag ? attrOf(linkTag[0], 'href') : '') || tagText(item, 'link'),
      feedUrl,
    ).replace(/#m$/, '')

    const when = tagText(item, 'pubDate') || tagText(item, 'published') || tagText(item, 'updated')
    const parsed = when ? Date.parse(when) : NaN
    // dc:creator is "@handle" on a bridge and a person's name on a blog; Atom
    // wraps a <name> inside <author>. Only the first is a username.
    const creator = (tagText(item, 'dc:creator') || tagText(item, 'author') || '')
      .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const asHandle = /^@([A-Za-z0-9_]{1,15})$/.exec(creator)

    if (!caption && !image) continue
    posts.push({
      id: tagText(item, 'guid') || tagText(item, 'id') || link || String(posts.length),
      caption,
      mediaType: 'IMAGE',
      imageUrl: image,
      permalink: link || undefined,
      // An undated item sorts to "now", which puts it at the top of a wall —
      // wrong, but better than dropping a post over a missing date.
      timestamp: Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(),
      username: asHandle ? asHandle[1] : fallbackUser,
      displayName: !creator || asHandle ? fallbackName : creator,
      avatarUrl: channelAvatar || undefined,
    })
  }

  return {
    profile: { username: fallbackUser, displayName: fallbackName, avatarUrl: channelAvatar || undefined },
    posts,
  }
}

/** Reads a feed link without being told which kind it is. Operators paste
 *  whatever their provider gave them, and a wall service, a bridge and a blog
 *  all call it "the feed URL". */
export async function fetchAnyFeed(feedUrl: string): Promise<FeedPayload> {
  const { body, contentType } = await getText(feedUrl)
  const head = body.slice(0, 500).replace(/^﻿/, '').trim()
  if (!head) throw new Error('That feed returned nothing at all.')

  if (head.charAt(0) === '<' || /xml|rss|atom/i.test(contentType)) {
    // A bridge answers an unknown account with a styled HTML error page, and
    // feeding that to the parser yields an empty wall and no explanation.
    if (/^<(?:!doctype\s+html|html)\b/i.test(head)) {
      throw new Error('That address returned a web page rather than a feed.')
    }
    return parseRssFeed(body, feedUrl)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('That address returned neither a JSON feed nor RSS.')
  }
  return normaliseFeedJson(parsed)
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

  // fan_count is the "likes" number the counter app shows; followers_count is
  // the newer one Meta reports separately. Ask for both — Pages differ in
  // which they populate, and a counter with no number is a blank screen.
  const page = await getJson(
    `${base}/${id}?fields=name,username,picture.type(large),fan_count,followers_count` +
    `&access_token=${encodeURIComponent(token)}`,
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
    profile: {
      username, displayName, avatarUrl: pic,
      followers: Number(page.followers_count) || Number(page.fan_count) || undefined,
    },
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
