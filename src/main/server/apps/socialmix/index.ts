import type { AppContext, AppDefinition, AppRefreshResult } from '../types'
import { appPage, escapeHtml, fontScale, jsonLiteral, resolveTheme, speedToDwellMs } from '../render'
import { buildQrSvg } from '../../scenes'
import { MIX_GLYPH, PLATFORM_GLYPHS, PLATFORM_TINTS, SOCIAL_WALL_JS, socialWallCss } from '../social/wall'
import { applyFilter, fetchAnyFeed, type FeedPayload, type Post, type SocialPlatform } from '../social/sources'

// Social Mix.
//
// One wall fed by several networks at once, which is the only way a room with
// one screen and three accounts gets to show all three. The layouts, theme and
// speed curve are the same ones the Instagram and Facebook walls use — a mixed
// wall that looked different from a single-network wall would just be a second
// product to learn.
//
// Two things are genuinely different, and both come from the mixing:
//
//   Every post carries its network, so each card wears its own badge in its
//   own brand colour. That is the whole point: a viewer has to be able to tell
//   at a glance which of these came from where.
//
//   A post may have no picture. X is mostly words, and a card that reserves a
//   photo-shaped hole for a post that has no photo looks broken. The shared
//   views draw text posts properly, which the single-network walls now inherit.
//
// Sources are feed links, one per network. That is not laziness: reading any
// of these three networks directly needs an app secret and a review process a
// desktop app on a customer LAN cannot complete, and X has no free read tier
// at all. A link is what an operator can actually obtain — from a wall service
// they pay for, or from an RSS bridge. Each field takes either shape.

const MAX_POSTS = 60

interface SourceSlot {
  platform: SocialPlatform
  key: string
  label: string
}

const SLOTS: SourceSlot[] = [
  { platform: 'instagram', key: 'instagramFeed', label: 'Instagram' },
  { platform: 'facebook', key: 'facebookFeed', label: 'Facebook' },
  { platform: 'twitter', key: 'twitterFeed', label: 'X (Twitter)' },
]

interface MixData {
  posts: Post[]
  /** Per-source outcome of the last fetch. Nothing draws this — it is here so
   *  that "why is Facebook missing from the wall" has an answer at
   *  /tv/app/<id>/data instead of requiring a guess. */
  sources: Array<{ platform: SocialPlatform; ok: boolean; posts: number; error?: string }>
}

/** A stable pseudo-random ordering. Math.random would reshuffle on every
 *  refresh, and because the page restarts the wall whenever the post list
 *  changes, that would yank a scrolling wall back to the top every ten
 *  minutes. Hashing the id gives a shuffle that looks random and holds still. */
function idHash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/** Deals one post from each network in turn, so a busy account cannot put six
 *  of its own posts on screen before another network gets one. */
function roundRobin(posts: Post[]): Post[] {
  const lanes = new Map<string, Post[]>()
  for (const p of posts) {
    const lane = lanes.get(p.platform ?? '') ?? []
    lane.push(p)
    lanes.set(p.platform ?? '', lane)
  }
  const queues = [...lanes.values()]
  const out: Post[] = []
  for (let i = 0; out.length < posts.length; i++) {
    for (const q of queues) {
      if (i < q.length) out.push(q[i])
    }
  }
  return out
}

function order(posts: Post[], how: string): Post[] {
  if (how === 'roundrobin') return roundRobin(posts)
  if (how === 'shuffle') return [...posts].sort((a, b) => idHash(a.id) - idHash(b.id))
  return [...posts].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
}

export const socialmix: AppDefinition = {
  id: 'socialmix',
  name: 'Social Mix',
  icon: '🔀',
  description: 'Mix Instagram, Facebook and X posts into one wall, each post badged with where it came from.',
  category: 'social',
  defaultDuration: 60,

  fields: [
    {
      key: 'sourcesNote', label: 'Where the posts come from', type: 'note',
      help: 'Add a feed link for each network you want in the mix — at least one. Each box takes either a JSON feed link '
        + 'from a wall service, or an RSS/Atom link. The manager reads them, copies the pictures to this PC, and the '
        + 'screens only ever talk to the manager.',
    },
    {
      key: 'instagramFeed', label: 'Instagram feed link', type: 'url',
      placeholder: 'https://feeds.behold.so/xxxxxxxx',
      help: 'Connect your Instagram account at behold.so or a similar wall service and paste the feed link it gives you. '
        + 'Instagram closed its simple feed API in December 2024, so a service that holds the credentials is the '
        + 'practical route.',
    },
    {
      key: 'facebookFeed', label: 'Facebook feed link', type: 'url',
      placeholder: 'https://api.example.com/feed.json',
      help: 'From a wall service that has your Page connected. Facebook only ever lets you read a Page you administer, '
        + 'whichever route you take.',
    },
    {
      key: 'twitterFeed', label: 'X (Twitter) feed link', type: 'url',
      placeholder: 'https://nitter.net/yourhandle/rss',
      help: 'X has no free tier for reading posts, so this is either a paid wall service, or an RSS bridge such as '
        + 'nitter.net. Bridges are community-run with no guarantees and can stop working without notice — if the '
        + 'wall empties, swap in another link.',
    },

    {
      key: 'displayMode', label: 'Display Mode', type: 'select', required: true, default: 'wall',
      options: [
        { value: 'single', label: 'Single Post View', hint: 'One post at a time, photo and caption side by side' },
        { value: 'wall', label: 'Social Wall View', hint: 'A masonry grid that scrolls continuously' },
        { value: 'kiosk', label: 'Social Kiosk View', hint: 'One post at a time with a slow zoom' },
        { value: 'bricks', label: 'Bricks View', hint: 'A page of tiles that swaps as a set' },
      ],
    },
    {
      key: 'theme', label: 'Theme', type: 'select', required: true, default: 'dark',
      options: [
        { value: 'light', label: 'Light Theme' },
        { value: 'dark', label: 'Dark Theme' },
        { value: 'custom', label: 'Custom' },
      ],
    },
    {
      key: 'backgroundColor', label: 'Background Colour', type: 'color', default: '#f5f5f5',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'textColor', label: 'Text Colour', type: 'color', default: '#37474f',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'speed', label: 'Speed', type: 'select', required: true, default: 'medium',
      options: [
        { value: 'slow', label: 'Slow' },
        { value: 'medium', label: 'Medium' },
        { value: 'fast', label: 'Fast' },
        { value: 'custom', label: 'Custom' },
      ],
      help: 'How fast the wall scrolls, or how long each post stays up.',
    },
    {
      key: 'speedValue', label: 'Custom speed', type: 'slider', default: 10, min: 1, max: 20, step: 1,
      marks: ['Slow', 'Medium', 'Fast'],
      showIf: { key: 'speed', equals: ['custom'] },
    },
    {
      key: 'fontSize', label: 'Font Size', type: 'select', default: 'default',
      options: [
        { value: 'smallest', label: 'Smallest' },
        { value: 'smaller', label: 'Smaller' },
        { value: 'default', label: 'Default' },
        { value: 'larger', label: 'Larger' },
        { value: 'largest', label: 'Largest' },
      ],
    },

    // ── Advanced ──
    {
      key: 'mixOrder', label: 'Mix posts by', type: 'select', default: 'newest', advanced: true,
      options: [
        { value: 'newest', label: 'Newest first', hint: 'One timeline across all networks' },
        { value: 'roundrobin', label: 'Take turns', hint: 'One post from each network in rotation, so a busy account cannot crowd the others out' },
        { value: 'shuffle', label: 'Shuffle', hint: 'Mixed up, but the same order every time so the wall does not jump' },
      ],
    },
    {
      key: 'perSource', label: 'Most posts to take from each network', type: 'number',
      default: 20, min: 1, max: 60, advanced: true,
      help: 'Keeps one prolific account from filling the whole wall.',
    },
    {
      key: 'showBadges', label: 'Badge each post with its network', type: 'checkbox', default: true, advanced: true,
      help: 'On by default — telling the networks apart is the point of a mixed wall.',
    },
    {
      key: 'filterPosts', label: 'Filter Posts', type: 'select', default: 'none', advanced: true,
      options: [
        { value: 'none', label: 'None' },
        { value: 'days', label: 'Posted in the last…' },
        { value: 'count', label: 'Most recent…' },
      ],
      help: 'Applied after the networks are merged.',
    },
    {
      key: 'filterValue', label: 'Amount', type: 'number', default: 30, min: 1, max: 365, advanced: true,
      help: 'Days, or number of posts, depending on the filter above.',
      showIf: { key: 'filterPosts', equals: ['days', 'count'] },
    },
    {
      key: 'hideReplies', label: 'Hide replies', type: 'checkbox', default: true, advanced: true,
      help: 'Drops posts that are answers to someone else. Half of a busy X account is replies, and they read as '
        + 'one side of a conversation on a wall.',
    },
    {
      key: 'hidePhotoCaptions', label: 'Hide captions on posts with a picture', type: 'checkbox', default: false, advanced: true,
      help: 'For walls where the photos should speak for themselves. Posts that are only words keep their words — '
        + 'hiding those would leave an empty card.',
    },
    {
      key: 'showQr', label: 'Show QR Code', type: 'checkbox', default: false, advanced: true,
      help: 'Adds a scannable code beside each post in Single and Kiosk views.',
    },
    {
      key: 'qrUrl', label: 'QR links to', type: 'url', advanced: true,
      placeholder: 'https://example.com/social',
      help: 'A mixed wall has no single account to point at, so choose where the code should send people.',
      showIf: { key: 'showQr', equals: [true] },
    },
  ],

  validate(config) {
    const any = SLOTS.some(s => String(config[s.key] ?? '').trim())
    if (!any) return 'Add at least one feed link — Instagram, Facebook or X.'
    if (config.showQr === true && !String(config.qrUrl ?? '').trim()) {
      return 'Choose where the QR code should link to, or turn it off.'
    }
    return null
  },

  async refresh(ctx: AppContext): Promise<AppRefreshResult> {
    const c = ctx.instance.config
    const perSource = Math.max(1, Math.min(MAX_POSTS, Number(c.perSource ?? 20) || 20))
    const hideReplies = c.hideReplies !== false

    const configured = SLOTS
      .map(slot => ({ slot, url: String(c[slot.key] ?? '').trim() }))
      .filter(s => s.url)

    // One bad link must not cost the operator the other two. Each source is
    // settled on its own, and the refresh only fails when there is nothing at
    // all to show — which is the one case where the store's "keep the last
    // good payload" behaviour is what we want.
    const results = await Promise.all(configured.map(async ({ slot, url }) => {
      try {
        const payload: FeedPayload = await fetchAnyFeed(url)
        let posts = payload.posts
        if (hideReplies) posts = posts.filter(p => !/^R to @/i.test(p.caption))
        posts = posts
          .slice()
          .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
          .slice(0, perSource)
          .map(p => ({
            ...p,
            platform: slot.platform,
            avatarUrl: p.avatarUrl ?? payload.profile.avatarUrl,
          }))
        return { slot, posts, error: '' }
      } catch (e: unknown) {
        return { slot, posts: [] as Post[], error: e instanceof Error ? e.message : 'could not be read' }
      }
    }))

    const sources = results.map(r => ({
      platform: r.slot.platform,
      ok: !r.error,
      posts: r.posts.length,
      error: r.error || undefined,
    }))

    const merged = results.flatMap(r => r.posts)
    if (!merged.length) {
      const why = results.filter(r => r.error).map(r => `${r.slot.label}: ${r.error}`).join('; ')
      throw new Error(why || 'None of those feeds have any posts to show yet.')
    }

    const filtered = applyFilter(merged, String(c.filterPosts ?? 'none'), Number(c.filterValue ?? 30))
      .slice(0, MAX_POSTS)

    // Mirroring happens last, on the posts that survived, so a wall showing 60
    // of 180 fetched posts downloads 60 pictures rather than 180. Repeats are
    // remembered for the same reason and for a sharper one: every post from a
    // network shares that network's avatar, and mirror() has no in-flight
    // dedupe of its own.
    const copies = new Map<string, string | null>()
    const mirror = async (url?: string): Promise<string | undefined> => {
      if (!url) return undefined
      if (!copies.has(url)) copies.set(url, await ctx.mirror(url))
      return copies.get(url) ?? url
    }

    const posts: Post[] = []
    for (const p of filtered) {
      posts.push({
        ...p,
        imageUrl: p.imageUrl ? (await mirror(p.imageUrl)) ?? p.imageUrl : '',
        avatarUrl: await mirror(p.avatarUrl),
      })
    }

    const data: MixData = { posts, sources }
    return { data, ttlSeconds: 600 }
  },

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const theme = resolveTheme(c.theme, c.backgroundColor, c.textColor)
    const scale = fontScale(c.fontSize)

    const preset = String(c.speed ?? 'medium')
    const sliderValue = Number(c.speedValue ?? 10)
    const dwell = preset === 'custom'
      ? speedToDwellMs(sliderValue)
      : ({ slow: 15000, medium: 10000, fast: 5000 } as Record<string, number>)[preset] ?? 10000
    const pxPerFrame = preset === 'custom'
      ? Math.max(0.1, Math.min(2, sliderValue / 10))
      : ({ slow: 0.5, medium: 1, fast: 1.5 } as Record<string, number>)[preset] ?? 1

    const cfg = {
      mode: String(c.displayMode ?? 'wall'),
      bg: theme.bg,
      dwell,
      pxPerFrame,
      qr: c.showQr === true,
      dataUrl: `${ctx.baseUrl}/tv/app/${ctx.instance.id}/data`,
      loadingMessage: 'Loading posts…',
      emptyMessage: 'No posts to show yet',
      errorMessage: 'Cannot reach those feeds right now',
    }

    const qrTarget = String(c.qrUrl ?? '').trim()
    const data = (ctx.data ?? null) as MixData | null
    const seed = data && data.posts?.length
      ? `onPayload(${jsonLiteral({ data: seedFor(ctx), fetchedAt: null, stale: false, error: null })});`
      : ''

    // The glyph map is what turns the shared wall into a mixed one: declaring
    // it here is the whole of the opt-in, and the single-network walls that do
    // not declare it keep drawing exactly as they did.
    const badges = c.showBadges !== false

    return appPage({
      title: `Social Mix — ${escapeHtml(ctx.instance.name)}`,
      bg: theme.bg,
      fontCss: ctx.fontCss,
      css: socialWallCss(theme, scale),
      body: '<div id="root"></div>',
      script:
        `var CFG = ${jsonLiteral(cfg)};\n` +
        `var BRAND_SVG = ${jsonLiteral(MIX_GLYPH)};\n` +
        `var PLATFORM_GLYPHS = ${jsonLiteral(badges ? PLATFORM_GLYPHS : {})};\n` +
        `var PLATFORM_TINTS = ${jsonLiteral(badges ? PLATFORM_TINTS : {})};\n` +
        `var QR_SVG = ${jsonLiteral(c.showQr === true && qrTarget ? buildQrSvg(qrTarget, '#111111', '#ffffff') : '')};\n` +
        SOCIAL_WALL_JS + '\n' + seed,
    })
  },

  serializeData(ctx: AppContext) {
    return seedFor(ctx)
  },
}

/** Trims the cached payload to what a view draws. Runs on every poll from
 *  every screen, so it does no work beyond shaping. */
function seedFor(ctx: AppContext) {
  const data = (ctx.data ?? null) as MixData | null
  if (!data) return { profile: {}, posts: [] }
  const hidePhotoCaptions = ctx.instance.config.hidePhotoCaptions === true
  const badges = ctx.instance.config.showBadges !== false
  const base = String(ctx.baseUrl ?? '')
  const abs = (u?: string) => (u && u.indexOf('/') === 0 ? base + u : u)
  return {
    profile: {},
    posts: (data.posts ?? []).map(p => ({
      id: p.id,
      image: abs(p.imageUrl) ?? '',
      avatar: abs(p.avatarUrl),
      caption: hidePhotoCaptions && p.imageUrl ? '' : String(p.caption ?? '').slice(0, 600),
      username: p.username,
      displayName: p.displayName,
      timestamp: p.timestamp,
      platform: badges ? p.platform : undefined,
      w: p.width,
      h: p.height,
    })),
  }
}

export { seedFor }
