import type { AppContext, AppDefinition } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'
import { LIVETV_CSS, LIVETV_JS } from './page'

// Live TV with Ads.
//
// A live picture fills the screen and a small advert visits a corner every so
// often — the bar television that sells you a drink between plays.
//
// Where this deliberately departs from the product it is modelled on: that one
// takes its picture from a USB capture card on a Windows PC. Our screens are
// WebView shells, and a WebView cannot open a capture device over a plain-HTTP
// LAN address — getUserMedia requires a secure context, which rules it out on
// every panel we ship to. A capture mode would work on the operator's own
// machine and nowhere else, which is worse than not offering it, so the feed is
// always an address the screen can open for itself.
//
// The adverts are an ordinary playlist. Anything that can go in a playlist can
// be an advert, the operator edits them where they already edit everything
// else, and a change reaches the screens without republishing this app.

const HLS_MESSAGE =
  'This browser cannot play HLS. The stream will still play on LG webOS screens.'

/** Percent of the screen, or pixels. Two pairs of size fields rather than one,
 *  because a field's bounds are static and cannot follow the unit — and because
 *  an operator who types 20 meaning pixels must never silently get 20%. */
const SIZE_HELP = 'The advert box. Position and size are read against the whole screen.'

export const livetv: AppDefinition = {
  id: 'livetv',
  name: 'Live TV with Ads',
  icon: '📺',
  description: 'A live feed on the whole screen, with adverts that visit a corner on a timer.',
  category: 'media',
  defaultDuration: 3600,

  fields: [
    {
      key: 'sourceNote', label: 'The screen opens the feed itself', type: 'note',
      help: 'There is no HDMI or USB capture on a TV player — a web page cannot read a capture card. ' +
        'Give this app a stream address the screen can reach on its own network.',
    },
    {
      key: 'sourceType', label: 'Live source', type: 'select', default: 'mp4',
      options: [
        { value: 'mp4', label: 'Video stream (MP4)', hint: 'H.264 in MP4 — the only kind every screen can decode.' },
        { value: 'hls', label: 'HLS stream (.m3u8)', hint: 'Plays on LG webOS screens. Will not play in this preview.' },
        { value: 'mjpeg', label: 'MJPEG camera', hint: 'Safest of all: it never touches the video decoder.' },
        { value: 'embed', label: 'Web page', hint: 'A player page. It must itself work on an old TV browser.' },
      ],
    },
    {
      key: 'streamUrl', label: 'Stream address', type: 'url', required: true,
      placeholder: 'https://camera.example.com/live.mp4',
      help: 'The screens open this directly, so it has to be reachable from where they are.',
    },
    {
      key: 'videoFit', label: 'Fill the screen', type: 'select', default: 'contain',
      options: [
        { value: 'contain', label: 'Whole picture', hint: 'Black bars if the shapes differ.' },
        { value: 'cover', label: 'Fill the screen', hint: 'Crops the edges.' },
        { value: 'fill', label: 'Stretch to fit' },
      ],
    },
    {
      key: 'adsProjectId', label: 'Advertisements playlist', type: 'project', required: true,
      help: 'Any playlist. Its items take turns, one per appearance.',
    },
    {
      key: 'intervalSeconds', label: 'Ads interval', type: 'number', default: 30, min: 5, max: 3600,
      help: 'Seconds from the start of one advert to the start of the next.',
    },
    {
      key: 'playSeconds', label: 'Play for', type: 'number', default: 10, min: 1, max: 300,
      help: 'Seconds an advert stays on screen. This replaces the duration set in the playlist.',
    },
    {
      key: 'restSeconds', label: 'Rest for', type: 'number', default: 1, min: 1, max: 300,
      help: 'Seconds of clean picture guaranteed between adverts.',
    },
    {
      key: 'position', label: 'Where the advert appears', type: 'select', default: 'bottom-right',
      options: [
        { value: 'top-left', label: 'Top left' },
        { value: 'top-center', label: 'Top centre' },
        { value: 'top-right', label: 'Top right' },
        { value: 'middle-left', label: 'Middle left' },
        { value: 'center', label: 'Centre' },
        { value: 'middle-right', label: 'Middle right' },
        { value: 'bottom-left', label: 'Bottom left' },
        { value: 'bottom-center', label: 'Bottom centre' },
        { value: 'bottom-right', label: 'Bottom right' },
        { value: 'custom', label: 'Exact position' },
      ],
    },
    {
      key: 'customTop', label: 'Top (%)', type: 'number', default: 70, min: 0, max: 100,
      showIf: { key: 'position', equals: ['custom'] },
    },
    {
      key: 'customLeft', label: 'Left (%)', type: 'number', default: 70, min: 0, max: 100,
      showIf: { key: 'position', equals: ['custom'] },
    },
    {
      key: 'sizeUnit', label: 'Advert size in', type: 'select', default: 'percent',
      options: [
        { value: 'percent', label: 'Percent', hint: 'One layout fits every panel.' },
        { value: 'pixel', label: 'Pixels', hint: 'For a fixed creative that must not be resampled.' },
      ],
    },
    {
      key: 'adWidthPct', label: 'Width (%)', type: 'number', default: 20, min: 1, max: 100,
      showIf: { key: 'sizeUnit', equals: ['percent'] }, help: SIZE_HELP,
    },
    {
      key: 'adHeightPct', label: 'Height (%)', type: 'number', default: 12, min: 1, max: 100,
      showIf: { key: 'sizeUnit', equals: ['percent'] },
    },
    {
      key: 'adWidthPx', label: 'Width (px)', type: 'number', default: 384, min: 20, max: 3840,
      showIf: { key: 'sizeUnit', equals: ['pixel'] }, help: SIZE_HELP,
    },
    {
      key: 'adHeightPx', label: 'Height (px)', type: 'number', default: 216, min: 20, max: 2160,
      showIf: { key: 'sizeUnit', equals: ['pixel'] },
    },
    {
      key: 'animation', label: 'How the advert arrives', type: 'select', default: 'fade',
      options: [
        { value: 'fade', label: 'Fade in' },
        { value: 'slide-left', label: 'Slide in from the left' },
        { value: 'slide-right', label: 'Slide in from the right' },
        { value: 'slide-up', label: 'Slide in from below' },
        { value: 'slide-down', label: 'Slide in from above' },
        { value: 'cut', label: 'No animation' },
      ],
      help: 'Adverts move by changing where they sit, not by being spun or scaled — on a TV the ' +
        'live picture is drawn by separate hardware, and a spun layer can blank it.',
    },

    // ── Advanced ──
    {
      key: 'durationNote', label: 'Give this a long duration in the playlist', type: 'note', advanced: true,
      help: 'This is a live feed, not a slide. A 30-second playlist item tears the feed down and ' +
        'reconnects every 30 seconds, and the adverts start over each time.',
    },
    {
      key: 'startDelaySeconds', label: 'Wait before the first advert', type: 'number',
      default: 5, min: 0, max: 600, advanced: true,
      help: 'Seconds. Lets the picture settle before anything covers it.',
    },
    {
      key: 'edgeMargin', label: 'Margin from the screen edge', type: 'number',
      default: 2, min: 0, max: 20, advanced: true,
      help: 'Percent. Keeps the advert clear of a panel that overscans.',
    },
    {
      key: 'adScale', label: 'Fit the advert to its box', type: 'select', default: 'contain', advanced: true,
      options: [
        { value: 'contain', label: 'Whole advert' },
        { value: 'cover', label: 'Fill the box' },
        { value: 'fill', label: 'Stretch' },
        { value: 'none', label: 'Original size' },
      ],
    },
    {
      key: 'adBackdrop', label: 'Advert background', type: 'color', default: '#000000', advanced: true,
      help: 'Shows behind an advert that does not fill its box.',
    },
    {
      key: 'adRadius', label: 'Corner radius', type: 'number', default: 0, min: 0, max: 48, advanced: true,
      help: 'Pixels.',
    },
    {
      key: 'allowVideoAds', label: 'Allow video adverts', type: 'checkbox', default: false, advanced: true,
      help: 'Off by default. Most signage panels decode one video at a time, so a video advert over ' +
        'a live feed shows as a black box. Video items are skipped while this is off.',
    },
    {
      key: 'reconnectSeconds', label: 'Reconnect a dead feed after', type: 'number',
      default: 15, min: 0, max: 600, advanced: true,
      help: 'Seconds, or 0 to never retry.',
    },
    {
      key: 'reloadMinutes', label: 'Reload the page every', type: 'number',
      default: 0, min: 0, max: 1440, advanced: true,
      help: 'Minutes, or 0 to never. Worth setting for an MJPEG camera, which holds one connection ' +
        'open and slowly grows in memory over days.',
    },
    {
      key: 'offlineMessage', label: 'Message when the feed is down', type: 'text',
      default: 'Live feed unavailable', maxLength: 120, advanced: true,
    },
  ],

  validate(config) {
    const interval = Number(config.intervalSeconds ?? 30)
    const play = Number(config.playSeconds ?? 10)
    const rest = Number(config.restSeconds ?? 1)
    const url = String(config.streamUrl ?? '')
    const source = String(config.sourceType ?? 'mp4')

    // The misconfiguration that matters: an advert that is still on screen when
    // the next one is due never leaves, and the live feed is gone for good.
    if (play >= interval) {
      return 'Play for must be shorter than Ads interval, or the advert would never leave the screen.'
    }
    if (play + rest > interval) {
      return `With these numbers an advert would appear every ${play + rest} seconds, not every ` +
        `${interval}. Raise the interval, or lower Play for / Rest for.`
    }

    const isM3u8 = /\.m3u8(\?|$)/i.test(url)
    if (source === 'hls' && !isM3u8) return 'An HLS source needs a .m3u8 address.'
    if (source === 'mp4' && isM3u8) return 'That is an HLS address — set Live source to HLS stream.'

    // Works perfectly on the machine this was configured on, and is dead on
    // every screen. Much cheaper to catch here than on a wall.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[?::1\]?)([:/]|$)/i.test(url)) {
      return 'A screen cannot reach localhost. Use this computer\'s network address, or the camera\'s own.'
    }
    return null
  },

  // No refresh hook: the screen opens the feed itself and polls the manager for
  // the advert list, so there is no third-party call for the manager to make.

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    // Hidden fields are deleted from config, and a cleared value is stored as
    // '', so every read needs a fallback and a clamp of its own.
    const num = (v: unknown, d: number, lo: number, hi: number) => {
      const n = Number(v)
      return Math.max(lo, Math.min(hi, Number.isFinite(n) && v !== '' && v !== null ? n : d))
    }

    const interval = num(c.intervalSeconds, 30, 5, 3600)
    const play = num(c.playSeconds, 10, 1, 300)
    const rest = num(c.restSeconds, 1, 1, 300)
    // Kept as belt-and-braces: validate() rejects this at save time, but a
    // hand-edited database must still not produce an advert that never leaves.
    const gap = Math.max(interval - play, rest)

    const cfg = {
      sourceType: String(c.sourceType ?? 'mp4'),
      streamUrl: String(c.streamUrl ?? ''),
      videoFit: String(c.videoFit ?? 'contain'),
      hlsMessage: HLS_MESSAGE,
      offlineMessage: String(c.offlineMessage ?? 'Live feed unavailable'),

      // Relative on purpose. This is an XHR from this page, so it must be
      // same-origin with whatever address the screen actually used to load it.
      // The manager's own guess at its LAN address is only a guess: a PC with a
      // VPN, a second NIC or a Docker bridge has several, and if the screen
      // reached us on a different one the poll is cross-origin, is blocked, and
      // fails silently — the feed plays and no advert ever appears.
      adsUrl: `/tv/zone/project/${encodeURIComponent(String(c.adsProjectId ?? ''))}/items`,
      // Slow: the advert list is edited by a person, not a feed.
      pollMs: 120_000,

      playMs: play * 1000,
      cycleMs: (play + gap) * 1000,
      startDelayMs: num(c.startDelaySeconds, 5, 0, 600) * 1000,

      position: String(c.position ?? 'bottom-right'),
      customTop: num(c.customTop, 70, 0, 100),
      customLeft: num(c.customLeft, 70, 0, 100),
      sizeUnit: String(c.sizeUnit ?? 'percent'),
      adWidthPct: num(c.adWidthPct, 20, 1, 100),
      adHeightPct: num(c.adHeightPct, 12, 1, 100),
      adWidthPx: num(c.adWidthPx, 384, 20, 3840),
      adHeightPx: num(c.adHeightPx, 216, 20, 2160),
      edgeMargin: num(c.edgeMargin, 2, 0, 20),

      animation: String(c.animation ?? 'fade'),
      adScale: String(c.adScale ?? 'contain'),
      adBackdrop: /^#[0-9a-fA-F]{6}$/.test(String(c.adBackdrop)) ? String(c.adBackdrop) : '',
      adRadius: num(c.adRadius, 0, 0, 48),
      allowVideoAds: c.allowVideoAds === true,

      reconnectMs: num(c.reconnectSeconds, 15, 0, 600) * 1000,
      reloadMs: num(c.reloadMinutes, 0, 0, 1440) * 60_000,
    }

    return appPage({
      title: `Live TV — ${escapeHtml(ctx.instance.name)}`,
      bg: '#000000',
      fontCss: ctx.fontCss,
      css: LIVETV_CSS,
      body:
        '<div id="root">' +
        '<div id="feed"></div>' +
        '<div id="msg" class="off"><div id="msgtext"></div></div>' +
        '<div id="adbox"><div id="adcard"></div></div>' +
        '</div>',
      script: `var CFG = ${jsonLiteral(cfg)};\n` + LIVETV_JS,
    })
  },
}
