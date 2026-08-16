import type { AppContext, AppDefinition, AppField } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'

// Countdown and Count-up.
//
// One board, counted in two directions: days, hours, minutes and seconds
// either until a moment or since one. They share everything except which way
// the subtraction goes and what happens when it reaches zero.
//
// The moment is stored as wall-clock with no timezone, and read on the screen
// in the screen's own local time. A countdown to midnight means midnight where
// the screen is — stamping the manager's zone onto it would put the New Year on
// a Sydney wall at the wrong hour because the PC running it sits in London.
//
// No refresh hook: subtracting two times needs no network.

export type TimerKind = 'down' | 'up'

interface ThemePreset {
  bg: string
  tile: string
  digit: string
  heading: string
  label: string
}

/** Named looks, because "pick five colours" is not a thing an operator wants to
 *  do to put a countdown on a wall. Custom is there for the one who does. */
const THEMES: Record<string, ThemePreset> = {
  urban: { bg: '#8f96d6', tile: '#242629', digit: '#ffffff', heading: '#ffffff', label: '#1e2024' },
  midnight: { bg: '#0d1b2a', tile: '#1b3a5c', digit: '#e8f1ff', heading: '#e8f1ff', label: '#9fb8d0' },
  clean: { bg: '#f5f5f7', tile: '#1d1d1f', digit: '#ffffff', heading: '#1d1d1f', label: '#6e6e73' },
  warm: { bg: '#f3ede4', tile: '#8c3d2b', digit: '#fff6ef', heading: '#4a2419', label: '#8c3d2b' },
}

const HEX = /^#[0-9a-fA-F]{6}$/

function sharedFields(kind: TimerKind): AppField[] {
  return [
    {
      key: 'heading', label: 'Heading', type: 'text', required: true, maxLength: 80,
      default: kind === 'down' ? 'Count down to launch' : 'We have been open for',
      help: 'The line above the numbers.',
    },
    kind === 'down'
      ? {
        key: 'endAt', label: 'Counts down to', type: 'datetime', required: true,
        help: 'Read in the screen\'s own local time, so midnight means midnight where the screen is.',
      }
      : {
        key: 'startAt', label: 'Counts up from', type: 'datetime', required: true,
        help: 'Read in the screen\'s own local time.',
      },
    {
      key: 'showDate', label: 'Show the date underneath the heading', type: 'checkbox', default: true,
    },
    {
      key: 'units', label: 'Show', type: 'select', default: 'all',
      options: [
        { value: 'all', label: 'Days, hours, minutes and seconds' },
        { value: 'days', label: 'Days only', hint: 'For something months away.' },
        { value: 'hours', label: 'Hours, minutes and seconds', hint: 'For something today.' },
      ],
    },
    {
      key: 'repeat', label: 'Repeat', type: 'select', default: 'never',
      options: [
        { value: 'never', label: 'It happens once' },
        { value: 'days', label: 'Every so many days', hint: 'A daily happy hour, a nightly close.' },
        { value: 'weeks', label: 'Every so many weeks' },
      ],
    },
    {
      key: 'repeatEvery', label: 'Repeat every', type: 'number', default: 1, min: 1, max: 365,
      showIf: { key: 'repeat', equals: ['days', 'weeks'] },
    },
    {
      key: 'backgroundImage', label: 'Background picture', type: 'image',
      help: 'Optional. The theme colour is used without one.',
    },
    {
      key: 'scrim', label: 'Darken the picture', type: 'slider', default: 35, min: 0, max: 90,
      marks: ['Clear', 'Dark'],
      help: 'Only affects a background picture.',
    },
    ...(kind === 'down' ? [{
      key: 'message', label: 'When it reaches zero, show', type: 'text', required: true, maxLength: 120,
      default: 'Here we go!',
      // A countdown that hits zero and keeps sitting there on 00:00:00:00 looks
      // broken rather than finished.
      help: 'Replaces the numbers once the moment arrives.',
    } as AppField] : []),
    {
      key: 'theme', label: 'Theme', type: 'select', required: true, default: 'urban',
      options: [
        { value: 'urban', label: 'Urban', hint: 'Dark tiles on periwinkle' },
        { value: 'midnight', label: 'Midnight' },
        { value: 'clean', label: 'Clean' },
        { value: 'warm', label: 'Warm' },
        { value: 'custom', label: 'Custom' },
      ],
    },
    {
      key: 'bgColor', label: 'Background', type: 'color', default: '#8f96d6',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'tileColor', label: 'Number tiles', type: 'color', default: '#242629',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'digitColor', label: 'Numbers', type: 'color', default: '#ffffff',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'headingColor', label: 'Heading text', type: 'color', default: '#ffffff',
      showIf: { key: 'theme', equals: ['custom'] },
    },

    // ── Advanced ──
    {
      key: 'hideEmptyDays', label: 'Hide days once there are none left', type: 'checkbox',
      default: false, advanced: true,
      help: 'On the last day, drop the 00 and let the hours read larger.',
    },
    {
      key: 'tileOpacity', label: 'Tile solidity', type: 'slider', default: 100, min: 20, max: 100,
      marks: ['See-through', 'Solid'], advanced: true,
      help: 'Lower it to let a background picture show through the number tiles.',
    },
    {
      key: 'repeatUntil', label: 'Stop repeating after', type: 'datetime', advanced: true,
      showIf: { key: 'repeat', equals: ['days', 'weeks'] },
      help: 'Leave empty to repeat for ever.',
    },
  ]
}

function resolveColours(c: Record<string, unknown>): ThemePreset {
  const name = String(c.theme ?? 'urban')
  if (name !== 'custom') return THEMES[name] ?? THEMES.urban
  const pick = (v: unknown, d: string) => (HEX.test(String(v)) ? String(v) : d)
  return {
    bg: pick(c.bgColor, THEMES.urban.bg),
    tile: pick(c.tileColor, THEMES.urban.tile),
    digit: pick(c.digitColor, THEMES.urban.digit),
    heading: pick(c.headingColor, THEMES.urban.heading),
    // Derived rather than asked for: a fifth colour picker to label four
    // numbers is more choice than anyone wants.
    label: pick(c.headingColor, THEMES.urban.heading),
  }
}

function render(ctx: AppContext, kind: TimerKind): string {
  const c = ctx.instance.config
  const t = resolveColours(c)
  const moment = String((kind === 'down' ? c.endAt : c.startAt) ?? '')

  const units = String(c.units ?? 'all')
  const repeat = String(c.repeat ?? 'never')
  const every = Math.max(1, Math.min(365, Number(c.repeatEvery) || 1))
  const image = String(c.backgroundImage ?? '').trim()
  const scrim = Math.max(0, Math.min(90, Number(c.scrim) || 0))
  const tileOpacity = Math.max(20, Math.min(100, Number(c.tileOpacity) || 100))

  const cfg = {
    kind,
    moment,
    message: String(c.message ?? '').trim(),
    showDate: c.showDate !== false,
    showSeconds: units === 'all' || units === 'hours',
    showDays: units !== 'hours',
    daysOnly: units === 'days',
    hideEmptyDays: c.hideEmptyDays === true,
    // Days rather than a unit name, so the page has one number to step by.
    repeatDays: repeat === 'days' ? every : repeat === 'weeks' ? every * 7 : 0,
    repeatUntil: String(c.repeatUntil ?? ''),
  }

  return appPage({
    title: `${kind === 'down' ? 'Countdown' : 'Count-up'} — ${escapeHtml(ctx.instance.name)}`,
    bg: t.bg,
    fontCss: ctx.fontCss,
    css: `
body{background:${t.bg};color:${t.heading}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:${t.bg};
  display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
${image ? `#bg{position:absolute;top:0;left:0;right:0;bottom:0;
  background-image:url("${escapeHtml(image)}");background-size:cover;background-position:center}
#shade{position:absolute;top:0;left:0;right:0;bottom:0;background:#000;opacity:${scrim / 100}}
#stack{position:relative;display:flex;flex-direction:column;align-items:center;width:100%}` : ''}
#heading{font-weight:300;letter-spacing:.04em;color:${t.heading}}
#date{opacity:.8;margin-top:.4em;color:${t.heading}}
#date.off{display:none}
#board{display:flex;align-items:flex-start;justify-content:center;white-space:nowrap}
#board.off{display:none}
.grp{display:flex;flex-direction:column;align-items:center}
.tiles{display:flex}
.tile{position:relative;background:${t.tile};color:${t.digit};font-weight:700;
  line-height:1.18;text-align:center;overflow:hidden;opacity:${tileOpacity / 100}}
/* The seam across each tile is what makes it read as a flip clock rather than
   a box with a number in it. Drawn as an element because a 1px line from a
   gradient lands on a half-pixel and disappears on some panels. */
.seam{position:absolute;left:0;right:0;background:rgba(0,0,0,.42)}
.sep{color:${t.digit};opacity:.85;font-weight:700;line-height:1.18}
.cap{color:${t.label};opacity:.85;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
#done{color:${t.heading};font-weight:300;display:none;padding:0 6vw}
#done.on{display:block}
`,
    body:
      '<div id="root">' +
      (image ? '<div id="bg"></div><div id="shade"></div><div id="stack">' : '') +
      '<div id="heading"></div>' +
      '<div id="date" class="off"></div>' +
      '<div id="board"></div>' +
      '<div id="done"></div>' +
      (image ? '</div>' : '') +
      '</div>',
    script:
      `var CFG = ${jsonLiteral(cfg)};\n` +
      `var HEADING = ${jsonLiteral(String(c.heading ?? ''))};\n` +
      TIMER_JS,
  })
}

export const countdown: AppDefinition = {
  id: 'countdown',
  name: 'Countdown',
  icon: '⏳',
  description: 'Days, hours, minutes and seconds until a moment you choose.',
  category: 'utility',
  defaultDuration: 30,
  fields: sharedFields('down'),
  validate(config) {
    if (!String(config.endAt ?? '').trim()) return 'Choose the date and time to count down to.'
    return null
  },
  render: ctx => render(ctx, 'down'),
}

export const countup: AppDefinition = {
  id: 'countup',
  name: 'Count-up',
  icon: '⏱️',
  description: 'Days, hours, minutes and seconds since a moment you choose.',
  category: 'utility',
  defaultDuration: 30,
  fields: sharedFields('up'),
  validate(config) {
    if (!String(config.startAt ?? '').trim()) return 'Choose the date and time to count up from.'
    return null
  },
  render: ctx => render(ctx, 'up'),
}

// Kept out of the emitted script, which the compatibility tests read as text:
// nothing below uses a CSS transform, and the tiles are sized from the box they
// are given rather than from a fixed font size, so the board fits a portrait
// lift lobby and a 4K totem without being redrawn.
const TIMER_JS = `
var root = document.getElementById('root');
var headingEl = document.getElementById('heading');
var dateEl = document.getElementById('date');
var board = document.getElementById('board');
var doneEl = document.getElementById('done');
var lastKey = '';

/* Built from the parts rather than parsed. An ISO string without a zone was
   read as UTC by some older browsers and as local time by others, which would
   put the moment out by hours on exactly the screens we care about. */
function momentAtRaw(s){
  var m = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/.exec(String(s || ''));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
}

/** The moment this screen is actually counting to or from — the base one, or
 *  the occurrence of it that is current now. */
function momentAt(s){
  var base = momentAtRaw(s);
  if (base === null) return null;
  return occurrenceOf(base, Date.now());
}

/* The occurrence of a repeating moment that this screen should be counting to
   or from. Stepped with setDate rather than by adding milliseconds: a day is
   not always 86,400,000 ms, and adding them across a clock change puts a daily
   happy hour an hour out for half the year. */
function occurrenceOf(base, now){
  if (!CFG.repeatDays) return base;
  var until = momentAtRaw(CFG.repeatUntil);
  var stepMs = CFG.repeatDays * 86400000;
  var n = Math.floor((now - base) / stepMs);
  if (n < 0) n = 0;
  var d = new Date(base);
  d.setDate(d.getDate() + n * CFG.repeatDays);
  /* The estimate above can be a step out either way once a clock change is in
     the span; nudge it rather than looping from the beginning, which would be
     thousands of iterations for a daily repeat set years ago. */
  var guard = 0;
  if (CFG.kind === 'down') {
    while (d.getTime() <= now && guard++ < 8) d.setDate(d.getDate() + CFG.repeatDays);
    while (d.getTime() - stepMs > now && guard++ < 16) d.setDate(d.getDate() - CFG.repeatDays);
  } else {
    while (d.getTime() > now && guard++ < 8) d.setDate(d.getDate() - CFG.repeatDays);
    while (d.getTime() + stepMs <= now && guard++ < 16) d.setDate(d.getDate() + CFG.repeatDays);
  }
  /* Past the end of the recurrence, hold on the last one rather than running
     away into next year. */
  if (until !== null && d.getTime() > until) {
    var last = new Date(base);
    var m = Math.floor((until - base) / stepMs);
    if (m > 0) last.setDate(last.getDate() + m * CFG.repeatDays);
    return last.getTime();
  }
  return d.getTime();
}

var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function pad2(n){ return (n < 10 ? '0' : '') + n; }

function dateLine(ms){
  var d = new Date(ms);
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

function parts(diff){
  var s = Math.floor(diff / 1000);
  var days = Math.floor(s / 86400); s -= days * 86400;
  var hours = Math.floor(s / 3600); s -= hours * 3600;
  var mins = Math.floor(s / 60); s -= mins * 60;
  return { d: days, h: hours, m: mins, s: s };
}

function sizeBoard(){
  /* Measured from the box, not guessed: the same board has to sit on a 4K
     totem and a portrait lift panel, and a fixed size is wrong on both. */
  var groups = board.getElementsByClassName('grp').length;
  if (!groups) return;
  var digits = board.getElementsByClassName('tile').length;
  var w = root.clientWidth, h = root.clientHeight;
  /* Width per digit, allowing for the separators between groups. */
  var byW = (w * 0.86) / (digits * 1.18 + (groups - 1) * 0.5);
  var byH = h * 0.3;
  var size = Math.max(10, Math.min(byW, byH));

  var tiles = board.getElementsByClassName('tile');
  for (var i = 0; i < tiles.length; i++) {
    tiles[i].style.fontSize = size + 'px';
    tiles[i].style.width = (size * 1.02) + 'px';
    tiles[i].style.margin = '0 ' + (size * 0.06) + 'px';
    tiles[i].style.borderRadius = (size * 0.1) + 'px';
  }
  var seams = board.getElementsByClassName('seam');
  for (var j = 0; j < seams.length; j++) {
    seams[j].style.top = (size * 0.585) + 'px';
    seams[j].style.height = Math.max(2, Math.round(size * 0.035)) + 'px';
  }
  var seps = board.getElementsByClassName('sep');
  for (var k = 0; k < seps.length; k++) {
    seps[k].style.fontSize = size + 'px';
    seps[k].style.padding = '0 ' + (size * 0.1) + 'px';
  }
  var caps = board.getElementsByClassName('cap');
  for (var n = 0; n < caps.length; n++) {
    caps[n].style.fontSize = Math.max(9, size * 0.16) + 'px';
    caps[n].style.marginTop = (size * 0.14) + 'px';
  }
  headingEl.style.fontSize = Math.max(12, Math.min(size * 0.42, h * 0.1)) + 'px';
  dateEl.style.fontSize = Math.max(10, size * 0.2) + 'px';
  /* Space between the heading block and the tiles, scaled with them. Without
     it the date line sits directly on top of the first tile, which reads as a
     rendering fault rather than a tight layout. */
  board.style.marginTop = (size * 0.34) + 'px';
  doneEl.style.fontSize = Math.max(16, Math.min(w * 0.09, h * 0.22)) + 'px';
}

function group(value, caption, minDigits){
  var text = String(value);
  while (text.length < minDigits) text = '0' + text;
  var html = '<div class="grp"><div class="tiles">';
  for (var i = 0; i < text.length; i++) {
    html += '<div class="tile">' + text.charAt(i) + '<div class="seam"></div></div>';
  }
  html += '</div><div class="cap">' + esc(caption) + '</div></div>';
  return html;
}

function build(p){
  var showDays = CFG.showDays && !(CFG.hideEmptyDays && p.d === 0);
  var html = '';
  if (showDays) html += group(p.d, p.d === 1 ? 'Day' : 'Days', 2);
  /* Days only: one number, nothing to separate it from. */
  if (CFG.daysOnly) return html || group(0, 'Days', 2);
  if (showDays) html += '<div class="sep">:</div>';
  /* With days hidden, the hours have to carry them or the board silently
     understates how long is left. */
  html += group(showDays ? p.h : p.d * 24 + p.h, 'Hours', 2);
  html += '<div class="sep">:</div>';
  html += group(p.m, 'Minutes', 2);
  if (CFG.showSeconds) {
    html += '<div class="sep">:</div>';
    html += group(p.s, 'Seconds', 2);
  }
  return html;
}

function tick(){
  var target = momentAt(CFG.moment);
  if (target === null) return;
  var now = Date.now();
  var diff = CFG.kind === 'down' ? target - now : now - target;

  if (diff <= 0) {
    if (CFG.kind === 'down') {
      /* Sitting on 00:00:00:00 for ever reads as a broken screen rather than a
         finished countdown. */
      board.className = 'off';
      doneEl.innerHTML = esc(CFG.message);
      doneEl.className = 'on';
      sizeBoard();
      return;
    }
    /* Counting up from a moment that has not arrived: hold at zero rather than
       showing a negative, which is what a mistyped year would otherwise do. */
    diff = 0;
  }

  board.className = '';
  doneEl.className = '';
  var p = parts(diff);
  /* Rebuild only when a digit actually changes: this runs every second for
     years on a panel that is not fast. */
  var key = CFG.daysOnly ? String(p.d) : p.d + '|' + p.h + '|' + p.m + '|' + p.s;
  if (key !== lastKey) {
    lastKey = key;
    board.innerHTML = build(p);
    /* The tiles are rebuilt, so their inline sizes went with them. */
    sizeBoard();
  }
}

function refreshDateLine(){
  var at = momentAt(CFG.moment);
  if (!CFG.showDate || at === null) { dateEl.className = 'off'; return; }
  dateEl.innerHTML = esc(dateLine(at));
  dateEl.className = '';
}

headingEl.innerHTML = esc(HEADING);
refreshDateLine();
tick();
setInterval(tick, CFG.showSeconds ? 500 : 15000);
/* A repeating timer rolls over to its next occurrence, so the date under the
   heading has to move with it. */
if (CFG.repeatDays) setInterval(refreshDateLine, 30000);
window.addEventListener('resize', sizeBoard);
`
