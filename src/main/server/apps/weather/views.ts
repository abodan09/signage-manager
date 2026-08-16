import type { ResolvedTheme } from '../render'

// The three weather layouts.
//
//   wall   A full-screen backdrop with the place pinned at the top, a large
//          icon and temperature, humidity and wind beneath, and a panel along
//          the bottom holding the clock and a day-per-column forecast strip.
//   split  Picture on one side, a panel on the other carrying the place, the
//          clock, the details and a large temperature, with the forecast in a
//          row underneath.
//   flat   No photography. A solid block on the left for the place, clock and
//          current temperature, then one column per day.
//
// Sizes are in vh/vw throughout: a signage layout has to hold together from a
// 1280x720 office panel to a 4K portrait totem, and there is no reflow pass to
// rescue it. Chrome 53 floor, so no CSS grid and no flex gap.

export const WEATHER_CSS = (t: ResolvedTheme) => `
body{color:${t.fg}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden}
.bg{position:absolute;top:0;left:0;right:0;bottom:0;background-size:cover;background-position:50% 50%}
.tint{position:absolute;top:0;left:0;right:0;bottom:0}
.ic svg{display:block}
.pin{display:inline-block;width:1em;height:1em;vertical-align:-.12em;margin-right:.35em}

/* ── wall ── */
.w-place{position:absolute;top:5vh;left:0;right:0;text-align:center;font-size:2.6vh;opacity:.9}
.w-now{position:absolute;top:14vh;left:0;right:0;text-align:center}
.w-now .ic{width:14vh;height:14vh;margin:0 auto 1vh}
.w-temp{font-size:11vh;font-weight:300;line-height:1}
.w-temp sup{font-size:3.4vh;font-weight:400;vertical-align:super;margin-left:.4vh}
.w-cond{font-size:2.6vh;opacity:.85;margin-top:.8vh}
.w-meta{font-size:2.3vh;opacity:.85;margin-top:1.6vh}
.w-meta span{margin:0 1.4vh}
.w-panel{position:absolute;left:4vw;right:4vw;bottom:5vh;border-radius:1.2vh;padding:2vh 2vw 2.4vh}
.w-clock{text-align:right;font-size:2vh;margin-bottom:1.4vh;opacity:.95}
.w-clock b{font-weight:600;margin-right:.8em}
.w-strip{display:flex;align-items:stretch;justify-content:space-between}
.w-day{flex:1;text-align:center;padding:1.4vh .4vw;border-radius:1vh}
.w-day.today{background:rgba(0,0,0,.28)}
.w-day .d{font-size:1.9vh;font-weight:600;margin-bottom:.8vh}
.w-day .ic{width:6vh;height:6vh;margin:0 auto .8vh}
.w-day .r{font-size:1.9vh;opacity:.92}

/* ── split ── */
.s-photo{position:absolute;left:0;top:0;bottom:0;width:38%;background-size:cover;background-position:50%}
.s-side{position:absolute;right:0;top:0;bottom:0;left:38%;padding:5vh 4vw}
.s-place{font-size:5vh;font-weight:600;line-height:1.1}
.s-when{font-size:2.2vh;opacity:.8;margin-top:.8vh}
.s-meta{font-size:2vh;opacity:.85;margin-top:2.4vh}
.s-meta span{display:block;margin-bottom:.7vh}
.s-big{position:absolute;right:4vw;top:5vh;text-align:right}
.s-big .ic{width:12vh;height:12vh;margin-left:auto}
.s-big .t{font-size:9vh;font-weight:300;line-height:1;margin-top:1vh}
.s-big .t sup{font-size:3vh;vertical-align:super}
.s-strip{position:absolute;left:38%;right:0;bottom:0;padding:0 4vw 5vh;display:flex;justify-content:space-between}
.s-day{flex:1;text-align:center;padding:1.2vh .3vw;border-radius:.8vh}
.s-day.today{background:rgba(255,255,255,.14)}
.s-day .d{font-size:1.6vh;font-weight:600;opacity:.85;margin-bottom:.6vh}
.s-day .ic{width:4.6vh;height:4.6vh;margin:0 auto .5vh}
.s-day .hi{font-size:1.8vh;font-weight:600}
.s-day .lo{font-size:1.6vh;opacity:.7}

/* ── flat ── */
.f-left{position:absolute;left:0;top:0;bottom:0;width:34%;padding:6vh 3vw;display:flex;flex-direction:column;justify-content:space-between}
.f-place{font-size:5.4vh;font-weight:600;line-height:1.1}
.f-when{margin-top:1.4vh;font-size:2.2vh;opacity:.75}
.f-when b{display:block;font-size:3vh;font-weight:400;opacity:.9;margin-bottom:.3vh}
.f-now{display:flex;align-items:center;justify-content:space-between}
.f-now .t{font-size:9vh;font-weight:300;line-height:1}
.f-now .t sup{font-size:3vh;vertical-align:super}
.f-now .ic{width:11vh;height:11vh}
.f-cols{position:absolute;left:34%;right:0;top:0;bottom:0;display:flex}
.f-col{flex:1;padding:6vh 1vw;text-align:center;display:flex;flex-direction:column;justify-content:space-between}
.f-col .d{font-size:2.4vh;font-weight:500}
.f-col .ic{width:8vh;height:8vh;margin:0 auto}
.f-col .hi{font-size:2.8vh}
.f-col .lo{font-size:2.8vh;opacity:.72}

#msg{position:absolute;top:50%;left:0;right:0;text-align:center;font-size:3vh;opacity:.6;margin-top:-1em;padding:0 8vw}

/* Open-Meteo's licence requires the credit to appear next to the data. A
   screen has no clickable link, so the text alone carries it — kept small and
   dim, but never optional. */
.attrib{position:absolute;right:1.6vh;bottom:1vh;font-size:1.3vh;opacity:.45;z-index:40;letter-spacing:.02em}
`

export const WEATHER_JS = `
var root = document.getElementById('root');
var last = null;

function icon(id){ return '<div class="ic">' + (ICONS[id] ? svgWrap(ICONS[id]) : '') + '</div>'; }
function svgWrap(paths){
  return '<svg viewBox="0 0 64 64" width="100%" height="100%" fill="none" stroke="currentColor" ' +
         'stroke-width="2.4" stroke-linecap="round">' + paths + '</svg>';
}
var PIN = '<svg class="pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';
var DROP = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" ' +
           'style="vertical-align:-.12em;margin-right:.3em"><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/></svg>';
var WIND = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" ' +
           'stroke-linecap="round" style="vertical-align:-.12em;margin-right:.3em">' +
           '<path d="M3 8h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 18h8"/></svg>';

var DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var DAYS_S = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* The board shows the time where the weather is, not where the manager is —
   a lobby screen in London reporting a New York office should read New York
   time. utcOffset comes from the forecast, so no timezone database is needed. */
function placeNow(offsetSeconds){
  var d = new Date();
  return new Date(d.getTime() + d.getTimezoneOffset() * 60000 + offsetSeconds * 1000);
}
function pad2(n){ return (n < 10 ? '0' : '') + n; }
function clockOf(d){
  var h = d.getHours(), m = pad2(d.getMinutes());
  if (CFG.clock24) return pad2(h) + ':' + m;
  var s = h >= 12 ? ' PM' : ' AM';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + m + s;
}
function dayLabel(iso, i, short){
  if (i === 0) return 'Today';
  var p = String(iso).split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return (short ? DAYS_S[d.getDay()] : DAYS[d.getDay()]) + (short ? ' ' + d.getDate() : '');
}
function deg(v){ return v + '&deg;'; }

function backdrop(){
  var bg = CFG.photo
    ? '<div class="bg" style="background-image:url(\\'' + CFG.photo + '\\')"></div>' +
      '<div class="tint" style="background:linear-gradient(to bottom,rgba(0,0,0,.15),rgba(0,0,0,.45))"></div>'
    : '<div class="bg" style="background-image:linear-gradient(160deg,' + CFG.gradientFrom + ',' + CFG.gradientTo + ')"></div>';
  return bg;
}

function drawWall(w){
  var meta = '';
  if (CFG.showDetails) {
    meta = '<div class="w-meta"><span>' + DROP + w.humidity + '%</span>' +
           '<span>' + WIND + w.wind + w.windUnit + '</span></div>';
  }
  var feels = CFG.showFeelsLike ? '<div class="w-cond">Feels like ' + deg(w.feelsLike) + '</div>' : '';
  var now = placeNow(w.utcOffset);

  var days = '';
  for (var i = 0; i < w.days.length; i++) {
    var d = w.days[i];
    days += '<div class="w-day' + (i === 0 ? ' today' : '') + '">' +
      '<div class="d">' + esc(dayLabel(d.date, i, true)) + '</div>' + icon(d.icon) +
      '<div class="r">' + deg(d.max) + ' &ndash; ' + deg(d.min) + '</div></div>';
  }

  root.innerHTML = backdrop() +
    '<div class="w-place">' + PIN + esc(w.place) + '</div>' +
    '<div class="w-now">' + icon(w.icon) +
      '<div class="w-temp">' + w.temp + '<sup>' + esc(w.tempUnit) + '</sup></div>' +
      '<div class="w-cond">' + esc(w.condition) + '</div>' + feels + meta +
    '</div>' +
    '<div class="w-panel" style="background:' + hexA(CFG.card, 0.55) + '">' +
      '<div class="w-clock"><b>' + clockOf(now) + '</b>' +
        DAYS[now.getDay()] + ', ' + MONTHS[now.getMonth()] + ' ' + now.getDate() + '</div>' +
      '<div class="w-strip">' + days + '</div>' +
    '</div>';
}

function drawSplit(w){
  var now = placeNow(w.utcOffset);
  var meta = '';
  if (CFG.showDetails) {
    meta = '<div class="s-meta"><span>' + DROP + w.humidity + '%</span>' +
           '<span>' + WIND + w.wind + w.windUnit + '</span>' +
           (CFG.showFeelsLike ? '<span>Feels like ' + deg(w.feelsLike) + '</span>' : '') + '</div>';
  }
  var days = '';
  for (var i = 0; i < w.days.length; i++) {
    var d = w.days[i];
    days += '<div class="s-day' + (i === 0 ? ' today' : '') + '">' +
      '<div class="d">' + esc(i === 0 ? 'TODAY' : dayLabel(d.date, i, true).toUpperCase()) + '</div>' +
      icon(d.icon) + '<div class="hi">' + deg(d.max) + '</div><div class="lo">' + deg(d.min) + '</div></div>';
  }

  var photo = CFG.photo
    ? '<div class="s-photo" style="background-image:url(\\'' + CFG.photo + '\\')"></div>'
    : '<div class="s-photo" style="background-image:linear-gradient(160deg,' + CFG.gradientFrom + ',' + CFG.gradientTo + ')"></div>';

  root.innerHTML =
    '<div class="bg" style="background:' + CFG.card + '"></div>' + photo +
    '<div class="s-side">' +
      '<div class="s-place">' + esc(w.place.split(',')[0]) + '</div>' +
      '<div class="s-when">' + clockOf(now) + ' ' + DAYS[now.getDay()] + ', ' +
        MONTHS[now.getMonth()] + ' ' + now.getDate() + '</div>' + meta +
      '<div class="s-big">' + icon(w.icon) +
        '<div class="t">' + w.temp + '<sup>' + esc(w.tempUnit) + '</sup></div></div>' +
    '</div>' +
    '<div class="s-strip">' + days + '</div>';
}

function drawFlat(w){
  var now = placeNow(w.utcOffset);
  var cols = '';
  for (var i = 0; i < w.days.length; i++) {
    var d = w.days[i];
    cols += '<div class="f-col" style="background:' + hexA(CFG.card, i === 0 ? 0.9 : (0.55 - i * 0.045)) + '">' +
      '<div class="d">' + esc(dayLabel(d.date, i, false)) + '</div>' + icon(d.icon) +
      '<div><div class="hi">' + deg(d.max) + '</div><div class="lo">' + deg(d.min) + '</div></div></div>';
  }
  root.innerHTML =
    '<div class="bg" style="background:' + hexA(CFG.card, 0.35) + '"></div>' +
    '<div class="f-left" style="background:' + CFG.card + '">' +
      '<div><div class="f-place">' + esc(w.place.split(',')[0]) + '</div>' +
        '<div class="f-when"><b>' + clockOf(now) + '</b>' + DAYS[now.getDay()] + ', ' +
        MONTHS[now.getMonth()] + ' ' + now.getDate() + '</div></div>' +
      '<div class="f-now"><div class="t">' + w.temp + '<sup>' + esc(w.tempUnit) + '</sup></div>' +
        icon(w.icon) + '</div>' +
    '</div>' +
    '<div class="f-cols">' + cols + '</div>';
}

/* Panels are tinted from one colour so a custom theme needs one picker rather
   than six. */
function hexA(hex, a){
  var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return 'rgba(0,0,0,' + a + ')';
  return 'rgba(' + parseInt(m[1],16) + ',' + parseInt(m[2],16) + ',' + parseInt(m[3],16) + ',' + a + ')';
}

function draw(){
  if (!last) return;
  if (CFG.style === 'split') drawSplit(last);
  else if (CFG.style === 'flat') drawFlat(last);
  else drawWall(last);
  /* Appended after every layout rather than inside each, so a new layout
     cannot ship without the credit. */
  var credit = document.createElement('div');
  credit.className = 'attrib';
  credit.textContent = CFG.attribution;
  root.appendChild(credit);
}

function onPayload(res){
  var w = res && res.data;
  if (!w || !w.days) {
    if (!last) root.innerHTML = '<div id="msg">' + esc(CFG.failed) + '</div>';
    return;
  }
  last = w;
  draw();
}

root.innerHTML = '<div id="msg">' + esc(CFG.waiting) + '</div>';
if (SEED && SEED.data) onPayload(SEED);

/* The clock has to tick even when the forecast has not changed. */
setInterval(draw, 30000);
var rt = null;
window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(draw, 300); });
pollData(CFG.dataUrl, 300000, onPayload);
`
