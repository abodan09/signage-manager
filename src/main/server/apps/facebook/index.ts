import type { AppContext, AppDefinition, AppRefreshResult } from '../types'
import { appPage, escapeHtml, fontScale, jsonLiteral, resolveTheme, speedToDwellMs } from '../render'
import { buildQrSvg } from '../../scenes'
import { FB_GLYPH, SOCIAL_WALL_JS, socialWallCss } from '../social/wall'
import {
  applyFilter, DEFAULT_BROKER, fetchBroker, fetchFacebookPage, fetchFeedService,
  type FeedPayload, type Post,
} from '../social/sources'

// Facebook Page wall.
//
// The same four layouts as the Instagram wall, because they are the same
// thing: a feed of posts with an author, a time, a caption and a picture. The
// views, the theme handling and the speed curve all live in apps/social and
// are shared — this file is the Facebook-shaped parts, which are the fields,
// where the posts come from, and which glyph the corner wears.
//
// Auth lands in the same place as Instagram. Meta permits no loopback
// redirect and no PKCE and requires the app secret for the token exchange, so
// a desktop app on a customer LAN cannot complete the flow alone. One thing is
// easier here: a Page token derived from a long-lived user token does not
// expire, so once connected a Facebook wall needs no renewal.

const MAX_POSTS = 60

export const facebook: AppDefinition = {
  id: 'facebook',
  name: 'Facebook',
  icon: '📘',
  description: 'Show your Facebook Page as a scrolling wall, a single post, a kiosk or a tile grid.',
  category: 'social',
  defaultDuration: 60,

  fields: [
    {
      key: 'source', label: 'Where the posts come from', type: 'select', required: true, default: 'feed',
      options: [
        { value: 'feed', label: 'Hosted feed link', hint: 'Paste a feed URL from a wall service — no Facebook developer setup' },
        { value: 'broker', label: 'Connected Facebook Page', hint: 'Sign in once through signage.frozenbit.eu' },
        { value: 'token', label: 'Your own Page token', hint: 'For a Meta app you set up yourself' },
      ],
      help: 'Reading a Page needs a Meta app, which needs a public HTTPS callback — so a link or a connected account is the practical route.',
    },
    {
      key: 'feedUrl', label: 'Feed URL', type: 'url', required: true,
      placeholder: 'https://feeds.example.com/xxxxxxxx',
      help: 'Connect your Page at a wall service and paste the JSON feed link it gives you.',
      showIf: { key: 'source', equals: ['feed'] },
    },
    {
      key: 'pageId', label: 'Page ID', type: 'text', required: true, maxLength: 80,
      placeholder: '1234567890',
      help: 'On your Page: About → Page transparency, or the number in the Page URL.',
      showIf: { key: 'source', equals: ['token'] },
    },
    {
      key: 'accessToken', label: 'Page access token', type: 'text', required: true, maxLength: 400,
      placeholder: 'EAAG…',
      help: 'A Page token from a long-lived user token. These do not expire, so it is set once.',
      showIf: { key: 'source', equals: ['token'] },
    },
    {
      key: 'brokerNote', label: 'Connected Page', type: 'note',
      help: 'Connect a Facebook Page under Settings → Connected accounts, then choose it here. Nothing is ever posted to Facebook — the connection is read-only.',
      showIf: { key: 'source', equals: ['broker'] },
    },

    {
      key: 'displayMode', label: 'Display Mode', type: 'select', required: true, default: 'wall',
      options: [
        { value: 'single', label: 'Single Post View', hint: 'One post at a time, picture and caption side by side' },
        { value: 'wall', label: 'Social Wall View', hint: 'A masonry grid that scrolls continuously' },
        { value: 'kiosk', label: 'Social Kiosk View', hint: 'One post at a time with a slow zoom' },
        { value: 'bricks', label: 'Bricks View', hint: 'A page of picture tiles that swaps as a set' },
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
      key: 'requirePhoto', label: 'Only show posts with a picture', type: 'checkbox', default: false, advanced: true,
      help: 'Page feeds carry text-only updates that look thin on a big screen.',
    },
    {
      key: 'hideCaptions', label: 'Hide captions', type: 'checkbox', default: false, advanced: true,
    },
    {
      key: 'showQr', label: 'Show QR Code', type: 'checkbox', default: false, advanced: true,
      help: 'Adds a scannable code beside each post in Single and Kiosk views.',
    },
    {
      key: 'qrUrl', label: 'QR links to', type: 'url', advanced: true,
      placeholder: 'https://facebook.com/yourpage',
      help: 'Leave blank to link to the Page the posts come from.',
      showIf: { key: 'showQr', equals: [true] },
    },
  ],

  validate(config) {
    if (config.source === 'feed' && !String(config.feedUrl ?? '').trim()) {
      return 'Paste the feed URL, or switch to a connected Page.'
    }
    if (config.source === 'token') {
      if (!String(config.pageId ?? '').trim()) return 'Enter the Page ID.'
      if (!String(config.accessToken ?? '').trim()) return 'Paste the Page access token.'
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
      payload = await fetchFacebookPage(String(c.pageId), String(c.accessToken), MAX_POSTS)
    } else {
      const conn = ctx.connection
      if (!conn) throw new Error('No Facebook Page is connected yet.')
      const pageId = String(conn.meta?.pageId ?? conn.accountId ?? '')
      payload = pageId
        ? await fetchFacebookPage(pageId, conn.accessToken, MAX_POSTS)
        : await fetchBroker(String(conn.meta?.brokerUrl ?? DEFAULT_BROKER), conn.accessToken, MAX_POSTS)
    }

    let posts = applyFilter(payload.posts, String(c.filterPosts ?? 'none'), Number(c.filterValue ?? 30))
    if (c.requirePhoto === true) posts = posts.filter(p => !!p.imageUrl)
    posts = posts.slice(0, MAX_POSTS)

    if (!posts.length) throw new Error('That Page has no posts to show yet.')

    // Facebook's CDN URLs are signed and short-lived, exactly like Instagram's,
    // and old TV WebViews often cannot reach them at all. Copy first.
    const avatarLocal = payload.profile.avatarUrl ? await ctx.mirror(payload.profile.avatarUrl) : null
    const mirrored: Post[] = []
    for (const p of posts) {
      const local = p.imageUrl ? await ctx.mirror(p.imageUrl) : null
      mirrored.push({
        ...p,
        imageUrl: local ?? p.imageUrl,
        avatarUrl: (p.avatarUrl ? await ctx.mirror(p.avatarUrl) : avatarLocal) ?? p.avatarUrl,
      })
    }

    return {
      data: {
        profile: { ...payload.profile, avatarUrl: avatarLocal ?? payload.profile.avatarUrl },
        posts: mirrored,
      },
      ttlSeconds: 600,
    }
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

    const data = (ctx.data ?? null) as { posts?: Post[]; profile?: { username?: string } } | null
    const handle = data?.profile?.username
    const qrTarget = String(c.qrUrl ?? '').trim()
      || (handle ? `https://facebook.com/${handle}` : 'https://facebook.com')

    const cfg = {
      mode: String(c.displayMode ?? 'wall'),
      bg: theme.bg,
      dwell,
      pxPerFrame,
      qr: c.showQr === true,
      hideCaptions: c.hideCaptions === true,
      dataUrl: `${ctx.baseUrl}/tv/app/${ctx.instance.id}/data`,
      loadingMessage: 'Loading posts…',
      emptyMessage: 'No Facebook posts to show yet',
      errorMessage: 'Cannot reach Facebook right now',
    }

    const seed = data && data.posts?.length
      ? `onPayload(${jsonLiteral({ data: seedFor(ctx), fetchedAt: null, stale: false, error: null })});`
      : ''

    return appPage({
      title: `Facebook — ${escapeHtml(ctx.instance.name)}`,
      bg: theme.bg,
      fontCss: ctx.fontCss,
      css: socialWallCss(theme, scale),
      body: '<div id="root"></div>',
      script:
        `var CFG = ${jsonLiteral(cfg)};\n` +
        `var BRAND_SVG = ${jsonLiteral(FB_GLYPH)};\n` +
        `var QR_SVG = ${jsonLiteral(c.showQr === true ? buildQrSvg(qrTarget, '#111111', '#ffffff') : '')};\n` +
        SOCIAL_WALL_JS + '\n' + seed,
    })
  },

  serializeData(ctx: AppContext) {
    return seedFor(ctx)
  },

  suggestName(ctx: AppContext) {
    const d = (ctx.data ?? null) as { profile?: { displayName?: string } } | null
    return d?.profile?.displayName ? `${d.profile.displayName} — Facebook` : null
  },
}

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
