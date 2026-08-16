import type { ResolvedTheme } from '../render'

// The clock face, digital and analogue.
//
// Written to draw N clocks rather than one, because Simple Clock and World
// Clock are the same board at different counts — a single clock is just the
// one-element case. Sizes come from the grid, so two clocks are larger than
// six without anyone configuring a font size.

export const clockCss = (t: ResolvedTheme, accent: string) => `
body{background:${t.bg};color:${t.fg}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;
  align-items:center;justify-content:center;flex-wrap:wrap;padding:2vh 2vw}

.clock{display:flex;flex-direction:column;align-items:center;justify-content:center;
  flex:1 1 auto;min-width:0;padding:1.5vh 1vw}
.clock .label{opacity:.72;letter-spacing:.1em;text-transform:uppercase;
  text-align:center;margin-bottom:.8em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.clock .digits{font-weight:300;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap}
.clock .suffix{font-weight:400;margin-left:.18em}
.clock .sub{opacity:.72;margin-top:.55em;text-align:center;white-space:nowrap}

/* The analogue face is one SVG so it scales with the tile and never reflows. */
.clock svg.face{display:block}
.face .tick{stroke:${t.fg};opacity:.9}
.face .tick.major{opacity:1}
.face .hand{stroke:${t.fg};stroke-linecap:round}
.face .hand.sec{stroke:${accent}}
.face .pin{fill:${accent}}
`

/** ES5. Reads CLOCKS (label + offset schedule) and redraws every second. */
export const CLOCK_JS = `
var root = document.getElementById('root');

function pad2(n){ return (n < 10 ? '0' : '') + n; }
var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/* The manager shipped a schedule of offset changes, so the clock stays right
   through a daylight-saving switch without asking anyone anything. */
function offsetFor(shifts){
  if (!shifts || !shifts.length) return null;
  var now = Date.now();
  var chosen = shifts[0].offset;
  for (var i = 0; i < shifts.length; i++) {
    if (shifts[i].from <= now) chosen = shifts[i].offset;
  }
  return chosen;
}

function nowFor(clock){
  var d = new Date();
  var off = clock.shifts ? offsetFor(clock.shifts) : null;
  if (off === null || off === undefined) return d;
  return new Date(d.getTime() + d.getTimezoneOffset() * 60000 + off * 1000);
}

function dateLine(d){
  if (CFG.dateFormat === 'none') return '';
  if (CFG.dateFormat === 'numeric') return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1);
  if (CFG.dateFormat === 'weekday') return DAYS[d.getDay()];
  return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
}

function digitalHtml(d, scale){
  var h = d.getHours(), suffix = '';
  if (!CFG.clock24) {
    suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
  } else {
    h = pad2(h);
  }
  var time = h + ':' + pad2(d.getMinutes()) + (CFG.showSeconds ? ':' + pad2(d.getSeconds()) : '');
  return '<div class="digits" style="font-size:' + scale + 'px">' + time +
    (suffix ? '<span class="suffix" style="font-size:' + (scale * 0.32) + 'px">' + suffix + '</span>' : '') +
    '</div>';
}

/* Ticks are drawn once per face; only the hands move. Minor ticks every
   minute, heavier ones every five, matching a real dial. */
function faceHtml(d, size){
  var svg = '<svg class="face" viewBox="0 0 200 200" width="' + size + 'px" height="' + size + 'px">';
  for (var i = 0; i < 60; i++) {
    var major = i % 5 === 0;
    var a = i * 6 * Math.PI / 180;
    var outer = 92, inner = major ? 78 : 84;
    var x1 = 100 + Math.sin(a) * inner, y1 = 100 - Math.cos(a) * inner;
    var x2 = 100 + Math.sin(a) * outer, y2 = 100 - Math.cos(a) * outer;
    svg += '<line class="tick' + (major ? ' major' : '') + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
      '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke-width="' + (major ? 5 : 2.4) +
      '" stroke-linecap="round"/>';
  }
  var sec = d.getSeconds();
  var min = d.getMinutes() + sec / 60;
  var hr = (d.getHours() % 12) + min / 60;
  function hand(angleDeg, length, width, cls){
    var a = angleDeg * Math.PI / 180;
    var x = 100 + Math.sin(a) * length, y = 100 - Math.cos(a) * length;
    /* A short tail past the centre is what makes a hand look mounted rather
       than glued on. */
    var bx = 100 - Math.sin(a) * (length * 0.18), by = 100 + Math.cos(a) * (length * 0.18);
    return '<line class="hand ' + cls + '" x1="' + bx.toFixed(1) + '" y1="' + by.toFixed(1) +
      '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke-width="' + width + '"/>';
  }
  svg += hand(hr * 30, 46, 7.5, 'hr');
  svg += hand(min * 6, 66, 5, 'min');
  if (CFG.showSeconds) svg += hand(sec * 6, 74, 2, 'sec');
  svg += '<circle class="pin" cx="100" cy="100" r="5"/></svg>';
  return svg;
}

function draw(){
  /* Tile sizing from the count and from the shape of the tile it produces.
     Deriving it from the row count alone was wrong the moment a row held three
     clocks: at three across, what limits a digital time is the WIDTH of its
     tile, not the height of its row, and the digits ran into the clock beside
     them. Measuring the tile in pixels and redrawing on resize costs nothing
     and cannot be wrong on a shape nobody tested. */
  var n = CLOCKS.length;
  var perRow = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  var rows = Math.ceil(n / perRow);

  var tileW = (root.clientWidth / perRow) * 0.88;
  var tileH = (root.clientHeight / rows) * 0.90;

  /* Character widths the longest time occupies: hh:mm, plus :ss when seconds
     are shown, plus a little for the AM/PM suffix — which is drawn at a third
     the size, so it counts for less than two characters. */
  var chars = (CFG.showSeconds ? 8 : 5) + (CFG.clock24 ? 0 : 0.9);
  var digitPx = Math.min(tileW / (chars * 0.6), tileH * (n === 1 ? 0.52 : 0.4));
  var facePx = Math.min(tileW, tileH * (n === 1 ? 0.94 : 0.8));
  var labelPx = Math.max(11, Math.min(digitPx * 0.2, tileH * 0.14));

  var html = '';
  for (var i = 0; i < n; i++) {
    var c = CLOCKS[i];
    var d = nowFor(c);
    html += '<div class="clock" style="flex-basis:' + (100 / perRow) + '%">';
    if (c.label) html += '<div class="label" style="font-size:' + labelPx + 'px">' + esc(c.label) + '</div>';
    html += CFG.style === 'analog' ? faceHtml(d, facePx) : digitalHtml(d, digitPx);
    var sub = dateLine(d);
    if (sub) html += '<div class="sub" style="font-size:' + (labelPx * 1.15) + 'px">' + esc(sub) + '</div>';
    html += '</div>';
  }
  root.innerHTML = html;
}

draw();
setInterval(draw, CFG.showSeconds ? 1000 : 15000);
window.addEventListener('resize', draw);
`
