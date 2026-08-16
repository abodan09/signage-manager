import type { AppContext, AppDefinition } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'

// Power BI.
//
// Two constraints shape this, and they pull in opposite directions.
//
// Auth. Unlike Meta, Microsoft Entra does support loopback redirects and PKCE,
// so a desktop app genuinely can complete an OAuth flow on its own — no broker
// needed. But holding a user token is not enough to put a report on a TV:
// embedding a *secured* report needs an embed token minted per session, which
// needs an Entra app registration and, for non-interactive screens, Power BI
// Embedded capacity. That is a purchase and an IT project, not a setting.
//
// Rendering. A Power BI report is a heavyweight modern web application. The
// TV browsers this product supports go back to Chrome 53, and they will not
// run it. Nothing in this app can change that, so it says so plainly rather
// than shipping something that works on the developer's laptop and fails in a
// customer's lobby.
//
// What is left is the route that actually works today and is what most
// signage deployments use: a link that renders without a signed-in session.
// The app makes that link behave — chrome hidden, the right page, refreshed on
// a schedule — and is honest about the rest.

const PUBLIC_RE = /app\.powerbi\.com\/view\?r=([A-Za-z0-9%._-]+)/i
const EMBED_RE = /app\.powerbi\.com\/reportEmbed\?([^"'\s]+)/i
const REPORT_RE = /app\.powerbi\.com\/(?:groups\/([A-Za-z0-9-]+)\/)?reports\/([A-Za-z0-9-]+)/i

export type PbiKind = 'public' | 'secure' | 'report'

export interface PbiLink {
  kind: PbiKind
  url: string
  reportId?: string
  groupId?: string
}

/** Accepts the whole iframe snippet Power BI's embed dialog produces, or any
 *  of the three link shapes an operator might copy out of the portal. */
export function parsePowerBi(input: string): PbiLink | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null

  const pub = PUBLIC_RE.exec(raw)
  if (pub) return { kind: 'public', url: `https://app.powerbi.com/view?r=${pub[1]}` }

  const emb = EMBED_RE.exec(raw)
  if (emb) {
    const params = new URLSearchParams(emb[1].replace(/&amp;/g, '&'))
    const reportId = params.get('reportId') ?? undefined
    const groupId = params.get('groupId') ?? undefined
    return { kind: 'secure', url: `https://app.powerbi.com/reportEmbed?${emb[1].replace(/&amp;/g, '&')}`, reportId, groupId }
  }

  const rep = REPORT_RE.exec(raw)
  if (rep) return { kind: 'report', url: raw.split(/[?#]/)[0], groupId: rep[1], reportId: rep[2] }

  return null
}

export const powerbi: AppDefinition = {
  id: 'powerbi',
  name: 'Power BI',
  icon: '📊',
  description: 'Keep a Power BI report on screen, refreshed on a schedule.',
  category: 'productivity',
  defaultDuration: 60,

  fields: [
    {
      key: 'howto', label: 'Use a link that needs no sign-in', type: 'note',
      help: 'In Power BI, open the report and choose File → Embed report → Publish to web (public), then paste the link below. '
        + 'A screen has nobody to sign in as, so a "secure embed" link shows a Microsoft login page instead of your report. '
        + 'Publish to web makes the report readable by anyone with the URL — check that is acceptable for the data before you use it.',
    },
    {
      key: 'link', label: 'Report link or embed code', type: 'textarea', required: true, maxLength: 2000,
      placeholder: 'https://app.powerbi.com/view?r=eyJrIjoi…',
      help: 'Paste the Publish to web link, or the whole iframe snippet.',
    },
    {
      key: 'refreshMinutes', label: 'Update every', type: 'number', default: 15, min: 1, max: 1440,
      help: 'Minutes between reloads. Match it to how often the underlying data actually changes — reloading a daily report every minute only costs capacity.',
    },
    {
      key: 'pageName', label: 'Page', type: 'text', maxLength: 120,
      placeholder: 'ReportSection2',
      help: 'Optional. The page name from the report URL, to open on a specific tab.',
    },

    // ── Advanced ──
    {
      key: 'hideChrome', label: 'Hide the Power BI toolbars', type: 'checkbox', default: true, advanced: true,
      help: 'Removes the filter pane, navigation bar and footer so the report fills the screen.',
    },
    {
      key: 'fitToWidth', label: 'Fit the report to the screen', type: 'checkbox', default: true, advanced: true,
    },
    {
      key: 'background', label: 'Letterbox colour', type: 'color', default: '#ffffff', advanced: true,
    },
  ],

  validate(config) {
    const link = parsePowerBi(String(config.link ?? ''))
    if (!link) {
      return 'That is not a Power BI link. In Power BI use File → Embed report → Publish to web and paste the link.'
    }
    if (link.kind !== 'public') {
      // Refused rather than warned: this fails silently on a wall, showing a
      // Microsoft sign-in page to a room full of people, and the operator
      // finds out days later.
      return 'That is a secure embed link, which needs someone signed in to Microsoft in the browser — a screen has nobody to sign in as. '
        + 'Use File → Embed report → Publish to web instead.'
    }
    return null
  },

  // No refresh hook: nothing for the manager to fetch. Power BI renders the
  // report itself, which is also why this app needs the screen to have internet.

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const link = parsePowerBi(String(c.link ?? ''))
    const bg = /^#[0-9a-fA-F]{6}$/.test(String(c.background)) ? String(c.background) : '#ffffff'

    let url = link?.url ?? ''
    if (url) {
      const extra: string[] = []
      if (c.hideChrome !== false) {
        // Publish-to-web honours these; anything it does not understand it
        // ignores, so passing them is safe across report versions.
        extra.push('chromeless=true', 'filterPaneEnabled=false', 'navContentPaneEnabled=false')
      }
      if (String(c.pageName ?? '').trim()) extra.push('pageName=' + encodeURIComponent(String(c.pageName).trim()))
      if (extra.length) url += (url.indexOf('?') === -1 ? '?' : '&') + extra.join('&')
    }

    const cfg = {
      url,
      reloadMs: Math.max(1, Math.min(1440, Number(c.refreshMinutes ?? 15))) * 60_000,
      fit: c.fitToWidth !== false,
      missing: 'This Power BI report could not be loaded',
      hint: 'Check the report is published to web, and that this screen has internet.',
    }

    return appPage({
      title: `Power BI — ${escapeHtml(ctx.instance.name)}`,
      bg,
      fontCss: ctx.fontCss,
      css: `
body{background:${bg}}
#stage{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:${bg}}
#stage iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}
#warn{position:absolute;top:50%;left:0;right:0;text-align:center;margin-top:-2em;padding:0 8vw;
      color:#334155;font-size:3vh;display:none}
#warn.on{display:block}
#warn small{display:block;margin-top:1.4vh;font-size:2vh;opacity:.7}
`,
      body: '<div id="stage"><div id="warn"></div></div>',
      script: `var CFG = ${jsonLiteral(cfg)};\n` + POWERBI_JS,
    })
  },
}

const POWERBI_JS = `
var stage = document.getElementById('stage');
var warn = document.getElementById('warn');
var frame = null;
var failTimer = null;

function fail(){
  warn.innerHTML = esc(CFG.missing) + '<small>' + esc(CFG.hint) + '</small>';
  warn.className = 'on';
}

/* Reloading by replacing the element rather than setting .src again: a report
   that has errored leaves the old document in place, and assigning the same
   URL to an iframe is not guaranteed to re-navigate. */
function load(){
  if (!CFG.url) { fail(); return; }
  if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
  frame = document.createElement('iframe');
  frame.setAttribute('allowfullscreen', 'true');
  frame.setAttribute('frameborder', '0');
  frame.onload = function(){ clearTimeout(failTimer); warn.className = ''; };
  stage.appendChild(frame);
  /* Cache-buster: a report reloaded on a schedule must not come back from the
     WebView's HTTP cache, which is the whole point of the schedule. */
  frame.src = CFG.url + (CFG.url.indexOf('?') === -1 ? '?' : '&') + '_t=' + Date.now();
  clearTimeout(failTimer);
  failTimer = setTimeout(fail, 20000);
}

load();
setInterval(load, CFG.reloadMs);
`
