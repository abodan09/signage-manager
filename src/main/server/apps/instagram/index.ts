import type { AppContext, AppDefinition, AppRefreshResult } from '../types'
import { appPage, escapeHtml, fontScale, jsonLiteral, resolveTheme, speedToDwellMs } from '../render'
import { buildQrSvg } from '../../scenes'
import { IG_GLYPH, INSTAGRAM_JS, instagramCss } from './views'
import {
  applyFilter, DEFAULT_BROKER, fetchBroker, fetchFeedService, fetchGraph, type FeedPayload, type Post,
} from './sources'

// Instagram Wall.
//
// The four display modes, the theme/speed/font settings and the Advanced block
// mirror the reference product. What differs is underneath: the manager fetches
// the feed, mirrors every image to local disk, and serves the screen a page
// that talks only to the manager. That is what makes the wall keep playing when
// the WAN drops, and what keeps a Meta credential off a TV in a customer lobby.

const MAX_POSTS = 60

export const instagram: AppDefinition = {
  id: 'instagram',
  name: 'Instagram',
  icon: '📸',
  description: 'Show your Instagram feed as a single post, a scrolling wall, a kiosk or a tile grid.',
  category: 'social',
  defaultDuration: 60,

  fields: [
    {
      key: 'source', label: 'Where the posts come from', type: 'select', required: true, default: 'feed',
      options: [
        { value: 'feed', label: 'Hosted feed link', hint: 'Paste a feed URL from a service such as Behold — no Instagram developer setup' },
        { value: 'broker', label: 'Connected Instagram account', hint: 'Sign in once through signage.frozenbit.eu' },
        { value: 'token', label: 'Your own access token', hint: 'For a Meta app you set up yourself' },
      ],
      help: 'Instagram closed its simple feed API in December 2024. All three routes below need a Business or Creator account.',
    },
    {
      key: 'feedUrl', label: 'Feed URL', type: 'url', required: true,
      placeholder: 'https://feeds.behold.so/xxxxxxxx',
      help: 'Create a feed at behold.so (or a similar service), connect your Instagram account there, and paste the JSON feed link.',
      showIf: { key: 'source', equals: ['feed'] },
    },
    {
      key: 'accessToken', label: 'Long-lived access token', type: 'text', required: true, maxLength: 400,
      placeholder: 'IGQVJ…',
      help: 'A 60-day Instagram Graph token. The manager renews it automatically before it lapses.',
      showIf: { key: 'source', equals: ['token'] },
    },
    {
      key: 'brokerNote', label: 'Connected account', type: 'note',
      help: 'Connect an Instagram account under Settings → Connected accounts, then choose it here.',
      showIf: { key: 'source', equals: ['broker'] },
    },

    {
      key: 'displayMode', label: 'Display Mode', type: 'select', required: true, default: 'wall',
      options: [
        { value: 'single', label: 'Single Post View', hint: 'One post at a time, photo and caption side by side' },
        { value: 'wall', label: 'Social Wall View', hint: 'A masonry grid that scrolls continuously' },
        { value: 'kiosk', label: 'Social Kiosk View', hint: 'One post at a time with a slow zoom' },
        { value: 'bricks', label: 'Bricks View', hint: 'A page of photo tiles that swaps as a set' },
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
      key: 'filterPosts', label: 'Filter Posts', type: 'select', default: 'none', advanced: true,
      options: [
        { value: 'none', label: 'None' },
        { value: 'days', label: 'Posted in the last…' },
        { value: 'count', label: 'Most recent…' },
      ],
    },
    {
      key: 'filterValue', label: 'Amount', type: 'number', default: 30, min: 1, max: 365, advanced: true,
      help: 'Days, or number of posts, depending on the filter above.',
      showIf: { key: 'filterPosts', equals: ['days', 'count'] },
    },
    {
      key: 'hideCaptions', label: 'Hide captions', type: 'checkbox', default: false, advanced: true,
      help: 'Show photos only. Useful when captions are long or full of hashtags.',
    },
    {
      key: 'showQr', label: 'Show QR Code', type: 'checkbox', default: false, advanced: true,
      help: 'Adds a scannable code beside each post in Single and Kiosk views.',
    },
    {
      key: 'qrUrl', label: 'QR links to', type: 'url', advanced: true,
      placeholder: 'https://instagram.com/yourhandle',
      help: 'Leave blank to link to the account the posts come from.',
      showIf: { key: 'showQr', equals: [true] },
    },
  ],

  validate(config) {
    if (config.source === 'feed' && !String(config.feedUrl ?? '').trim()) {
      return 'Paste the feed URL, or switch to a connected account.'
    }
    if (config.source === 'token' && !String(config.accessToken ?? '').trim()) {
      return 'Paste your access token, or switch to a hosted feed link.'
    }
    return null
  },

  async refresh(ctx: AppContext): Promise<AppRefreshResult> {
    const c = ctx.instance.config
    const source = String(c.source ?? 'feed')

    let payload: FeedPayload
    if (source === 'feed') {
      payload = await fetchFeedService(String(c.feedUrl))
    } else if (source === 'token') {
      payload = await fetchGraph(String(c.accessToken), MAX_POSTS)
    } else {
      const conn = ctx.connection
      if (!conn) throw new Error('No Instagram account is connected yet.')
      payload = conn.meta?.brokerUrl || conn.accessToken.indexOf('inst_') === 0
        ? await fetchBroker(String(conn.meta?.brokerUrl ?? DEFAULT_BROKER), conn.accessToken, MAX_POSTS)
        : await fetchGraph(conn.accessToken, MAX_POSTS)
    }

    const filtered = applyFilter(
      payload.posts,
      String(c.filterPosts ?? 'none'),
      Number(c.filterValue ?? 30),
    ).slice(0, MAX_POSTS)

    if (!filtered.length) throw new Error('That account has no posts to show yet.')

    // Instagram hands out signed CDN URLs that expire within hours, and old TV
    // WebViews often cannot negotiate TLS with a third-party CDN at all. Every
    // image a screen will draw is copied here first.
    const avatarLocal = payload.profile.avatarUrl ? await ctx.mirror(payload.profile.avatarUrl) : null
    const posts: Post[] = []
    for (const p of filtered) {
      const local = await ctx.mirror(p.imageUrl)
      posts.push({
        ...p,
        imageUrl: local ?? p.imageUrl,
        avatarUrl: (p.avatarUrl ? await ctx.mirror(p.avatarUrl) : avatarLocal) ?? p.avatarUrl,
      })
    }

    return {
      data: {
        profile: { ...payload.profile, avatarUrl: avatarLocal ?? payload.profile.avatarUrl },
        posts,
      },
      // Ten minutes: brisk enough that a new post appears while people are
      // still in the room, gentle enough to stay far inside every rate limit.
      ttlSeconds: 600,
    }
  },

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const theme = resolveTheme(c.theme, c.backgroundColor, c.textColor)
    const scale = fontScale(c.fontSize)
    const mode = String(c.displayMode ?? 'wall')

    // Slider 1..20 maps to the reference product's 0.1..2.0 speedValue, whose
    // knots at 5/10/15 land exactly on the Slow/Medium/Fast constants.
    const preset = String(c.speed ?? 'medium')
    const sliderValue = Number(c.speedValue ?? 10)
    const dwell = preset === 'custom'
      ? speedToDwellMs(sliderValue)
      : ({ slow: 15000, medium: 10000, fast: 5000 } as Record<string, number>)[preset] ?? 10000
    const pxPerFrame = preset === 'custom'
      ? Math.max(0.1, Math.min(2, sliderValue / 10))
      : ({ slow: 0.5, medium: 1, fast: 1.5 } as Record<string, number>)[preset] ?? 1

    const data = (ctx.data ?? null) as { posts?: Post[]; profile?: { username?: string } } | null
    const handle = data?.profile?.username
    const qrTarget = String(c.qrUrl ?? '').trim()
      || (handle ? `https://instagram.com/${handle}` : 'https://instagram.com')

    const cfg = {
      mode,
      bg: theme.bg,
      dwell,
      pxPerFrame,
      qr: c.showQr === true,
      hideCaptions: c.hideCaptions === true,
      dataUrl: `${ctx.baseUrl}/tv/app/${ctx.instance.id}/data`,
      loadingMessage: 'Loading posts…',
      emptyMessage: 'No Instagram posts to show yet',
      errorMessage: 'Cannot reach Instagram right now',
    }

    // The payload is inlined as well as polled, so a screen renders instantly
    // on load instead of showing "Loading…" until the first poll returns.
    const seed = data && data.posts?.length
      ? `onPayload(${jsonLiteral({ data: seedFor(ctx), fetchedAt: null, stale: false, error: null })});`
      : ''

    return appPage({
      title: `Instagram — ${escapeHtml(ctx.instance.name)}`,
      bg: theme.bg,
      fontCss: ctx.fontCss,
      css: instagramCss(theme, scale),
      body: '<div id="root"></div>',
      script:
        `var CFG = ${jsonLiteral(cfg)};\n` +
        `var IG_SVG = ${jsonLiteral(IG_GLYPH)};\n` +
        `var QR_SVG = ${jsonLiteral(c.showQr === true ? buildQrSvg(qrTarget, '#111111', '#ffffff') : '')};\n` +
        INSTAGRAM_JS + '\n' + seed,
    })
  },

  serializeData(ctx: AppContext) {
    return seedFor(ctx)
  },
}

/** Trims the cached payload to exactly what a view draws. Captions can be
 *  thousands of characters and the page only ever shows the first few lines. */
function seedFor(ctx: AppContext) {
  const data = (ctx.data ?? null) as { posts?: Post[]; profile?: unknown } | null
  if (!data) return { profile: {}, posts: [] }
  const hide = ctx.instance.config.hideCaptions === true
  const base = String(ctx.baseUrl ?? '')
  const abs = (u?: string) => (u && u.indexOf('/') === 0 ? base + u : u)
  return {
    profile: data.profile,
    posts: (data.posts ?? []).map(p => ({
      id: p.id,
      // Local mirror paths are relative to the manager; the page may be loaded
      // from the LAN address, so they are absolutised here.
      image: abs(p.imageUrl),
      avatar: abs(p.avatarUrl),
      caption: hide ? '' : String(p.caption ?? '').slice(0, 600),
      username: p.username,
      displayName: p.displayName,
      timestamp: p.timestamp,
      w: p.width,
      h: p.height,
    })),
  }
}

export { seedFor }
