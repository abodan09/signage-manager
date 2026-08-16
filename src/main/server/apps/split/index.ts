import type { AppContext, AppDefinition } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'

// Split Screen.
//
// Not a content source but a composition: the screen is divided into regions
// and each one plays something else — a designed board here, a news app there,
// a weather strip across the bottom.
//
// Each zone is an iframe pointed at a URL this manager already serves, so
// nothing here re-implements playback. A design plays through the scene
// renderer, an app through its own page, a playlist through the small zone
// player. That also means a zone can hold anything the product gains later
// without this file changing.
//
// Percentages rather than pixels: one layout has to fit a 1080p panel, a 4K
// totem and a portrait lift lobby, and nobody is going to redraw it three
// times.

export interface Zone {
  name: string
  top: number
  left: number
  width: number
  height: number
  kind: 'app' | 'design' | 'project' | 'empty'
  refId: string
}

/** Where a zone's content lives. One place, so a new content kind is one line. */
export function zoneUrl(zone: Zone, base: string): string {
  if (zone.kind === 'app') return `${base}/tv/app/${encodeURIComponent(zone.refId)}`
  if (zone.kind === 'design') return `${base}/tv/scene/${encodeURIComponent(zone.refId)}`
  if (zone.kind === 'project') return `${base}/tv/zone/project/${encodeURIComponent(zone.refId)}`
  return ''
}

export const split: AppDefinition = {
  id: 'split',
  name: 'Split Screen',
  icon: '🔲',
  description: 'Divide the screen into regions and play something different in each.',
  category: 'utility',
  defaultDuration: 120,

  fields: [
    {
      key: 'zones', label: 'Zones', type: 'zones', required: true,
      default: [
        { name: 'Main', top: 0, left: 0, width: 100, height: 88, kind: 'empty', refId: '' },
        { name: 'Bottom strip', top: 88, left: 0, width: 100, height: 12, kind: 'empty', refId: '' },
      ],
      help: 'Position and size are percentages of the screen, so one layout fits every panel.',
    },
    {
      key: 'gap', label: 'Gap between zones', type: 'number', default: 0, min: 0, max: 40,
      help: 'Pixels. A small gap makes the regions read as separate panels.',
    },
    {
      key: 'background', label: 'Background', type: 'color', default: '#000000',
      help: 'Shows through the gaps and anywhere no zone covers.',
    },

    // ── Advanced ──
    {
      key: 'reloadMinutes', label: 'Reload zones every', type: 'number', default: 0, min: 0, max: 1440, advanced: true,
      help: 'Minutes, or 0 to never reload. A long-running screen can drift; reloading brings every zone back to a known state.',
    },
  ],

  validate(config) {
    const zones = (config.zones ?? []) as Zone[]
    if (!zones.some(z => z.kind !== 'empty')) {
      return 'At least one zone needs something to play in it.'
    }
    return null
  },

  // No refresh hook: every zone fetches its own content through the page it
  // already had, so there is nothing for this app to collect.

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const zones = (c.zones ?? []) as Zone[]
    const gap = Math.max(0, Math.min(40, Number(c.gap ?? 0)))
    const bg = /^#[0-9a-fA-F]{6}$/.test(String(c.background)) ? String(c.background) : '#000000'

    const cfg = {
      zones: zones.map(z => ({
        name: z.name,
        top: z.top, left: z.left, width: z.width, height: z.height,
        url: zoneUrl(z, ctx.baseUrl),
      })),
      gap,
      reloadMs: Math.max(0, Math.min(1440, Number(c.reloadMinutes ?? 0))) * 60_000,
    }

    return appPage({
      title: `Split Screen — ${escapeHtml(ctx.instance.name)}`,
      bg,
      fontCss: ctx.fontCss,
      css: `
body{background:${bg}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:${bg}}
.zone{position:absolute;overflow:hidden;background:${bg}}
.zone iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;display:block}
.zone .empty{position:absolute;top:50%;left:0;right:0;text-align:center;margin-top:-.6em;
  color:rgba(255,255,255,.28);font-size:2.2vh}
`,
      body: '<div id="root"></div>',
      script: `var CFG = ${jsonLiteral(cfg)};\n` + SPLIT_JS,
    })
  },
}

const SPLIT_JS = `
var root = document.getElementById('root');

function build(){
  var html = '';
  for (var i = 0; i < CFG.zones.length; i++) {
    var z = CFG.zones[i];
    /* The gap is taken out of each zone's box rather than added between them,
       so the percentages still describe the whole screen and a layout does not
       shift when the gap changes. */
    var g = CFG.gap;
    var style = 'left:calc(' + z.left + '% + ' + (g / 2) + 'px);' +
      'top:calc(' + z.top + '% + ' + (g / 2) + 'px);' +
      'width:calc(' + z.width + '% - ' + g + 'px);' +
      'height:calc(' + z.height + '% - ' + g + 'px);';
    html += '<div class="zone" style="' + style + '">';
    html += z.url
      ? '<iframe src="' + esc(z.url) + '" frameborder="0" allow="autoplay; encrypted-media"></iframe>'
      : '<div class="empty">' + esc(z.name || 'Empty zone') + '</div>';
    html += '</div>';
  }
  root.innerHTML = html;
}

build();

/* Reloading rebuilds every zone at once, which is the point: a wall left up
   for weeks can have one region wedged while the rest are fine. */
if (CFG.reloadMs > 0) setInterval(build, CFG.reloadMs);
`
