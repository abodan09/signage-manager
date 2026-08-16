// Shared page furniture for app renderers.
//
// An app page is a shell plus a script that draws from JSON. The manager keeps
// the JSON warm at /tv/app/<id>/data, so a wall that has been up for six hours
// picks up new posts without reloading, and a screen that loses the network
// keeps drawing the last payload it received.
//
// Everything here targets the same webOS 4 / Chrome 53 floor as the player: no
// arrow functions, no template literals, no fetch-with-await, no CSS grid, no
// flex gap, no custom properties.

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Safe to drop inside a <script> block: the closing-tag and comment sequences
 *  that would end the block early are escaped as unicode. */
export function jsonLiteral(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029')
}

export interface ResolvedTheme {
  bg: string
  fg: string
  /** Secondary text: captions, handles, timestamps. */
  muted: string
  /** Panel/tile behind content, a step away from the page background. */
  card: string
  border: string
  dark: boolean
}

const HEX = /^#[0-9a-fA-F]{6}$/

function mix(hex: string, target: string, amount: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  if (!HEX.test(hex) || !HEX.test(target)) return hex
  const a = p(hex), b = p(target)
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amount))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}

function luminance(hex: string): number {
  if (!HEX.test(hex)) return 0
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Light / dark / custom, resolved to the handful of colours a view needs.
 *  A custom background derives the rest, so an operator who picks one colour
 *  still gets readable secondary text instead of grey-on-grey. */
export function resolveTheme(theme: unknown, bgColor?: unknown, textColor?: unknown): ResolvedTheme {
  if (theme === 'custom') {
    const bg = HEX.test(String(bgColor)) ? String(bgColor) : '#f5f5f5'
    const dark = luminance(bg) < 0.4
    const fg = HEX.test(String(textColor)) ? String(textColor) : (dark ? '#ffffff' : '#37474f')
    return {
      bg, fg,
      muted: mix(fg, bg, 0.45),
      card: mix(bg, dark ? '#ffffff' : '#000000', 0.06),
      border: mix(bg, dark ? '#ffffff' : '#000000', 0.14),
      dark,
    }
  }
  // These are the tokens the reference product uses, kept deliberately: an
  // operator comparing the two side by side should not see a different wall.
  if (theme === 'light') {
    return { bg: '#f5f5f5', fg: '#37474f', muted: '#78909c', card: '#dee4e7', border: '#cfd8dc', dark: false }
  }
  return { bg: '#222222', fg: '#dee4e7', muted: '#90a4ae', card: '#37474f', border: '#455a64', dark: true }
}

/** Speed 1..20 (10 = medium) to a per-item dwell in ms. Higher is faster, so
 *  the scale is inverted: 1 is a leisurely 24s, 20 a brisk 3s. */
export function speedToDwellMs(speed: number): number {
  const s = Math.max(1, Math.min(20, Math.round(Number(speed) || 10)))
  return Math.round(24000 - (s - 1) * (21000 / 19))
}

export const FONT_SCALE: Record<string, number> = {
  smallest: 0.72, smaller: 0.86, default: 1, larger: 1.18, largest: 1.4,
}

export function fontScale(size: unknown): number {
  return FONT_SCALE[String(size)] ?? 1
}

/** ES5 helpers every app page wants: relative time, escaping, and a poller
 *  that survives the manager going away. Injected once per page. */
export const APP_RUNTIME_JS = `
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function relTime(iso){
  var t = Date.parse(iso);
  if (!t) return '';
  var s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  var m = Math.floor(s / 60);
  if (m < 60) return m + (m === 1 ? ' minute ago' : ' minutes ago');
  var h = Math.floor(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  var d = Math.floor(h / 24);
  if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
  var w = Math.floor(d / 7);
  if (d < 30) return w + (w === 1 ? ' week ago' : ' weeks ago');
  var mo = Math.floor(d / 30);
  if (mo < 12) return mo + (mo === 1 ? ' month ago' : ' months ago');
  var y = Math.floor(d / 365);
  return y + (y === 1 ? ' year ago' : ' years ago');
}
/* Polls the manager for fresh data. Failures are silent and simply retried:
   a wall must never replace working content with an error because one poll
   missed. */
function pollData(url, everyMs, onData){
  function go(){
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url + '?t=' + Date.now(), true);
      xhr.timeout = 15000;
      xhr.onreadystatechange = function(){
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          try { onData(JSON.parse(xhr.responseText)); } catch (e) {}
        }
      };
      xhr.send();
    } catch (e) {}
    setTimeout(go, everyMs);
  }
  go();
}
`

export interface PageOptions {
  title: string
  fontCss: string
  css: string
  body: string
  script: string
  bg: string
}

/** The document every app page is built from. */
export function appPage(o: PageOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:${o.bg};font-family:"Inter",Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased}
img{display:block}
${o.fontCss}
${o.css}
</style>
</head>
<body>
${o.body}
<script>
(function(){
'use strict';
${APP_RUNTIME_JS}
${o.script}
})();
</script>
</body>
</html>`
}
