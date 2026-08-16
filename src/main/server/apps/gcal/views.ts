import type { ResolvedTheme } from '../render'

// The calendar layouts: a side panel carrying the clock, and a schedule beside
// it. Type is sized in vh so it reads from across a room on any panel, which is
// the whole reason this app draws the calendar instead of embedding Google's.

export const GCAL_CSS = (t: ResolvedTheme) => `
body{color:${t.fg}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;overflow:hidden}

/* side panel */
.side{position:relative;width:26%;min-width:220px;flex-shrink:0;overflow:hidden;background:${t.card}}
.side .bg{position:absolute;top:0;left:0;right:0;bottom:0;background-size:cover;background-position:50% 50%}
.side .tint{position:absolute;top:0;left:0;right:0;bottom:0;
  background:linear-gradient(to bottom,rgba(0,0,0,.35),rgba(0,0,0,.15) 40%,rgba(0,0,0,.65))}
.side .inner{position:absolute;top:0;left:0;right:0;bottom:0;padding:4vh 2.2vw;
  display:flex;flex-direction:column;justify-content:space-between;color:#fff}
.side .heading{font-size:2.6vh;letter-spacing:.14em;text-transform:uppercase;font-weight:500;
  text-shadow:0 2px 12px rgba(0,0,0,.6)}
.side .clock{font-size:7.4vh;font-weight:300;line-height:1;text-shadow:0 2px 16px rgba(0,0,0,.6)}
.side .clock span{font-size:3.4vh;margin-left:.6vh;font-weight:400}
.side .today{font-size:2.1vh;margin-top:1vh;opacity:.92;text-shadow:0 2px 10px rgba(0,0,0,.6)}

/* shared right pane */
.pane{flex:1;min-width:0;display:flex;flex-direction:column;background:${t.bg}}
.pane h2{font-size:2.9vh;font-weight:500;letter-spacing:.08em;text-align:center;
  padding:2.4vh 0 2vh;color:${t.fg};text-transform:uppercase}

/* agenda */
.days{flex:1;overflow:hidden;padding:0 2vw 2vh}
.dayrow{border-top:1px solid ${t.border}}
.dayhead{display:flex;align-items:center;justify-content:space-between;
  background:${t.card};padding:.9vh 1.2vw}
.dayhead .d{font-size:2.2vh;font-weight:600}
.dayhead .wx{font-size:2vh;opacity:.85;display:flex;align-items:center}
.dayhead .wx svg{width:2.6vh;height:2.6vh;margin-right:.6vh}
.ev{display:flex;align-items:center;padding:.62vh 1.2vw;font-size:1.9vh}
.ev .t{width:11vw;flex-shrink:0;opacity:.65;font-variant-numeric:tabular-nums}
.ev .dot{width:1vh;height:1vh;border-radius:50%;margin-right:.8vw;flex-shrink:0}
.ev .n{font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.ev .loc{opacity:.55;margin-left:.8vw;font-weight:400;white-space:nowrap;overflow:hidden}
.more{padding:.5vh 1.2vw;font-size:1.7vh;opacity:.55}
.none{padding:.7vh 1.2vw;font-size:1.8vh;opacity:.45}

/* month */
.grid{flex:1;padding:0 1.4vw 1.6vh;display:flex;flex-direction:column}
.wd{display:flex;padding-bottom:.6vh}
.wd div{flex:1;text-align:center;font-size:1.7vh;letter-spacing:.1em;opacity:.6;text-transform:uppercase}
.weeks{flex:1;display:flex;flex-direction:column}
.week{flex:1;display:flex;border-top:1px solid ${t.border}}
.cell{flex:1;min-width:0;border-right:1px solid ${t.border};padding:.5vh .5vw;position:relative;overflow:hidden}
.cell:last-child{border-right:0}
.cell.dim{opacity:.32}
.cell .top{display:flex;align-items:center;justify-content:space-between}
.cell .num{font-size:1.9vh;font-weight:500}
.cell .num.now{background:#1a73e8;color:#fff;border-radius:50%;
  width:3vh;height:3vh;display:inline-flex;align-items:center;justify-content:center;font-weight:600}
.cell .wx{font-size:1.5vh;opacity:.75;display:flex;align-items:center}
.cell .wx svg{width:2vh;height:2vh;margin-right:.3vh}
.cell .bar{margin-top:.4vh;font-size:1.4vh;background:#1a73e8;color:#fff;border-radius:.4vh;
  padding:.15vh .4vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cell .tiny{font-size:1.4vh;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* today */
.today-list{flex:1;padding:0 3vw 2vh;overflow:hidden}
.today-list .ev{font-size:3vh;padding:1.4vh 0;border-bottom:1px solid ${t.border}}
.today-list .ev .t{width:22vw;opacity:.7}
.today-list .ev .dot{width:1.6vh;height:1.6vh}

#msg{position:absolute;top:50%;left:0;right:0;text-align:center;font-size:2.6vh;opacity:.5}
`

export const GCAL_JS = `
var root = document.getElementById('root');
var events = [];
var weather = null;

var DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var DAYS_S = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
/* Google's palette, so an event that is blue in the calendar is blue on the
   wall — people navigate a busy board by colour before they read it. */
var DOTS = ['#7986cb','#33b679','#8e24aa','#e67c73','#f6bf26','#f4511e','#039be5','#616161','#3f51b5','#0b8043'];

function pad2(n){ return (n < 10 ? '0' : '') + n; }
function dayKey(d){ return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

function timeOf(ms){
  var d = new Date(ms), h = d.getHours(), m = pad2(d.getMinutes());
  if (CFG.clock24) return pad2(h) + ':' + m;
  var s = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + m + s;
}
function colourFor(title){
  var n = 0;
  for (var i = 0; i < title.length; i++) n = (n * 31 + title.charCodeAt(i)) & 0xffff;
  return DOTS[n % DOTS.length];
}

/* Weather is optional and read from a Weather app's own cache, so the board
   and any weather screen agree and the manager still makes one request. */
function wxFor(dateStr){
  if (!weather || !weather.days) return null;
  for (var i = 0; i < weather.days.length; i++) {
    if (weather.days[i].date === dateStr) return weather.days[i];
  }
  return null;
}
function wxHtml(dateStr){
  var w = wxFor(dateStr);
  if (!w) return '';
  var icon = (typeof ICONS !== 'undefined' && ICONS[w.icon]) ? ICONS[w.icon] : '';
  var svg = icon
    ? '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">' + icon + '</svg>'
    : '';
  return '<div class="wx">' + svg + esc(w.max) + '\\u00b0 / ' + esc(w.min) + '\\u00b0</div>';
}

function eventsOn(dayStart){
  var dayEnd = dayStart + 86400000;
  var out = [];
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    if (e.start < dayEnd && e.end > dayStart) {
      if (CFG.hideAllDay && e.allDay) continue;
      out.push(e);
    }
  }
  return out;
}

function sidePanel(){
  var now = new Date();
  var h = now.getHours(), suffix = '';
  if (!CFG.clock24) { suffix = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12; }
  else h = pad2(h);
  var bg = CFG.photo
    ? '<div class="bg" style="background-image:url(\\'' + CFG.photo + '\\')"></div><div class="tint"></div>'
    : '<div class="bg" style="background-image:linear-gradient(160deg,#3a4a5e,#1f2937)"></div><div class="tint"></div>';
  return '<div class="side">' + bg + '<div class="inner">' +
    '<div class="heading">' + esc(CFG.title) + '</div>' +
    '<div><div class="clock">' + h + ':' + pad2(now.getMinutes()) +
      (suffix ? '<span>' + suffix + '</span>' : '') + '</div>' +
    '<div class="today">' + DAYS[now.getDay()] + ', ' + MONTHS[now.getMonth()] + ' ' +
      now.getDate() + ', ' + now.getFullYear() + '</div></div>' +
    '</div></div>';
}

function evHtml(e, big){
  var when = e.allDay ? 'All day' : timeOf(e.start) + ' - ' + timeOf(e.end);
  return '<div class="ev"><div class="t">' + esc(when) + '</div>' +
    '<div class="dot" style="background:' + colourFor(e.title) + '"></div>' +
    '<div class="n">' + esc(e.title) +
      (e.location && big ? '<span class="loc">' + esc(e.location) + '</span>' : '') +
    '</div></div>';
}

function drawAgenda(){
  var now = new Date();
  var first = startOfDay(now);
  var html = '<div class="pane">';
  var last = new Date(first + 6 * 86400000);
  html += '<h2>' + MONTHS[now.getMonth()].slice(0, 3).toUpperCase() + ' ' + now.getDate() +
    ' \\u2013 ' + MONTHS[last.getMonth()].slice(0, 3).toUpperCase() + ' ' + last.getDate() +
    ', ' + last.getFullYear() + '</h2><div class="days">';

  for (var i = 0; i < 7; i++) {
    var d = new Date(first + i * 86400000);
    var list = eventsOn(startOfDay(d));
    html += '<div class="dayrow"><div class="dayhead"><div class="d">' +
      DAYS[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
      '</div>' + wxHtml(dayKey(d)) + '</div>';
    if (!list.length) html += '<div class="none">' + esc(CFG.empty) + '</div>';
    for (var k = 0; k < list.length && k < CFG.maxPerDay; k++) html += evHtml(list[k], true);
    if (list.length > CFG.maxPerDay) {
      html += '<div class="more">+ ' + (list.length - CFG.maxPerDay) + ' more</div>';
    }
    html += '</div>';
  }
  return html + '</div></div>';
}

function drawToday(){
  var now = new Date();
  var list = eventsOn(startOfDay(now));
  var html = '<div class="pane"><h2>' + DAYS[now.getDay()] + ', ' + MONTHS[now.getMonth()] +
    ' ' + now.getDate() + '</h2><div class="today-list">';
  if (!list.length) html += '<div class="none">' + esc(CFG.empty) + '</div>';
  for (var i = 0; i < list.length && i < CFG.maxPerDay + 4; i++) html += evHtml(list[i], true);
  return html + '</div></div>';
}

function drawMonth(){
  var now = new Date();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var gridStart = new Date(monthStart);
  gridStart.setDate(1 - monthStart.getDay());

  var html = '<div class="pane"><h2>' + MONTHS[now.getMonth()] + ' ' + now.getFullYear() + '</h2><div class="grid"><div class="wd">';
  for (var w = 0; w < 7; w++) html += '<div>' + DAYS_S[w] + '</div>';
  html += '</div><div class="weeks">';

  var todayKey = dayKey(now);
  for (var week = 0; week < 6; week++) {
    html += '<div class="week">';
    for (var dayIdx = 0; dayIdx < 7; dayIdx++) {
      var d = new Date(gridStart.getTime() + (week * 7 + dayIdx) * 86400000);
      var dim = d.getMonth() !== now.getMonth() ? ' dim' : '';
      var isToday = dayKey(d) === todayKey;
      var list = eventsOn(startOfDay(d));
      html += '<div class="cell' + dim + '"><div class="top">' + wxHtml(dayKey(d)) +
        '<div class="num' + (isToday ? ' now' : '') + '">' + d.getDate() + '</div></div>';
      for (var e = 0; e < list.length && e < 2; e++) {
        html += list[e].allDay
          ? '<div class="bar">' + esc(list[e].title) + '</div>'
          : '<div class="tiny">' + esc(timeOf(list[e].start)) + ' ' + esc(list[e].title) + '</div>';
      }
      if (list.length > 2) html += '<div class="tiny">+' + (list.length - 2) + '</div>';
      html += '</div>';
    }
    html += '</div>';
  }
  return html + '</div></div></div>';
}

function draw(){
  var body = CFG.view === 'month' ? drawMonth() : CFG.view === 'today' ? drawToday() : drawAgenda();
  root.innerHTML = sidePanel() + body;
}

function onPayload(res){
  var d = res && res.data;
  if (!d || !d.events) return;
  events = d.events;
  draw();
}

root.innerHTML = '<div id="msg">' + esc(CFG.waiting) + '</div>';
if (SEED && SEED.data) onPayload(SEED);

/* The clock has to move even when nothing in the calendar has changed. */
setInterval(draw, 30000);
pollData(CFG.dataUrl, 300000, onPayload);
if (CFG.weatherUrl) {
  pollData(CFG.weatherUrl, 900000, function(res){
    if (res && res.data) { weather = res.data; draw(); }
  });
}
`
