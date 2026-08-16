import type { AppContext, AppDefinition } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'

// Canva.
//
// There are two ways to get a Canva design onto a screen, and they are not
// equal:
//
//   Export.     Download a PNG or MP4 from Canva and add it to the Content
//               Library. It caches, it plays with the internet unplugged, and
//               the player has native image and video paths for it. This is
//               the better route for almost everyone, and it needs no app at
//               all — which is why this app does not reimplement it badly.
//   Live embed. Paste Canva's embed code and the screen shows the design as it
//               is right now, so edits in Canva appear without re-exporting.
//               The cost is that it needs a working internet connection every
//               time it plays.
//
// This app is the live embed, and it does one thing the reference product
// cannot: a multi-page design plays through its pages on its own. Canva embeds
// never advance by themselves, and the documented workaround is to create one
// asset per page and sequence them in a playlist. Here the page number is a
// setting and the app cycles them.

const DESIGN_RE = /canva\.com\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/

/** Accepts the whole iframe snippet Canva's Embed panel produces, or just the
 *  design link. Operators paste whichever they happen to have copied. */
export function parseCanva(input: string): { id: string; token: string; url: string } | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const m = DESIGN_RE.exec(raw)
  if (!m) return null
  return {
    id: m[1],
    token: m[2],
    // Rebuilt rather than reused: the pasted link often carries utm parameters
    // and sometimes points at /watch or /edit, none of which embed.
    url: `https://www.canva.com/design/${m[1]}/${m[2]}/view?embed`,
  }
}

export const canva: AppDefinition = {
  id: 'canva',
  name: 'Canva',
  icon: '🎨',
  description: 'Show a Canva design live, so edits in Canva appear on screen without re-exporting.',
  category: 'media',
  defaultDuration: 30,

  fields: [
    {
      key: 'howto', label: 'Two ways to show a Canva design', type: 'note',
      help: 'This app shows a design LIVE, so changes in Canva appear by themselves — but the screen needs internet every time it plays. '
        + 'If you would rather it kept working offline, export a PNG or MP4 from Canva instead and add it to the Content Library; that caches on the screen and is the more reliable choice.',
    },
    {
      key: 'embed', label: 'Embed code or design link', type: 'textarea', required: true, maxLength: 2000,
      placeholder: '<iframe … src="https://www.canva.com/design/DAF…/view?embed"></iframe>',
      help: 'In Canva: Share → More → Embed, then copy the HTML. Pasting the plain design link works too.',
    },
    {
      key: 'pages', label: 'Pages in this design', type: 'number', default: 1, min: 1, max: 50,
      help: 'Set this above 1 and the app plays through the pages by itself, which a Canva embed will not do on its own.',
    },
    {
      key: 'pageSeconds', label: 'Seconds per page', type: 'number', default: 20, min: 3, max: 600,
      help: 'Only used when the design has more than one page.',
    },

    // ── Advanced ──
    {
      key: 'advanceAfterPass', label: 'Move on after one pass', type: 'checkbox', default: false, advanced: true,
      help: 'Hand back to the playlist as soon as every page has been shown once, instead of waiting out the slot.',
    },
    {
      key: 'background', label: 'Letterbox colour', type: 'color', default: '#ffffff', advanced: true,
      help: 'Fills the edges when the design shape does not match the screen. Canva designs are usually on white.',
    },
    {
      key: 'startPage', label: 'Start on page', type: 'number', default: 1, min: 1, max: 50, advanced: true,
      help: 'Useful when you want one screen showing page 3 while another shows page 1.',
    },
  ],

  validate(config) {
    if (!parseCanva(String(config.embed ?? ''))) {
      return 'That is not a Canva embed. In Canva use Share → More → Embed and copy the HTML, or paste the design link.'
    }
    const pages = Number(config.pages ?? 1)
    const start = Number(config.startPage ?? 1)
    if (start > pages) return `Start page cannot be higher than the number of pages (${pages}).`
    return null
  },

  // No refresh hook: there is nothing for the manager to fetch. The design
  // lives at Canva and the screen loads it directly, which is exactly why this
  // route needs internet where an exported file would not.

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const parsed = parseCanva(String(c.embed ?? ''))
    const pages = Math.max(1, Math.min(50, Number(c.pages ?? 1)))
    const startPage = Math.max(1, Math.min(pages, Number(c.startPage ?? 1)))

    const cfg = {
      url: parsed?.url ?? '',
      pages,
      startPage,
      pageMs: Math.max(3, Math.min(600, Number(c.pageSeconds ?? 20))) * 1000,
      advanceAfterPass: c.advanceAfterPass === true,
      instanceId: ctx.instance.id,
      missing: 'This Canva design could not be loaded',
      hint: 'Check the design is shared publicly in Canva, and that this screen has internet.',
    }

    const bg = /^#[0-9a-fA-F]{6}$/.test(String(c.background)) ? String(c.background) : '#ffffff'

    return appPage({
      title: `Canva — ${escapeHtml(ctx.instance.name)}`,
      bg,
      fontCss: ctx.fontCss,
      css: `
body{background:${bg}}
#stage{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:${bg}}
#stage iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}
/* Canva paints its own background, so a slow load shows the letterbox colour
   rather than a black rectangle — which reads as "loading", not "broken". */
#warn{position:absolute;top:50%;left:0;right:0;text-align:center;margin-top:-2em;
      padding:0 8vw;color:#334155;font-size:3vh;display:none}
#warn.on{display:block}
#warn small{display:block;margin-top:1.4vh;font-size:2vh;opacity:.7}
`,
      body: '<div id="stage"><div id="warn"></div></div>',
      script: `var CFG = ${jsonLiteral(cfg)};\n` + CANVA_JS,
    })
  },
}

const CANVA_JS = `
var stage = document.getElementById('stage');
var warn = document.getElementById('warn');
var page = CFG.startPage;
var shown = 0;
var frame = null;
var loadTimer = null;

function fail(){
  warn.innerHTML = esc(CFG.missing) + '<small>' + esc(CFG.hint) + '</small>';
  warn.className = 'on';
}

/* Canva pins a page with a #n fragment, but changing only the fragment does not
   reload an iframe — the browser treats it as same-document navigation. The
   element is replaced instead, which is the only reliable way to move pages. */
function showPage(n){
  if (!CFG.url) { fail(); return; }
  if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
  frame = document.createElement('iframe');
  frame.setAttribute('allowfullscreen', 'allowfullscreen');
  frame.setAttribute('allow', 'fullscreen');
  frame.setAttribute('loading', 'eager');
  frame.onload = function(){ clearTimeout(loadTimer); warn.className = ''; };
  stage.appendChild(frame);
  frame.src = CFG.url + (CFG.pages > 1 ? '#' + n : '');

  /* A design that is not shared publicly renders Canva's own permission page,
     which loads fine — so a load event is not proof of success. The warning
     only appears when nothing loads at all. */
  clearTimeout(loadTimer);
  loadTimer = setTimeout(fail, 12000);
}

function advance(){
  shown++;
  if (CFG.advanceAfterPass && shown >= CFG.pages) {
    try {
      window.parent.postMessage({ type: 'signage:ended', instanceId: CFG.instanceId }, window.location.origin);
    } catch (e) {}
    return;
  }
  page = page >= CFG.pages ? 1 : page + 1;
  showPage(page);
  setTimeout(advance, CFG.pageMs);
}

showPage(page);
if (CFG.pages > 1 || CFG.advanceAfterPass) setTimeout(advance, CFG.pageMs);
`
