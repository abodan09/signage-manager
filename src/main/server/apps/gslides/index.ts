import type { AppContext, AppDefinition } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'

// Google Slides.
//
// Google's "Publish to the web" dialog puts auto-advance, loop and start into
// the URL itself — ?start=true&loop=true&delayms=5000. That is unusually
// generous, and it means the timing does not have to be baked into the link:
// this app parses whatever was pasted, then writes those three parameters
// itself. An operator who wants eight seconds instead of five changes it here
// rather than going back to Google, republishing, and re-pasting.
//
// A published deck also keeps itself current — edits in Slides appear without
// republishing — so the only thing left for the manager to do is reload
// occasionally, since a screen that has held the same iframe for a week will
// otherwise sit on whatever it first fetched.

/** Published decks live under /d/e/<pubId>/; a private one is /d/<docId>/. The
 *  /e/ is the whole difference and it decides whether a screen can show it. */
const PUBLISHED_RE = /docs\.google\.com\/presentation\/d\/e\/([A-Za-z0-9_-]+)/i
const PRIVATE_RE = /docs\.google\.com\/presentation\/d\/([A-Za-z0-9_-]+)/i

export interface SlidesLink {
  kind: 'published' | 'private'
  id: string
  /** Embed form, without timing parameters — those are added at render time. */
  url: string
}

export function parseGoogleSlides(input: string): SlidesLink | null {
  const raw = String(input ?? '').trim().replace(/&amp;/g, '&')
  if (!raw) return null

  const pub = PUBLISHED_RE.exec(raw)
  if (pub) {
    return {
      kind: 'published',
      id: pub[1],
      // /embed rather than /pub: both work, but /embed omits the Google
      // Docs frame, which is chrome nobody wants on a wall.
      url: `https://docs.google.com/presentation/d/e/${pub[1]}/embed`,
    }
  }

  const priv = PRIVATE_RE.exec(raw)
  if (priv) return { kind: 'private', id: priv[1], url: raw.split(/[?#]/)[0] }

  return null
}

export const gslides: AppDefinition = {
  id: 'gslides',
  name: 'Google Slides',
  icon: '📑',
  description: 'Play a published Google Slides deck, updating itself as you edit it.',
  category: 'productivity',
  defaultDuration: 60,

  fields: [
    {
      key: 'howto', label: 'Publish the deck first', type: 'note',
      help: 'In Google Slides: File → Share → Publish to the web, then copy the link. '
        + 'A normal /edit or /view link needs a Google sign-in, and a screen has nobody to sign in as. '
        + 'Publishing makes the deck readable by anyone with the URL — check that suits the content. '
        + 'Whatever timing you pick in that dialog is overridden by the settings here, so you never need to republish to change it.',
    },
    {
      key: 'link', label: 'Published link or embed code', type: 'textarea', required: true, maxLength: 2000,
      placeholder: 'https://docs.google.com/presentation/d/e/2PACX-1vT…/pub?start=true&loop=true&delayms=5000',
      help: 'Paste the link from the Publish to the web dialog, or the whole iframe snippet.',
    },
    {
      key: 'secondsPerSlide', label: 'Seconds per slide', type: 'number', default: 10, min: 1, max: 600,
      help: 'Changed here, not in Google — no republishing needed.',
    },
    {
      key: 'loop', label: 'Restart after the last slide', type: 'checkbox', default: true,
    },

    // ── Advanced ──
    {
      key: 'advanceAfterPass', label: 'Move on after one pass', type: 'checkbox', default: false, advanced: true,
      help: 'Hand back to the playlist once the deck has played through. Needs the slide count below.',
    },
    {
      key: 'slideCount', label: 'Slides in this deck', type: 'number', default: 0, min: 0, max: 500, advanced: true,
      help: 'Only needed for the setting above — the deck plays inside Google, so the app cannot count them.',
      showIf: { key: 'advanceAfterPass', equals: [true] },
    },
    {
      key: 'reloadMinutes', label: 'Reload every', type: 'number', default: 60, min: 5, max: 1440, advanced: true,
      help: 'Minutes. A screen left running for days would otherwise keep showing the copy it first fetched.',
    },
    {
      key: 'background', label: 'Letterbox colour', type: 'color', default: '#000000', advanced: true,
    },
  ],

  validate(config) {
    const link = parseGoogleSlides(String(config.link ?? ''))
    if (!link) {
      return 'That is not a Google Slides link. Use File → Share → Publish to the web and paste the link it gives you.'
    }
    if (link.kind !== 'published') {
      // Refused at save time: an /edit link shows a Google sign-in page on the
      // wall, which looks like the screen is broken and gets reported late.
      return 'That is a normal editing link, which asks the viewer to sign in to Google — a screen cannot. '
        + 'Use File → Share → Publish to the web and paste that link instead.'
    }
    if (config.advanceAfterPass === true && !Number(config.slideCount ?? 0)) {
      return 'To move on after one pass, tell the app how many slides the deck has.'
    }
    return null
  },

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const link = parseGoogleSlides(String(c.link ?? ''))
    const bg = /^#[0-9a-fA-F]{6}$/.test(String(c.background)) ? String(c.background) : '#000000'
    const delayMs = Math.max(1, Math.min(600, Number(c.secondsPerSlide ?? 10))) * 1000
    const loop = c.loop !== false

    // The three parameters Google's own dialog writes, set from here so the
    // operator never has to republish to change the pace.
    const url = link
      ? `${link.url}?start=true&loop=${loop ? 'true' : 'false'}&delayms=${delayMs}`
      : ''

    const slides = Number(c.slideCount ?? 0)
    const cfg = {
      url,
      reloadMs: Math.max(5, Math.min(1440, Number(c.reloadMinutes ?? 60))) * 60_000,
      // One pass is slides × dwell, plus a slide's grace so the last one is
      // actually seen rather than cut at the moment it appears.
      passMs: c.advanceAfterPass === true && slides > 0 ? slides * delayMs + delayMs : 0,
      instanceId: ctx.instance.id,
      missing: 'This Google Slides deck could not be loaded',
      hint: 'Check the deck is still published to the web, and that this screen has internet.',
    }

    return appPage({
      title: `Google Slides — ${escapeHtml(ctx.instance.name)}`,
      bg,
      fontCss: ctx.fontCss,
      css: `
body{background:${bg}}
#stage{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:${bg}}
#stage iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}
#warn{position:absolute;top:50%;left:0;right:0;text-align:center;margin-top:-2em;padding:0 8vw;
      color:#cbd5e1;font-size:3vh;display:none}
#warn.on{display:block}
#warn small{display:block;margin-top:1.4vh;font-size:2vh;opacity:.7}
`,
      body: '<div id="stage"><div id="warn"></div></div>',
      script: `var CFG = ${jsonLiteral(cfg)};\n` + SLIDES_JS,
    })
  },
}

const SLIDES_JS = `
var stage = document.getElementById('stage');
var warn = document.getElementById('warn');
var frame = null;
var failTimer = null;

function fail(){
  warn.innerHTML = esc(CFG.missing) + '<small>' + esc(CFG.hint) + '</small>';
  warn.className = 'on';
}

function load(){
  if (!CFG.url) { fail(); return; }
  if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
  frame = document.createElement('iframe');
  frame.setAttribute('allowfullscreen', 'true');
  frame.setAttribute('frameborder', '0');
  frame.onload = function(){ clearTimeout(failTimer); warn.className = ''; };
  stage.appendChild(frame);
  frame.src = CFG.url;
  clearTimeout(failTimer);
  failTimer = setTimeout(fail, 20000);
}

load();

/* Reloading restarts the deck from slide one, so it is deliberately slow —
   the point is to pick up edits over days, not to interrupt a running show. */
setInterval(load, CFG.reloadMs);

if (CFG.passMs > 0) {
  setTimeout(function(){
    try {
      window.parent.postMessage({ type: 'signage:ended', instanceId: CFG.instanceId }, window.location.origin);
    } catch (e) {}
  }, CFG.passMs);
}
`
