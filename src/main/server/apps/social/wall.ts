import type { ResolvedTheme } from '../render'

// The four Instagram wall layouts, as CSS plus one ES5 client script.
//
// Geometry, timings and the speed curve follow the reference product closely
// enough that a customer switching over sees the same wall: Single and Kiosk
// hold one post for the dwell time with a 600 ms cross-fade, Wall scrolls a
// masonry grid at a fixed pixels-per-frame, and Bricks swaps whole pages of
// tiles with a staggered entrance.
//
// Chrome 53 floor throughout: var only, no arrow functions, no template
// literals, no fetch, no CSS grid, no flex gap. transform IS used — these
// pages never contain <video>, so the player's no-transform rule (which exists
// to protect the TV's hardware video plane) does not apply.

export function socialWallCss(t: ResolvedTheme, scale: number): string {
  const s = (px: number) => (px * scale).toFixed(1) + 'px'
  return `
body{background:${t.bg};color:${t.fg}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden}
.ig-logo{position:absolute;z-index:20}
.ig-logo svg{display:block}

/* ── shared post furniture (single + kiosk) ── */
.pane{position:absolute;top:0;left:0;right:0;bottom:0;opacity:0;transition:opacity 600ms ease}
.pane.on{opacity:1}
.photo{position:absolute;background-position:50% 50%;background-size:cover;background-repeat:no-repeat}
.scrim{position:absolute;top:0;left:0;right:0;bottom:0}
.body{position:absolute;display:flex}
.inner{width:100%}
.head{display:flex;align-items:center;justify-content:space-between;
      transform:translateY(-20px);opacity:0;transition:all 600ms ease}
.pane.on .head{transform:translateY(0);opacity:1}
.who{display:flex;align-items:center;min-width:0}
.avatar{width:${s(100)};height:${s(100)};border-radius:50%;margin-right:${s(20)};
        background:${t.card};background-size:cover;background-position:50%;flex-shrink:0}
.name{font-size:${s(30)};font-weight:600;margin-bottom:${s(8)};line-height:1.15}
.handle{font-size:${s(21)};opacity:.75}
.ago{font-size:${s(18)};opacity:.6;margin-top:${s(4)}}
.qr{width:${s(110)};height:${s(110)};background:#fff;padding:${s(6)};border-radius:${s(8)};flex-shrink:0;margin-left:${s(20)}}
.caption{font-size:${s(20)};line-height:1.5;margin-top:${s(18)};
         transform:translateY(20px);opacity:0;transition:all 600ms ease;
         overflow:hidden;word-wrap:break-word}
.pane.on .caption{transform:translateY(0);opacity:1}

/* ── wall (masonry, continuous scroll) ── */
#wall{position:absolute;top:0;left:0;right:0}
.col{position:absolute;top:0}
.card{background:${t.card};border-radius:${s(8)};overflow:hidden;
      box-shadow:0 0 2vmin rgba(0,0,0,.35),0 0 2vmin rgba(0,0,0,.18);position:relative}
.card .ph{width:100%;display:block;background:${t.border}}
.card .meta{padding:${s(34)} ${s(14)} ${s(16)};text-align:center;position:relative}
.card .cav{position:absolute;top:${s(-30)};left:0;right:0;display:flex;justify-content:center}
.card .cav div{width:${s(60)};height:${s(60)};border-radius:50%;background:${t.card};
               background-size:cover;background-position:50%;border:${s(3)} solid ${t.card}}
.card .cname{font-size:${s(19)};font-weight:600;margin-top:${s(6)}}
.card .cmeta{font-size:${s(14)};opacity:.7;margin-bottom:${s(8)}}
.card .cdes{font-size:${s(14)};line-height:1.45;white-space:pre-wrap;word-wrap:break-word;opacity:.92}
.card .clogo{margin:${s(6)} auto ${s(4)};width:${s(30)};height:${s(30)}}

/* ── bricks (paged tiles) ── */
#bricks{position:absolute;top:0;left:0;right:0;bottom:0}
.tile{position:absolute;overflow:hidden;border-radius:${s(8)};background:${t.card};
      opacity:0;transition:transform 700ms ease,opacity 700ms ease}
.tile.on{opacity:1;transform:translate(0,0) scale(1)}
.tile .tph{position:absolute;top:0;left:0;right:0;bottom:0;background-size:cover;background-position:50%}
.tile .tcap{position:absolute;left:0;right:0;bottom:0;padding:${s(14)};
            font-size:${s(15)};line-height:1.35;color:#fff;
            background:linear-gradient(to bottom,rgba(0,0,0,0),rgba(0,0,0,.82));
            max-height:55%;overflow:hidden}
.tile .tname{font-weight:600;font-size:${s(16)};margin-bottom:${s(3)}}

/* ── scrolling strip (thin split-screen zones) ── */
#strip{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;overflow:hidden}
#striprow{white-space:nowrap;display:inline-block;padding-left:100%}
.sitem{display:inline-block;vertical-align:middle;margin-right:6vh;font-size:${s(22)}}
.sitem img{display:inline-block;vertical-align:middle;height:60%;max-height:14vh;
           border-radius:${s(4)};margin-right:2vh}
.sitem b{opacity:.7;font-weight:400;margin-right:1vh}

/* ── states ── */
#msg{position:absolute;top:50%;left:0;right:0;text-align:center;
     font-size:${s(28)};opacity:.55;padding:0 8%;margin-top:-1em}
#stale{position:absolute;right:${s(16)};bottom:${s(14)};font-size:${s(13)};opacity:.45;z-index:30}
`
}

/** Brand glyphs, drawn rather than fetched — a screen with no WAN still shows
 *  the branding, and there is no third-party request to fail. Which one a wall
 *  wears is the app's choice; everything else here is shared. */
export const FB_GLYPH =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden="true">' +
  '<path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85' +
  'c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.9h-2.33' +
  'V22c4.78-.76 8.44-4.92 8.44-9.94z"/></svg>'

export const IG_GLYPH =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="2" y="2" width="20" height="20" rx="5.5"/>' +
  '<circle cx="12" cy="12" r="4.2"/><circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none"/></svg>'

export const SOCIAL_WALL_JS = `
var root = document.getElementById('root');
var posts = [], profile = {}, idx = 0, mode = CFG.mode, timer = null, raf = null;
var lastKey = '';

function logoEl(sizePx, css){
  return '<div class="ig-logo" style="width:' + sizePx + 'px;height:' + sizePx + 'px;' + (css || '') + '">' + BRAND_SVG + '</div>';
}
function msg(text){ root.innerHTML = '<div id="msg">' + esc(text) + '</div>'; }

/* Thin split-screen zones can't show a wall at all, so the layout switches
   itself to a single marquee line — matching how the reference product
   behaves when it is dropped into a scrolling strip. */
function isStrip(){
  var w = window.innerWidth, h = window.innerHeight;
  return (w > h && h / w <= 0.16) || (h > w && w / h <= 0.16);
}

function pickMode(){
  if (isStrip()) return 'strip';
  return mode;
}

/* ── single & kiosk ── */
function layoutFor(p){
  if (!p.w || !p.h) return 'row';
  if (p.h >= p.w) return window.innerWidth <= 1024 ? 'row' : 'col';
  return 'row';
}

function postHead(p){
  var qr = CFG.qr ? '<div class="qr">' + QR_SVG + '</div>' : '';
  var av = p.avatar ? 'background-image:url(\\'' + p.avatar + '\\')' : '';
  return '<div class="head"><div class="who">' +
    '<div class="avatar" style="' + av + '"></div>' +
    '<div><div class="name">' + esc(p.displayName || p.username) + '</div>' +
    '<div class="handle">@' + esc(p.username) + '</div>' +
    '<div class="ago">' + esc(relTime(p.timestamp)) + '</div></div></div>' + qr + '</div>';
}

function drawSingle(){
  var p = posts[idx % posts.length];
  if (!p) { msg('Waiting for posts'); return; }
  var variant = layoutFor(p);
  var isKiosk = mode === 'kiosk';
  var html = '<div class="pane" id="pane">';

  if (variant === 'col') {
    html += '<div class="photo" style="left:0;top:0;width:50%;height:100%;background-image:url(\\'' + p.image + '\\')"></div>';
    html += '<div class="scrim" style="background:linear-gradient(to right,rgba(0,0,0,0) 10%,' + CFG.bg + ' 45%)"></div>';
    html += '<div class="body" style="left:50%;right:4%;top:0;bottom:0;align-items:center">';
  } else {
    html += '<div class="photo" style="left:0;top:0;width:100%;height:60%;background-image:url(\\'' + p.image + '\\')"></div>';
    html += '<div class="scrim" style="background:linear-gradient(to bottom,rgba(0,0,0,0) 10%,' + CFG.bg + ' 50%)"></div>';
    html += '<div class="body" style="left:8%;right:8%;top:52%;bottom:4%;align-items:flex-start">';
  }
  html += '<div class="inner">' + postHead(p) +
          '<div class="caption">' + esc(p.caption) + '</div></div></div>';
  html += logoEl(64, variant === 'col' ? 'right:20px;top:20px' : 'right:20px;bottom:20px');
  html += '</div>';
  root.innerHTML = html;

  var pane = document.getElementById('pane');
  var photo = pane.getElementsByClassName('photo')[0];
  if (isKiosk && photo) {
    /* Kiosk settles a slight zoom rather than sliding — the Ken Burns entrance. */
    photo.style.transform = 'scale(1.12)';
    photo.style.transition = 'transform ' + (CFG.dwell + 600) + 'ms linear';
  }
  setTimeout(function(){
    pane.className = 'pane on';
    if (isKiosk && photo) photo.style.transform = 'scale(1)';
  }, 30);
  setTimeout(function(){ pane.className = 'pane'; }, Math.max(700, CFG.dwell - 600));
  timer = setTimeout(function(){ idx = (idx + 1) % posts.length; drawSingle(); }, CFG.dwell);
}

/* ── wall ── */
function wallColumns(){
  var w = window.innerWidth;
  if (w <= 500) return 1;
  if (w <= 768) return 2;
  if (w <= 1024) return 3;
  if (w <= 1440) return 4;
  if (w <= 1800) return 5;
  if (w <= 2260) return 6;
  if (w <= 2560) return 7;
  return 8;
}

function cardHtml(p, wide){
  var av = p.avatar ? 'background-image:url(\\'' + p.avatar + '\\')' : '';
  var ratio = (p.w && p.h) ? (p.h / p.w) : 1;
  var ph = Math.round(wide * ratio);
  return '<div class="card">' +
    '<div class="ph" style="height:' + ph + 'px;background-image:url(\\'' + p.image + '\\');background-size:cover;background-position:50%"></div>' +
    '<div class="meta"><div class="cav"><div style="' + av + '"></div></div>' +
    '<div class="cname">' + esc(p.displayName || p.username) + '</div>' +
    '<div class="cmeta">@' + esc(p.username) + ' &bull; ' + esc(relTime(p.timestamp)) + '</div>' +
    '<div class="clogo">' + BRAND_SVG + '</div>' +
    '<div class="cdes">' + esc(p.caption) + '</div></div></div>';
}

function drawWall(){
  var cols = wallColumns();
  var gap = 10;
  var wide = Math.floor((window.innerWidth - gap * (cols + 1)) / cols);
  var html = '<div id="wall">';
  var heights = [], i;
  for (i = 0; i < cols; i++) { html += '<div class="col" id="c' + i + '" style="left:' + (gap + i * (wide + gap)) + 'px;width:' + wide + 'px"></div>'; heights.push(0); }
  html += '</div>' + logoEl(0, 'display:none');
  root.innerHTML = html;

  /* Two passes of the feed are laid out back to back so the scroll can loop
     without a visible seam or a jump back to the top. */
  var list = posts.concat(posts);
  for (i = 0; i < list.length; i++) {
    var shortest = 0, k;
    for (k = 1; k < cols; k++) if (heights[k] < heights[shortest]) shortest = k;
    var p = list[i];
    var col = document.getElementById('c' + shortest);
    var holder = document.createElement('div');
    holder.style.marginBottom = gap + 'px';
    holder.innerHTML = cardHtml(p, wide);
    col.appendChild(holder);
    var ratio = (p.w && p.h) ? (p.h / p.w) : 1;
    heights[shortest] += Math.round(wide * ratio) + 150 + gap;
  }

  var wall = document.getElementById('wall');
  var loopAt = 0;
  for (i = 0; i < cols; i++) loopAt = Math.max(loopAt, document.getElementById('c' + i).offsetHeight);
  loopAt = loopAt / 2;

  var top = 0;
  function step(){
    top += CFG.pxPerFrame;
    if (loopAt > 0 && top >= loopAt) top -= loopAt;
    wall.style.transform = 'translate3d(0,-' + top.toFixed(1) + 'px,0)';
    raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);
}

/* ── bricks ── */
function brickColumns(){
  var t = window.innerWidth / window.innerHeight;
  if (t > 1.5) return 4;
  if (t > 1.2) return 3;
  if (t > 0.85) return 2;
  if (t > 0.8) return 3;
  if (t > 0.5) return 4;
  return 3;
}

function drawBricks(){
  var cols = brickColumns();
  var rows = Math.max(2, Math.round(cols / (window.innerWidth / window.innerHeight)));
  var per = cols * rows;
  var gap = 10;
  var w = Math.floor((window.innerWidth - gap * (cols + 1)) / cols);
  var h = Math.floor((window.innerHeight - gap * (rows + 1)) / rows);
  var page = [], i;
  for (i = 0; i < per; i++) page.push(posts[(idx + i) % posts.length]);

  var html = '<div id="bricks">';
  var dirs = ['isDown', 'isUp', 'isLeft', 'isRight'];
  for (i = 0; i < page.length; i++) {
    var p = page[i];
    if (!p) continue;
    var cx = i % cols, cy = Math.floor(i / cols);
    var d = dirs[i % 4];
    var startTf = d === 'isDown' ? 'translateY(-150%)' : d === 'isUp' ? 'translateY(150%)'
      : d === 'isLeft' ? 'translateX(-150%)' : 'translateX(150%)';
    html += '<div class="tile" data-i="' + i + '" style="left:' + (gap + cx * (w + gap)) + 'px;top:' + (gap + cy * (h + gap)) +
      'px;width:' + w + 'px;height:' + h + 'px;transform:' + startTf + '">' +
      '<div class="tph" style="background-image:url(\\'' + p.image + '\\')"></div>' +
      (p.caption ? '<div class="tcap"><div class="tname">@' + esc(p.username) + '</div>' + esc(p.caption) + '</div>' : '') +
      '</div>';
  }
  html += '</div>' + logoEl(46, 'right:18px;top:18px');
  root.innerHTML = html;

  var tiles = document.getElementsByClassName('tile');
  for (i = 0; i < tiles.length; i++) {
    /* The start transform is inline, so it beats any stylesheet rule — the
       settled transform has to be written inline too, or the tiles never
       arrive and the grid stays scattered off its cells. */
    (function(el, n){
      setTimeout(function(){
        el.className = 'tile on';
        el.style.transform = 'translate(0,0) scale(1)';
      }, 60 + n * 90);
    })(tiles[i], i);
  }
  timer = setTimeout(function(){ idx = (idx + per) % posts.length; drawBricks(); }, CFG.dwell * 3);
}

/* ── strip ── */
function drawStrip(){
  var html = '<div id="strip"><div id="striprow">';
  for (var i = 0; i < posts.length; i++) {
    var p = posts[i];
    html += '<span class="sitem"><img src="' + p.image + '" alt=""><b>' + esc(relTime(p.timestamp)) + ':</b> ' + esc(p.caption) + '</span>';
  }
  html += '</div></div>';
  root.innerHTML = html;
  var row = document.getElementById('striprow');
  var x = window.innerWidth;
  function step(){
    x -= CFG.pxPerFrame * 1.6;
    if (x < -row.scrollWidth) x = window.innerWidth;
    row.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
    raf = requestAnimationFrame(step);
  }
  row.style.paddingLeft = '0';
  raf = requestAnimationFrame(step);
}

/* ── driver ── */
function stop(){
  if (timer) { clearTimeout(timer); timer = null; }
  if (raf) { cancelAnimationFrame(raf); raf = null; }
}

function draw(){
  stop();
  if (!posts.length) { msg(CFG.emptyMessage); return; }
  var m = pickMode();
  if (m === 'strip') drawStrip();
  else if (m === 'wall') drawWall();
  else if (m === 'bricks') drawBricks();
  else drawSingle();
}

function onPayload(res){
  var d = res && res.data;
  if (!d || !d.posts || !d.posts.length) {
    if (!posts.length) msg(res && res.error ? CFG.errorMessage : CFG.emptyMessage);
    return;
  }
  /* Only rebuild when the feed actually changed — a wall mid-scroll must not
     jump back to the top every time the poll returns the same posts. */
  var key = d.posts.length + ':' + d.posts[0].id + ':' + d.posts[d.posts.length - 1].id;
  if (key === lastKey) return;
  lastKey = key;
  posts = d.posts;
  profile = d.profile || {};
  idx = 0;
  draw();
}

var resizeTimer = null;
window.addEventListener('resize', function(){
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function(){ idx = 0; draw(); }, 400);
});

msg(CFG.loadingMessage);
pollData(CFG.dataUrl, 60000, onPayload);
`
