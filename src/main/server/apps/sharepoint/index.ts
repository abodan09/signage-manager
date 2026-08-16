import crypto from 'crypto'
import type { AppContext, AppDefinition, AppRefreshResult } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'
import { parseSharePointUrl, sharePointUrlProblem } from './parse'
import { PARTITION } from './session'

// SharePoint.
//
// The screens are shown a photograph of the page, not the page. That is not a
// shortcut, it is the only thing that works: SharePoint refuses to be displayed
// inside another site, and its page bundle is written in a JavaScript dialect
// newer than any TV browser we support, so a panel gets a blank screen rather
// than a broken one. The product we are modelling hits the same wall and
// responds by not supporting LG or Samsung panels at all. Photographing the
// page on this PC — which runs a current Chromium — works on every screen we
// ship to.
//
// The trade the operator is making, and which the note field states plainly: the
// screens are as current as this PC is awake, and what they show is whatever the
// signed-in account can see.

interface Capture {
  /** Path under /app-media, already absolute by the time a page sees it. */
  path: string
  capturedAt: string
  width: number
  height: number
  whole: boolean
}

/** The file name for an instance's capture.
 *
 *  A random name rather than the instance id, and this matters: /app-media is
 *  served to the whole LAN with no authentication, because the TVs need it that
 *  way. An intranet page photographed here is a file on an open web server, so
 *  its address should at least not be guessable from anything else the operator
 *  can see. */
function captureName(instanceId: string): string {
  return crypto.createHash('sha256')
    .update(`sharepoint:${instanceId}`)
    .digest('hex').slice(0, 32) + '.png'
}

export const sharepoint: AppDefinition = {
  id: 'sharepoint',
  name: 'SharePoint',
  icon: '🏢',
  description: 'Put a SharePoint page on your screens — news, announcements and all.',
  category: 'productivity',
  provider: 'microsoft',
  defaultDuration: 30,

  fields: [
    {
      key: 'howto', label: 'How this works', type: 'note',
      help: 'The screens are shown a picture of this page, taken on this computer every few ' +
        'minutes. They show exactly what the signed-in account below can see, so check that ' +
        'everything on the page is safe to put on a wall. The picture is served to your screens ' +
        'over the local network without a password.',
    },
    {
      key: 'account', label: 'Microsoft account', type: 'connection', provider: 'microsoft',
      help: 'Only needed for a private site. A page that anyone can open needs no account.',
    },
    {
      key: 'url', label: 'SharePoint page address', type: 'url', required: true,
      placeholder: 'https://contoso.sharepoint.com/sites/Marketing',
      help: 'Copy it from your browser\'s address bar with the page open.',
    },
    {
      key: 'view', label: 'What to show', type: 'select', default: 'fold',
      options: [
        { value: 'fold', label: 'Top of the page', hint: 'The hero and first news row. Readable across a room.' },
        { value: 'whole', label: 'Whole page, scrolling', hint: 'Slowly scrolls the entire page.' },
      ],
    },
    {
      key: 'refreshMinutes', label: 'Refresh every', type: 'number', default: 15, min: 2, max: 240,
      help: 'Minutes. A news page rarely needs less than 15.',
    },
    {
      key: 'background', label: 'Background behind the page', type: 'color', default: '#ffffff',
      help: 'Shows wherever the picture does not fill the screen.',
    },

    // ── Advanced ──
    {
      key: 'fit', label: 'Fit to screen', type: 'select', default: 'contain', advanced: true,
      showIf: { key: 'view', equals: ['fold'] },
      options: [
        { value: 'contain', label: 'Whole picture' },
        { value: 'cover', label: 'Fill the screen', hint: 'Crops the edges.' },
      ],
    },
    {
      key: 'scrollSpeed', label: 'Scroll speed', type: 'slider', default: 8, min: 1, max: 20,
      marks: ['Slow', 'Fast'], advanced: true,
      showIf: { key: 'view', equals: ['whole'] },
    },
    {
      key: 'captureWidth', label: 'Capture width', type: 'select', default: '1920', advanced: true,
      options: [
        { value: '1280', label: '1280 — larger text' },
        { value: '1920', label: '1920 — matches most screens' },
        { value: '2560', label: '2560 — more on screen, smaller text' },
      ],
      help: 'The window width used to take the picture. Narrower means bigger text on the wall.',
    },
    {
      key: 'zoom', label: 'Page zoom', type: 'select', default: '100', advanced: true,
      options: [
        { value: '75', label: '75%' }, { value: '100', label: '100%' },
        { value: '125', label: '125%' }, { value: '150', label: '150%' },
      ],
    },
    {
      key: 'hideChrome', label: 'Hide SharePoint navigation bars', type: 'checkbox', default: true,
      advanced: true,
      help: 'Leaves just the page content. Unsupported by Microsoft, so it may stop working one day ' +
        '— the page still shows, with its menus.',
    },
    {
      key: 'showUpdated', label: 'Show when it was last updated', type: 'checkbox', default: false,
      advanced: true,
      help: 'A small caption in the corner. Worth turning on where a stale page would mislead.',
    },
  ],

  validate(config) {
    return sharePointUrlProblem(config.url)
  },

  async refresh(ctx: AppContext): Promise<AppRefreshResult> {
    const c = ctx.instance.config
    const parsed = parseSharePointUrl(c.url)
    if (!parsed) throw new Error('No page address set.')

    // Required here rather than imported: this module is loaded by the app
    // registry, which the test suite loads in bare node with no Electron.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { captureUrl } = require('./capture') as typeof import('./capture')

    const minutes = Math.max(2, Math.min(240, Number(c.refreshMinutes) || 15))
    const shot = await captureUrl({
      url: parsed.canonicalUrl,
      width: Number(c.captureWidth) || 1920,
      zoom: Number(c.zoom) || 100,
      whole: c.view === 'whole',
      background: /^#[0-9a-fA-F]{6}$/.test(String(c.background)) ? String(c.background) : '#ffffff',
      hideChrome: c.hideChrome !== false,
    }, PARTITION)

    const name = captureName(ctx.instance.id)
    const data: Capture = {
      path: ctx.writeMedia(name, shot.png),
      capturedAt: new Date().toISOString(),
      width: shot.width,
      height: shot.height,
      whole: c.view === 'whole',
    }
    return { data, ttlSeconds: minutes * 60 }
  },

  /** The page polls this, so the picture can change without a reload.
   *
   *  The path stays relative. The page asking for it is served by this manager,
   *  so a relative path resolves against the address the screen actually
   *  reached us on — where an absolute one bakes in this PC's guess at its own
   *  address, and a machine with a VPN or a second network card has more than
   *  one. Guess wrong and the screen shows a broken image forever. */
  serializeData(ctx: AppContext) {
    const d = ctx.data as Capture | null
    if (!d?.path) return null
    return {
      src: d.path,
      capturedAt: d.capturedAt,
      width: d.width,
      height: d.height,
      whole: d.whole,
    }
  },

  suggestName(ctx: AppContext): string | null {
    const parsed = parseSharePointUrl(ctx.instance.config.url)
    if (!parsed?.sitePath) return null
    const leaf = parsed.sitePath.split('/').filter(Boolean).pop()
    return leaf ? leaf.replace(/[-_]+/g, ' ') : null
  },

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const bg = /^#[0-9a-fA-F]{6}$/.test(String(c.background)) ? String(c.background) : '#ffffff'
    const whole = c.view === 'whole'

    const cfg = {
      // Relative: an XHR from this page must be same-origin with whatever
      // address the screen used to reach us, which is not necessarily the one
      // this PC believes it has.
      dataUrl: `/tv/app/${encodeURIComponent(ctx.instance.id)}/data`,
      pollMs: 60_000,
      whole,
      fit: c.fit === 'cover' ? 'cover' : 'contain',
      // Pixels per second. The slider is 1–20; a page is long and a wall is
      // read at walking pace.
      speed: Math.max(1, Math.min(20, Number(c.scrollSpeed) || 8)) * 4,
      showUpdated: c.showUpdated === true,
      waiting: 'Waiting for the first picture of this page…',
    }

    return appPage({
      title: `SharePoint — ${escapeHtml(ctx.instance.name)}`,
      bg,
      fontCss: ctx.fontCss,
      css: `
body{background:${bg}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:${bg}}
#shot{position:absolute;top:0;left:0;width:100%;display:block}
#shot.fold{height:100%}
#msg{position:absolute;top:50%;left:0;right:0;margin-top:-1em;text-align:center;
  color:#8a8f98;font-size:2.6vh;padding:0 8vw}
#msg.off{display:none}
#stamp{position:absolute;right:1.2vh;bottom:1.2vh;color:#fff;background:rgba(0,0,0,.55);
  font-size:1.6vh;padding:.4em .7em;border-radius:.3em}
#stamp.off{display:none}
`,
      body:
        '<div id="root">' +
        '<img id="shot" alt="">' +
        '<div id="msg"></div>' +
        '<div id="stamp" class="off"></div>' +
        '</div>',
      script: `var CFG = ${jsonLiteral(cfg)};\n` + SHAREPOINT_JS,
    })
  },
}

// Kept out of the emitted script: the compatibility tests scan this text, and a
// comment mentioning a banned construct fails them as surely as using one.
//
// The scroll is a plain `top` offset rather than a compositor transform. This
// page is only ever an image, so there is no video plane to protect — but the
// image can be six thousand pixels tall, and animating a layer that size is
// where an old panel runs out of texture memory. Moving it by layout costs a
// repaint of the visible strip and nothing more.
const SHAREPOINT_JS = `
var shot = document.getElementById('shot');
var msg = document.getElementById('msg');
var stamp = document.getElementById('stamp');
var current = '';
var scrollTimer = null;

function say(text){
  msg.innerHTML = esc(text);
  msg.className = text ? '' : 'off';
}

function stopScroll(){
  if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
}

/* Down, pause, back to the top, pause. A page that snaps back without a rest
   reads as a glitch rather than a loop. */
function startScroll(){
  stopScroll();
  var y = 0, dir = 1, hold = 0;
  scrollTimer = setInterval(function(){
    var over = shot.offsetHeight - window.innerHeight;
    if (over <= 0) { shot.style.top = '0px'; return; }
    if (hold > 0) { hold--; return; }
    y += dir * (CFG.speed / 10);
    if (y >= over) { y = over; dir = -1; hold = 30; }
    else if (y <= 0) { y = 0; dir = 1; hold = 30; }
    shot.style.top = (-Math.round(y)) + 'px';
  }, 100);
}

function markUpdated(d){
  if (!CFG.showUpdated || !d.capturedAt) return;
  var t = new Date(d.capturedAt);
  var hh = t.getHours(), mm = t.getMinutes();
  stamp.innerHTML = 'Updated ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  stamp.className = '';
}

function apply(payload){
  var d = payload && payload.data;
  if (!d || !d.src) {
    /* Never blank a working picture because one poll came back empty. */
    if (!current) say(CFG.waiting);
    return;
  }
  if (d.src === current) { markUpdated(d); return; }

  /* Loaded out of sight first, and only shown once it is known good. Assigning
     straight to the visible element would put a broken-image icon on the wall
     for however long the next capture takes, and would throw away a picture
     that was working perfectly. */
  var pre = new Image();
  pre.onload = function(){
    current = d.src;
    shot.className = CFG.whole ? '' : 'fold';
    if (!CFG.whole) shot.style.objectFit = CFG.fit;
    shot.style.top = '0px';
    shot.src = d.src;
    say('');
    if (CFG.whole) startScroll(); else stopScroll();
    markUpdated(d);
  };
  pre.onerror = function(){
    if (!current) say('Could not load the picture of this page.');
  };
  pre.src = d.src;
}

say(CFG.waiting);
pollData(CFG.dataUrl, CFG.pollMs, apply);
`
