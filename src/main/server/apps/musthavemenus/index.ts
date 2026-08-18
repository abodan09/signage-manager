import type { AppContext, AppDefinition, AppRefreshResult } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'

// MustHaveMenus.
//
// The operator designs a menu at musthavemenus.com, presses Share, and gets a
// link like https://mhme.nu/design/<uuid>. This app puts that menu on a screen.
//
// The menu is shown LIVE, so a republished design reaches the screens by
// itself — and, as with the Canva app, that means the screen needs internet
// every time it plays. There is no honest way around it here: MustHaveMenus
// publishes no image or PDF of a shared design (every export route is inside
// their signed-in editor), so there is nothing for the manager to cache.
//
// What the manager DOES do is fetch the page itself, once per update interval,
// because three things about that page cannot be handled from a TV:
//
//   A dead link answers 200. A design that was never published, or has been
//   revoked, returns a perfectly ordinary "Sorry!" page with an HTTP 200 on
//   it. Nothing downstream can tell that from a menu, so the operator would
//   hang a blank white screen in a dining room and not find out. The manager
//   reads the page and refuses the link at save time instead.
//
//   Page numbers are not checked by anyone. ?page=N is applied by a script on
//   their page that deletes every page except N — ask for page 9 of a 2-page
//   menu and it deletes all of them, then trips over the empty list and leaves
//   a white screen. So the manager counts the real pages and the number is
//   clamped to them.
//
//   Their scaling does not run on a TV. The script sizes the menu to the
//   window through window.visualViewport, which no browser before Chrome 61
//   has — which is every panel this product supports. It throws, the menu is
//   never scaled, and a 630px menu sits in the corner of a 1080p screen. The
//   fix is to stop asking it to scale: the frame is given the design's own
//   pixel size, so their script computes a scale of 1 whether it runs or not,
//   and this page scales the frame instead.

const HOSTS = ['mhme.nu', 'ohbz.com', 'www.musthavemenus.com', 'musthavemenus.com']

export interface MenuPage {
  n: number
  /** The design's own pixel size, which is what the frame is given. */
  w: number
  h: number
}

/** Accepts the Share link as pasted. Their two hosts serve the same design and
 *  the page rewrites itself to the canonical one, so either is kept as typed
 *  rather than rewritten — an operator comparing the setting with their
 *  clipboard should see the same string. */
export function parseShareUrl(input: unknown): { url: string; id: string } | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  let parsed: URL
  try { parsed = new URL(raw) } catch { return null }
  if (parsed.protocol !== 'https:') return null
  if (HOSTS.indexOf(parsed.host.toLowerCase()) === -1) return null
  const m = /\/design\/([0-9a-f-]{8,64})/i.exec(parsed.pathname)
  if (!m) return null
  return { url: `${parsed.origin}${parsed.pathname}`, id: m[1] }
}

/** Every page of the design, with the size each was drawn at.
 *
 *  Their markup is server-rendered and every page of a multi-page menu is in
 *  the document whatever ?page says — the parameter only drives a script that
 *  removes the others — so one fetch counts and measures the lot. */
export function readDesign(html: string): MenuPage[] {
  const pages: MenuPage[] = []
  const re = /<div\b[^>]*\bid="page-(\d+)"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const tag = m[0]
    if (!/class="[^"]*\bpage\b[^"]*"/i.test(tag)) continue

    // The size is in the element's own inline style. `[;"\s]` in front so that
    // max-width and the like cannot be mistaken for it.
    const w = /[;"\s]width:\s*([\d.]+)px/i.exec(tag)
    const h = /[;"\s]height:\s*([\d.]+)px/i.exec(tag)
    let width = w ? Math.round(Number(w[1])) : 0
    let height = h ? Math.round(Number(h[1])) : 0

    // data-ratio is width/height and is present even when the style is not,
    // so a page still lands on screen the right shape.
    const r = /data-ratio="([\d.]+)"/i.exec(tag)
    const ratio = r ? Number(r[1]) : 0
    if (!width && height && ratio > 0) width = Math.round(height * ratio)
    if (!height && width && ratio > 0) height = Math.round(width / ratio)
    if (!width || !height) {
      if (!(ratio > 0)) continue
      width = 1000
      height = Math.round(1000 / ratio)
    }
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue
    pages.push({ n: Number(m[1]), w: width, h: height })
  }
  pages.sort((a, b) => a.n - b.n)
  return pages
}

async function fetchDesign(url: string): Promise<MenuPage[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25_000)
  let html: string
  try {
    // No Origin header, which matters: their edge answers 403 to any request
    // that carries one. A server fetch does not, which is the only reason the
    // manager can read this at all.
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'SignageManager/1.0' } })
    if (!res.ok) throw new Error(`MustHaveMenus answered ${res.status}.`)
    html = await res.text()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(/abort/i.test(msg) ? 'MustHaveMenus did not answer in time.' : msg)
  } finally {
    clearTimeout(timer)
  }

  const pages = readDesign(html)
  if (!pages.length) {
    // Their "Sorry!" page is served with a 200, so this is the only way to
    // tell a revoked or unpublished design from a real one.
    throw new Error(
      'That link does not open a published menu. In MustHaveMenus, open the design, press Publish, '
      + 'then copy the Share link again.',
    )
  }
  return pages
}

export const musthavemenus: AppDefinition = {
  id: 'musthavemenus',
  name: 'MustHaveMenus',
  icon: '🍽️',
  description: 'Show a menu you designed at MustHaveMenus, updated whenever you republish it.',
  category: 'media',
  defaultDuration: 30,

  fields: [
    {
      key: 'howto', label: 'Getting the link', type: 'note',
      help: 'In MustHaveMenus: open your design, press Share, and copy the Share link. '
        + 'The menu is shown live, so the screen needs internet every time it plays — and after you edit a design '
        + 'you must press Publish in MustHaveMenus, or the screens keep showing the version you published last.',
    },
    {
      key: 'url', label: 'Share link', type: 'url', required: true,
      placeholder: 'https://mhme.nu/design/258f48b4-85c6-4002-9a45-19d4ebb7c123',
      help: 'The link from the Share button. It looks like mhme.nu/design/… or ohbz.com/design/….',
    },
    {
      key: 'pageMode', label: 'Which page to show', type: 'select', required: true, default: 'one',
      options: [
        { value: 'one', label: 'One page' },
        { value: 'all', label: 'All pages in turn', hint: 'Plays through the whole menu and starts again' },
      ],
    },
    {
      key: 'menuPage', label: 'Menu page', type: 'number', default: 1, min: 1, max: 50,
      help: 'Which page of the design to show. Checked against the real page count when you save.',
      showIf: { key: 'pageMode', equals: ['one'] },
    },
    {
      key: 'pageSeconds', label: 'Seconds per page', type: 'number', default: 15, min: 3, max: 600,
      showIf: { key: 'pageMode', equals: ['all'] },
    },
    {
      key: 'advanceAfterPass', label: 'Move on after one pass', type: 'checkbox', default: false, advanced: true,
      help: 'Hand back to the playlist as soon as every page has been shown once, instead of waiting out the slot. '
        + 'Without this, give the menu a slot long enough for every page — five pages at 15 seconds needs 75.',
      showIf: { key: 'pageMode', equals: ['all'] },
    },
    {
      key: 'fit', label: 'How the menu fits the screen', type: 'select', default: 'contain',
      options: [
        { value: 'contain', label: 'Whole menu', hint: 'Everything visible, with margins where the shapes differ' },
        { value: 'cover', label: 'Fill the screen', hint: 'No margins; the edges of the menu are cropped' },
        { value: 'width', label: 'Fit the width', hint: 'For a tall menu on a portrait screen' },
      ],
      help: 'A menu is drawn at its own shape, which is rarely the shape of the screen.',
    },
    {
      key: 'background', label: 'Margin colour', type: 'color', default: '#ffffff',
      help: 'What shows around the menu when its shape does not match the screen.',
    },
    {
      key: 'updateSeconds', label: 'Check for updates every', type: 'number',
      default: 600, min: 60, max: 86400, advanced: true,
      help: 'Seconds. After you republish a design in MustHaveMenus, this is how long the screens take to notice.',
    },
  ],

  validate(config) {
    if (!parseShareUrl(config.url)) {
      return 'That is not a MustHaveMenus share link. It should look like https://mhme.nu/design/…'
    }
    return null
  },

  async refresh(ctx: AppContext): Promise<AppRefreshResult> {
    const c = ctx.instance.config
    const link = parseShareUrl(c.url)
    if (!link) throw new Error('That is not a MustHaveMenus share link.')

    const pages = await fetchDesign(link.url)

    // Refused rather than quietly clamped: their own script empties the page
    // when asked for one that is not there, and a white screen in a dining
    // room is the kind of failure nobody reports for a week.
    const wanted = Math.round(Number(c.menuPage ?? 1)) || 1
    if (String(c.pageMode ?? 'one') === 'one' && wanted > pages.length) {
      throw new Error(
        `That menu has ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}, so page ${wanted} cannot be shown.`,
      )
    }

    return {
      data: { url: link.url, pages },
      ttlSeconds: Math.max(60, Math.min(86_400, Math.round(Number(c.updateSeconds ?? 600)) || 600)),
    }
  },

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const link = parseShareUrl(c.url)
    const data = (ctx.data ?? null) as { url?: string; pages?: MenuPage[] } | null
    const pages = data?.pages?.length ? data.pages : []
    const background = /^#[0-9a-fA-F]{6}$/.test(String(c.background)) ? String(c.background) : '#ffffff'

    const all = String(c.pageMode ?? 'one') === 'all'
    const startPage = all ? (pages[0]?.n ?? 1) : (Math.round(Number(c.menuPage ?? 1)) || 1)

    const cfg = {
      url: link?.url ?? '',
      pages,
      all,
      startPage,
      pageMs: Math.max(3, Math.min(600, Math.round(Number(c.pageSeconds ?? 15)) || 15)) * 1000,
      // Reloading the frame is the only way a republished design reaches the
      // screen; their page is served no-store, so a reload really refetches.
      reloadMs: Math.max(60, Math.min(86_400, Math.round(Number(c.updateSeconds ?? 600)) || 600)) * 1000,
      fit: String(c.fit ?? 'contain'),
      advanceAfterPass: all && c.advanceAfterPass === true,
      instanceId: ctx.instance.id,
      dataUrl: `${ctx.baseUrl}/tv/app/${ctx.instance.id}/data`,
      errorMessage: 'That menu is not available',
    }

    return appPage({
      title: `MustHaveMenus — ${escapeHtml(ctx.instance.name)}`,
      bg: background,
      fontCss: ctx.fontCss,
      css: `
body{background:${background}}
#stage{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden}
#stage iframe{position:absolute;left:50%;top:50%;border:0;display:block}
#msg{position:absolute;top:50%;left:0;right:0;text-align:center;
     font-size:3vh;color:#607d8b;padding:0 8%;margin-top:-1em}
`,
      body: '<div id="stage"></div>',
      script: `var CFG = ${jsonLiteral(cfg)};\n` + MENU_JS,
    })
  },

  suggestName(ctx: AppContext) {
    const data = (ctx.data ?? null) as { pages?: MenuPage[] } | null
    const n = data?.pages?.length ?? 0
    return n > 1 ? `Menu (${n} pages)` : null
  },
}

/* Chrome 53 floor: var only, no arrow functions, no template literals, no
   fetch. transform IS used — this page holds an iframe, never a <video>, so
   the player's no-transform rule does not apply to it. */
const MENU_JS = `
var stage = document.getElementById('stage');
var frame = null, pages = CFG.pages || [], page = CFG.startPage, timer = null, reload = null;

function msg(text){ stage.innerHTML = '<div id="msg">' + esc(text) + '</div>'; }

function pageAt(n){
  for (var i = 0; i < pages.length; i++) if (pages[i].n === n) return pages[i];
  return pages.length ? pages[0] : null;
}

/* The design has its own shape and the screen has another. Whole-menu is the
   safe default: a cropped price is worse than a margin. */
function scaleFor(p){
  var sw = window.innerWidth / p.w, sh = window.innerHeight / p.h;
  if (CFG.fit === 'cover') return sw > sh ? sw : sh;
  if (CFG.fit === 'width') return sw;
  return sw < sh ? sw : sh;
}

function place(p){
  if (!frame) return;
  var k = scaleFor(p);
  frame.style.width = p.w + 'px';
  frame.style.height = p.h + 'px';
  frame.style.marginLeft = Math.round(-p.w / 2) + 'px';
  frame.style.marginTop = Math.round(-p.h / 2) + 'px';
  frame.style.webkitTransform = 'scale(' + k + ')';
  frame.style.transform = 'scale(' + k + ')';
}

function show(n){
  var p = pageAt(n);
  if (!CFG.url || !p) { msg(CFG.errorMessage); return; }
  /* Replaced rather than re-pointed: assigning a src an iframe already has is
     not guaranteed to navigate, and that is exactly what a reload does. */
  if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
  frame = document.createElement('iframe');
  frame.setAttribute('frameborder', '0');
  frame.setAttribute('scrolling', 'no');
  stage.appendChild(frame);
  place(p);
  /* The frame is the design's own size, so their script scales by 1 — which is
     also what happens on a TV where their script throws before it can scale at
     all. Either way this page's transform is the only thing sizing the menu. */
  frame.src = CFG.url + (CFG.url.indexOf('?') === -1 ? '?' : '&') +
    'page=' + n + '&_t=' + (new Date()).getTime();
}

function advance(){
  if (!pages.length) return;
  var i = 0;
  for (var k = 0; k < pages.length; k++) if (pages[k].n === page) i = k;
  /* Wrapping back to the first page is one full pass. A menu cut off halfway
     is worse than one shown twice, so the playlist is handed back here rather
     than left to time the slot. */
  if (i + 1 >= pages.length && CFG.advanceAfterPass) {
    try {
      window.parent.postMessage({ type: 'signage:ended', instanceId: CFG.instanceId }, window.location.origin);
    } catch (e) {}
    return;
  }
  page = pages[(i + 1) % pages.length].n;
  show(page);
  timer = setTimeout(advance, CFG.pageMs);
}

var resizeTimer = null;
window.addEventListener('resize', function(){
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function(){ var p = pageAt(page); if (p) place(p); }, 250);
});

function onPayload(res){
  var d = res && res.data;
  if (!d || !d.pages || !d.pages.length) return;
  /* Only rebuild when the design itself changed — a menu must not blink every
     time the poll comes back with the same thing. */
  var key = d.pages.length + ':' + d.pages[0].w + 'x' + d.pages[0].h + ':' + d.url;
  if (key === onPayload.last) return;
  onPayload.last = key;
  pages = d.pages;
  if (!pageAt(page)) page = pages[0].n;
  show(page);
}

show(page);
if (CFG.all && pages.length > 1) timer = setTimeout(advance, CFG.pageMs);
/* A republished design is picked up by reloading the frame; the poll only
   notices structural changes, such as a page being added. */
reload = setInterval(function(){ show(page); }, CFG.reloadMs);
pollData(CFG.dataUrl, 300000, onPayload);
`
