import type { AppContext, AppDefinition } from '../types'
import { appPage, escapeHtml, jsonLiteral, resolveTheme } from '../render'
import { SCENE_FONTS, isSceneFontId } from '../../fonts'

// Motivational Quotes.
//
// The quotes are the operator's own. That is not a limitation worked around —
// it is the only defensible design: the public quote APIs are almost all
// unlicensed scrapes of copyrighted material, and shipping a bundled book of
// them would put our customers' walls on the wrong side of somebody's rights.
// A company putting its own chosen words on its own screens has no such
// problem, and gets a board that says what it actually wants to say.
//
// No refresh hook, so this keeps working on a screen that has never had a
// network.

export interface Quote {
  text: string
  author: string
}

/** One quote per line, with an optional author after a pipe.
 *
 *  A textarea rather than a row editor because quotes arrive by the dozen,
 *  pasted out of a document — and a list of twenty two-field rows is a worse
 *  way to handle that than a box you can paste into. */
/** The quotation marks a word processor produces, as opening/closing pairs. */
const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ['“', '”'],
  ['‘', '’'],
  ["'", "'"],
]

function stripWrappingQuotes(text: string): string {
  let out = text.trim()
  for (let guard = 0; guard < 4; guard++) {
    const first = out.charAt(0)
    const last = out.charAt(out.length - 1)
    const pair = QUOTE_PAIRS.find(([o, c]) => o === first && c === last)
    if (!pair || out.length < 2) break
    out = out.slice(1, -1).trim()
  }
  return out
}

export function parseQuotes(input: unknown): Quote[] {
  const out: Quote[] = []
  for (const line of String(input ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const bar = trimmed.indexOf('|')
    const text = (bar >= 0 ? trimmed.slice(0, bar) : trimmed).trim()
    const author = bar >= 0 ? trimmed.slice(bar + 1).trim() : ''
    // Quotation marks wrapping the whole line are what a word processor leaves
    // behind, and the card draws its own mark above the words, so they would
    // appear twice. Only a matched pair is stripped: a lone leading apostrophe
    // is an elision — 'Tis, '70s — and eating it silently corrupts the text.
    const clean = stripWrappingQuotes(text)
    if (clean) out.push({ text: clean, author })
  }
  return out
}

export const quotes: AppDefinition = {
  id: 'quotes',
  name: 'Motivational Quotes',
  icon: '💬',
  description: 'Your own chosen quotes, one at a time, over a picture.',
  category: 'information',
  defaultDuration: 60,

  fields: [
    {
      key: 'quotes', label: 'Quotes', type: 'textarea', required: true, maxLength: 8000,
      default: [
        'The time is always right to do what is right. | Martin Luther King',
        'It always seems impossible until it is done. | Nelson Mandela',
        'The best way out is always through. | Robert Frost',
      ].join('\n'),
      placeholder: 'The time is always right to do what is right. | Martin Luther King',
      help: 'One per line. Put the name after a | to credit it. Paste a whole list at once if you have one.',
    },
    {
      key: 'order', label: 'Play them', type: 'select', default: 'order',
      options: [
        { value: 'order', label: 'In the order above' },
        { value: 'random', label: 'Shuffled', hint: 'Reshuffled each time the screen reloads.' },
      ],
    },
    {
      key: 'seconds', label: 'Show each one for', type: 'number', default: 12, min: 4, max: 300,
      help: 'Seconds. Long enough to read twice is about right on a wall.',
    },
    {
      key: 'backgroundImage', label: 'Background picture', type: 'image',
      help: 'Optional. Without one, the colours below are used.',
    },
    {
      key: 'scrim', label: 'Fade the picture', type: 'slider', default: 55, min: 0, max: 90,
      marks: ['Clear', 'Faded'],
      // Darkening only helps light words. A light theme puts dark words on the
      // picture, so it fades towards white instead — the slider means "make the
      // words readable", not "make it darker".
      help: 'Only affects a background picture. Words over a photograph need this more than you would think.',
    },
    {
      key: 'font', label: 'Typeface', type: 'select', default: 'playfair',
      options: [
        { value: 'playfair', label: 'Playfair Display', hint: 'A serif with some ceremony to it' },
        { value: 'roboto-slab', label: 'Roboto Slab' },
        { value: 'serif', label: 'Georgia' },
        { value: 'inter', label: 'Inter' },
        { value: 'sans', label: 'Plain sans' },
      ],
    },
    {
      key: 'showMark', label: 'Show the quotation mark', type: 'checkbox', default: true,
    },
    {
      key: 'theme', label: 'Theme', type: 'select', required: true, default: 'dark',
      options: [
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
        { value: 'custom', label: 'Custom' },
      ],
    },
    {
      key: 'backgroundColor', label: 'Background Colour', type: 'color', default: '#1b2430',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'textColor', label: 'Text Colour', type: 'color', default: '#ffffff',
      showIf: { key: 'theme', equals: ['custom'] },
    },

    // ── Advanced ──
    {
      key: 'transition', label: 'Change with', type: 'select', default: 'fade', advanced: true,
      options: [
        { value: 'fade', label: 'Cross-fade' },
        { value: 'cut', label: 'A straight cut' },
      ],
    },
  ],

  validate(config) {
    if (!parseQuotes(config.quotes).length) {
      return 'Add at least one quote — one per line.'
    }
    return null
  },

  // No refresh hook: the quotes are already here. A board that needed the
  // network to show words someone typed would be a poor board.

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const theme = resolveTheme(c.theme, c.backgroundColor, c.textColor)
    const list = parseQuotes(c.quotes)
    const fontId = isSceneFontId(c.font) ? c.font : 'playfair'
    const image = String(c.backgroundImage ?? '').trim()
    const scrim = Math.max(0, Math.min(90, Number(c.scrim) || 0))

    const cfg = {
      seconds: Math.max(4, Math.min(300, Number(c.seconds) || 12)),
      random: c.order === 'random',
      fade: c.transition === 'cut' ? 0 : 700,
      showMark: c.showMark !== false,
    }

    return appPage({
      title: `Quotes — ${ctx.instance.name}`,
      bg: theme.bg,
      fontCss: ctx.fontCss,
      css: `
body{background:${theme.bg};color:${theme.fg}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:${theme.bg}}
${image ? `#bg{position:absolute;top:0;left:0;right:0;bottom:0;
  background-image:url("${escapeHtml(image)}");background-size:cover;background-position:center}
#scrim{position:absolute;top:0;left:0;right:0;bottom:0;background:${theme.dark ? '#000000' : '#ffffff'};opacity:${scrim / 100}}` : ''}
#card{position:absolute;top:8%;left:8%;right:8%;bottom:8%;
  display:flex;align-items:center;justify-content:center;text-align:center}
/* An inner box, because a flex container's scrollHeight never falls below its
   own height — so asking the card how tall its contents are always answers
   "as tall as me", and a fit loop driven by that shrinks until it gives up. */
#inner{display:flex;flex-direction:column;align-items:center;width:100%}
#card.fade{transition:opacity ${cfg.fade}ms ease-in-out}
#card.out{opacity:0}
#mark{font-family:Georgia,"Times New Roman",serif;line-height:.8;opacity:.5;margin-bottom:.15em}
#mark.off{display:none}
#text{font-family:${SCENE_FONTS[fontId].css};line-height:1.35;max-width:100%;
  word-wrap:break-word;overflow-wrap:break-word}
#rule{height:1px;background:currentColor;opacity:.45;margin:1.1em 0 .9em}
#rule.off{display:none}
#author{font-family:${SCENE_FONTS[fontId].css};font-weight:700;opacity:.9}
#author.off{display:none}
`,
      body:
        '<div id="root">' +
        (image ? '<div id="bg"></div><div id="scrim"></div>' : '') +
        '<div id="card"><div id="inner">' +
        '<div id="mark">“</div>' +
        '<div id="text"></div>' +
        '<div id="rule"></div>' +
        '<div id="author"></div>' +
        '</div></div></div>',
      script:
        `var CFG = ${jsonLiteral(cfg)};\n` +
        `var QUOTES = ${jsonLiteral(list)};\n` +
        QUOTES_JS,
    })
  },
}

// Kept out of the emitted script because the compatibility tests read that text
// and would match the words themselves: nothing below uses a CSS transform, and
// the change between quotes is an opacity fade. That is the same rule the rest
// of the product follows, and it costs nothing here.
const QUOTES_JS = `
var card = document.getElementById('card');
var inner = document.getElementById('inner');
var markEl = document.getElementById('mark');
var textEl = document.getElementById('text');
var ruleEl = document.getElementById('rule');
var authorEl = document.getElementById('author');
var order = [];
var idx = 0;

for (var i = 0; i < QUOTES.length; i++) order.push(i);

/* Seeded on the day rather than on Math.random, so a reload does not reshuffle
   into a different order and repeat what was just shown. */
if (CFG.random) {
  var seed = Math.floor(Date.now() / 86400000) + QUOTES.length;
  for (var j = order.length - 1; j > 0; j--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    var k = seed % (j + 1);
    var t = order[j]; order[j] = order[k]; order[k] = t;
  }
}

/* Where in the list to start, derived from the clock rather than from zero.
   The player rebuilds this page every time the item comes round in the
   playlist, so starting at zero meant a sixty-second slot at twelve seconds a
   quote showed quotes one to five, for ever, however long the list — while the
   settings text invited pasting a hundred of them. Taking the position from
   the wall clock also means every screen showing this instance shows the same
   quote at the same moment. */
if (order.length) {
  var slot = Math.floor(Date.now() / (CFG.seconds * 1000));
  idx = ((slot % order.length) + order.length) % order.length;
}

/* Sized by measuring rather than by guessing from the character count. A
   fourteen-word quote and a four-word one want very different sizes, and the
   only reliable way to know when text has stopped fitting its box is to put it
   there and ask. Costs a handful of reflows once every several seconds. */
function fit(){
  var boxW = card.clientWidth;
  var boxH = card.clientHeight;
  var markPx = CFG.showMark ? boxH * 0.14 : 0;
  markEl.style.fontSize = markPx + 'px';

  /* Measured, not summed. Adding up the children misses the margins between
     them — most of a line's worth once there is a rule and a name under the
     words — and the quote then sits proud of its box with the attribution
     jammed against the bottom edge. */
  /* Clamped, not skipped. With the three assignments inside a loop guarded on
     size being above the floor, the body never ran at all once the starting
     size was already at that floor — a quotes page dropped into a short Split
     Screen strip got no font size whatsoever and fell back to the browser's
     16px, larger than the box it was supposed to be shrinking to fit. The
     floor bounds the size; it must not decide whether a size is applied. */
  var size = Math.max(10, boxH * 0.2);
  var guard = 0;
  for (;;) {
    textEl.style.fontSize = size + 'px';
    authorEl.style.fontSize = (size * 0.34) + 'px';
    ruleEl.style.width = Math.min(boxW * 0.34, size * 6) + 'px';
    /* Fitted to a comfortable fill rather than to the last available pixel.
       Filling the box exactly is technically correct and looks wrong — a long
       quote then reaches both edges with the attribution pressed against the
       bottom, where a short one floats in the middle. Measured on the inner
       box: the card is a centring flex container and always reports its own
       height. */
    var fits = inner.offsetHeight <= boxH * 0.86 && textEl.scrollWidth <= boxW;
    if (fits || size <= 10 || guard++ >= 90) break;
    size = Math.max(10, size * 0.94);
  }
}

function paint(){
  if (!QUOTES.length) return;
  var q = QUOTES[order[idx % order.length]];
  idx = (idx + 1) % order.length;
  markEl.className = CFG.showMark ? '' : 'off';
  textEl.innerHTML = esc(q.text);
  authorEl.innerHTML = esc(q.author);
  authorEl.className = q.author ? '' : 'off';
  ruleEl.className = q.author ? '' : 'off';
  fit();
}

function show(){
  if (!CFG.fade) { paint(); return; }
  card.className = 'fade out';
  setTimeout(function(){
    paint();
    card.className = 'fade';
  }, CFG.fade);
}

paint();
/* One quote is a poster, not a rotation — leave it up rather than fading it
   out and back in to itself every few seconds. */
if (QUOTES.length > 1) setInterval(show, CFG.seconds * 1000);
window.addEventListener('resize', fit);
`
