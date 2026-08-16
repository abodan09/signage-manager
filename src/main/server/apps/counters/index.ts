import type { AppContext, AppDefinition, AppField, AppRefreshResult } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'
import { buildQrSvg } from '../../scenes'
import {
  COUNTER_JS, counterCss, FB_BRAND, IG_BRAND, type CounterBrand,
} from '../social/counter'
import { DEFAULT_BROKER, fetchBroker, fetchFacebookPage, fetchFeedService } from '../social/sources'

// The Instagram and Facebook follower counters.
//
// Two apps in the catalogue, one implementation here: the board, the sources
// and the validation are identical, and only the palette, the icon, the
// wordmark and the wording differ. Built with a factory rather than by copying
// the file, so a fix to one is a fix to both.
//
// A counter needs exactly one number, which turns out to be the hard part. The
// hosted feed services return posts; only some return a follower total. So the
// sources are the feed (when it carries one), a Page or account token, our
// broker — and a number typed in by hand, which is not a cop-out: an operator
// celebrating a milestone on a lobby screen often wants a figure that does not
// quietly tick down when someone unfollows.

interface CounterSpec {
  id: string
  name: string
  icon: string
  network: 'instagram' | 'facebook'
  brand: CounterBrand
  description: string
  /** Wording that differs between the two. */
  defaultCaption: string
  countLabel: string
  profileHint: string
  profileBase: string
}

function counterFields(spec: CounterSpec): AppField[] {
  const isFb = spec.network === 'facebook'
  return [
    {
      key: 'source', label: 'Where the number comes from', type: 'select', required: true, default: 'manual',
      options: [
        { value: 'manual', label: 'A number I set', hint: 'No account needed — useful for a milestone you want to hold steady' },
        { value: 'feed', label: 'Hosted feed link', hint: 'A wall service that reports the follower total' },
        ...(isFb
          ? [{ value: 'token', label: 'Your own Page token', hint: 'Reads the live like count from the Page' }]
          : []),
        { value: 'broker', label: 'Connected account', hint: 'Sign in once through signage.frozenbit.eu' },
      ],
    },
    {
      key: 'manualCount', label: spec.countLabel, type: 'number', required: true, default: 1000, min: 0, max: 999999999,
      showIf: { key: 'source', equals: ['manual'] },
    },
    {
      key: 'feedUrl', label: 'Feed URL', type: 'url', required: true,
      placeholder: 'https://feeds.behold.so/xxxxxxxx',
      help: 'The same link the wall app uses. Not every service reports a follower total; if yours does not, set the number by hand.',
      showIf: { key: 'source', equals: ['feed'] },
    },
    ...(isFb
      ? [
        {
          key: 'pageId', label: 'Page ID', type: 'text', required: true, maxLength: 80,
          placeholder: '1234567890',
          showIf: { key: 'source', equals: ['token'] },
        } as AppField,
        {
          key: 'accessToken', label: 'Page access token', type: 'text', required: true, maxLength: 400,
          placeholder: 'EAAG…',
          help: 'A Page token from a long-lived user token. These do not expire.',
          showIf: { key: 'source', equals: ['token'] },
        } as AppField,
      ]
      : []),
    {
      key: 'brokerNote', label: 'Connected account', type: 'note',
      help: 'Connect the account under Settings → Connected accounts, then choose it here.',
      showIf: { key: 'source', equals: ['broker'] },
    },

    {
      key: 'heading', label: 'Heading', type: 'text', maxLength: 60,
      placeholder: spec.network === 'facebook' ? 'The Cliff Resort' : "Let's go!",
      help: 'Shown above the counter. Leave empty for none.',
    },
    {
      key: 'caption', label: 'Call to action', type: 'text', maxLength: 80, default: spec.defaultCaption,
      help: 'The line under the counter.',
    },
    {
      key: 'handle', label: spec.profileHint, type: 'text', maxLength: 100,
      placeholder: 'yourhandle',
      help: 'Used for the QR code people scan to follow you.',
    },

    // ── Advanced ──
    {
      key: 'showQr', label: 'Show QR code', type: 'checkbox', default: true, advanced: true,
    },
    {
      key: 'qrUrl', label: 'QR links to', type: 'url', advanced: true,
      help: 'Leave empty to use the handle above.',
      showIf: { key: 'showQr', equals: [true] },
    },
    {
      key: 'minDigits', label: 'Least digits to show', type: 'number', default: 0, min: 0, max: 9, advanced: true,
      help: 'Pads with leading zeros, so a counter near a round number does not jump in width as it crosses it.',
    },
  ]
}

function makeCounter(spec: CounterSpec): AppDefinition {
  return {
    id: spec.id,
    name: spec.name,
    icon: spec.icon,
    description: spec.description,
    category: 'social',
    defaultDuration: 20,
    fields: counterFields(spec),

    validate(config) {
      const source = String(config.source ?? 'manual')
      if (source === 'feed' && !String(config.feedUrl ?? '').trim()) {
        return 'Paste the feed URL, or set the number by hand.'
      }
      if (source === 'token') {
        if (!String(config.pageId ?? '').trim()) return 'Enter the Page ID.'
        if (!String(config.accessToken ?? '').trim()) return 'Paste the Page access token.'
      }
      return null
    },

    async refresh(ctx: AppContext): Promise<AppRefreshResult> {
      const c = ctx.instance.config
      const source = String(c.source ?? 'manual')

      // A typed-in number needs no network at all, which is the whole appeal.
      if (source === 'manual') {
        return { data: { count: Math.max(0, Number(c.manualCount ?? 0)) }, ttlSeconds: 24 * 60 * 60 }
      }

      let followers: number | undefined
      let handle: string | undefined

      if (source === 'feed') {
        const payload = await fetchFeedService(String(c.feedUrl))
        followers = payload.profile.followers
        handle = payload.profile.username
      } else if (source === 'token') {
        const payload = await fetchFacebookPage(String(c.pageId), String(c.accessToken), 1)
        followers = payload.profile.followers
        handle = payload.profile.username
      } else {
        const conn = ctx.connection
        if (!conn) throw new Error(`No ${spec.name.replace(' Counter', '')} account is connected yet.`)
        const pageId = String(conn.meta?.pageId ?? conn.accountId ?? '')
        const payload = spec.network === 'facebook' && pageId
          ? await fetchFacebookPage(pageId, conn.accessToken, 1)
          : await fetchBroker(String(conn.meta?.brokerUrl ?? DEFAULT_BROKER), conn.accessToken, 1)
        followers = payload.profile.followers
        handle = payload.profile.username
      }

      if (typeof followers !== 'number' || !Number.isFinite(followers)) {
        // Said plainly, because the fix is a setting away and the alternative
        // is a screen showing nothing with no explanation.
        throw new Error('That source did not report a follower count. Choose "A number I set" and enter it by hand.')
      }

      return { data: { count: Math.max(0, Math.round(followers)), handle }, ttlSeconds: 30 * 60 }
    },

    render(ctx: AppContext): string {
      const c = ctx.instance.config
      const data = (ctx.data ?? null) as { count?: number; handle?: string } | null

      const handle = String(c.handle ?? '').trim().replace(/^@/, '') || data?.handle || ''
      const qrTarget = String(c.qrUrl ?? '').trim()
        || (handle ? spec.profileBase + encodeURIComponent(handle) : spec.profileBase.replace(/\/$/, ''))

      const cfg = {
        heading: String(c.heading ?? '').trim(),
        caption: String(c.caption ?? spec.defaultCaption).trim(),
        iconLabel: spec.brand.iconLabel,
        minDigits: Math.max(0, Math.min(9, Number(c.minDigits ?? 0))),
        dataUrl: `${ctx.baseUrl}/tv/app/${ctx.instance.id}/data`,
      }

      return appPage({
        title: `${spec.name} — ${escapeHtml(ctx.instance.name)}`,
        bg: spec.network === 'facebook' ? spec.brand.background : '#c13584',
        fontCss: ctx.fontCss,
        css: counterCss(spec.brand),
        body: '<div id="root"></div>',
        script:
          `var CFG = ${jsonLiteral(cfg)};\n` +
          `var ICON = ${jsonLiteral(spec.brand.icon)};\n` +
          `var WORDMARK = ${jsonLiteral(spec.brand.wordmark)};\n` +
          `var QR_SVG = ${jsonLiteral(c.showQr !== false ? buildQrSvg(qrTarget, '#111111', '#ffffff') : '')};\n` +
          `var SEED = ${jsonLiteral(data && typeof data.count === 'number' ? { data: { count: data.count } } : null)};\n` +
          COUNTER_JS,
      })
    },

    serializeData(ctx: AppContext) {
      const d = (ctx.data ?? null) as { count?: number } | null
      return d && typeof d.count === 'number' ? { count: d.count } : null
    },
  }
}

export const igcounter = makeCounter({
  id: 'igcounter',
  name: 'Instagram Counter',
  icon: '🔢',
  network: 'instagram',
  brand: IG_BRAND,
  description: 'Show your Instagram follower count, with a QR code people can scan to follow.',
  defaultCaption: 'Scan to follow us!',
  countLabel: 'Followers',
  profileHint: 'Instagram handle',
  profileBase: 'https://instagram.com/',
})

export const fbcounter = makeCounter({
  id: 'fbcounter',
  name: 'Facebook Counter',
  icon: '👍',
  network: 'facebook',
  brand: FB_BRAND,
  description: 'Show how many likes your Page has, with a QR code people can scan to like it.',
  defaultCaption: 'Scan QR to Like Us!',
  countLabel: 'Likes',
  profileHint: 'Facebook Page name',
  profileBase: 'https://facebook.com/',
})
