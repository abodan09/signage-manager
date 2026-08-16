// The Live TV page: a feed that fills the screen and an advert that visits a
// corner on a timer.
//
// Two notes that cannot live inside the blobs below, because the compatibility
// tests scan the emitted script as text — comments included — and would match
// the very words being discussed:
//
//  1. Nothing here uses a CSS transform, and that is deliberate. A TV decodes
//     video on a separate hardware plane and punches an alpha hole through the
//     web layer to show it, and that hole is computed from layout. A transform
//     is applied after layout, so a transformed layer near the video is the one
//     thing known to blank a live picture on these panels. The advert moves by
//     changing where it sits (left/top) and how opaque it is, which are layout
//     and paint — the coordinate space the hole already agrees with. This is
//     also why rotate, zoom and flip entrances are not offered at all.
//
//  2. The advert box is a fixed rectangle whose geometry never changes for the
//     life of the page; only the card inside it moves. That keeps the composited
//     region over the punched hole static and confines each repaint.

export const LIVETV_CSS = `
body{background:#000}
#root{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:#000}
#feed{position:absolute;top:0;left:0;right:0;bottom:0;background:#000}
#feed video,#feed img{position:absolute;top:0;left:0;width:100%;height:100%;display:block}
#feed iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;display:block}
#msg{position:absolute;top:50%;left:0;right:0;margin-top:-1.4em;text-align:center;
  color:rgba(255,255,255,.5);font-size:3vh;line-height:1.4;padding:0 8vw}
#msg.off{display:none}
#adbox{position:absolute;overflow:hidden;display:none}
#adcard{position:absolute;top:0;left:0;width:100%;height:100%;opacity:0}
#adcard img,#adcard video{position:absolute;top:0;left:0;width:100%;height:100%;display:block}
#adcard iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;display:block}
#adcard .txt{position:absolute;top:50%;left:0;right:0;margin-top:-.7em;text-align:center;
  color:#fff;font-size:2.4vh;padding:0 6%}
#adcard.anim{transition:opacity .4s ease-out,left .4s ease-out,top .4s ease-out}
`

export const LIVETV_JS = `
var feed = document.getElementById('feed');
var box  = document.getElementById('adbox');
var card = document.getElementById('adcard');
var msg  = document.getElementById('msg');
var msgText = document.getElementById('msgtext');

var MOVE_MS = 400;
var list = [];
var idx = 0;
var retries = 0;
var started = false, delayDone = false;
var playTimer = null, cycleTimer = null, retryTimer = null;

function fitOf(v){
  if (v === 'fill') return 'fill';
  if (v === 'cover') return 'cover';
  if (v === 'none') return 'none';
  return 'contain';
}

function showMessage(text){
  msgText.innerHTML = esc(text);
  msg.className = '';
}
function hideMessage(){ msg.className = 'off'; }

/* Only on a retry: appending anything to a live address on first load would
   break a signed or session-scoped stream URL for no reason. */
function bust(url){
  if (!retries) return url;
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_r=' + retries;
}

function feedFailed(){
  showMessage(CFG.offlineMessage);
  if (CFG.reconnectMs > 0) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function(){ retries++; buildFeed(); }, CFG.reconnectMs);
  }
}

function wireFeed(){
  var el = feed.firstChild;
  if (!el || !el.tagName) return;
  el.onerror = function(){ feedFailed(); };
  if (el.tagName === 'VIDEO') {
    /* A live feed that ends has dropped; a file that ends has finished. Both
       want the same thing here, which is to go back and get it again. */
    el.onended = function(){ feedFailed(); };
    el.onplaying = function(){ retries = 0; hideMessage(); };
    try {
      var p = el.play();
      if (p && p['catch']) p['catch'](function(){});
    } catch (e) {}
  } else if (el.tagName === 'IMG') {
    el.onload = function(){ retries = 0; hideMessage(); };
  }
}

function buildFeed(){
  var url = CFG.streamUrl;
  var fit = fitOf(CFG.videoFit);
  hideMessage();

  if (CFG.sourceType === 'hls') {
    /* Say so plainly rather than showing a black rectangle: this plays on the
       LG panels and not in the desktop preview, and an installer who sees
       nothing reasonably concludes the address is wrong. */
    var probe = document.createElement('video');
    var canHls = !!(probe.canPlayType && probe.canPlayType('application/vnd.apple.mpegurl'));
    if (!canHls) {
      feed.innerHTML = '';
      showMessage(CFG.hlsMessage);
      return;
    }
    feed.innerHTML = '<video autoplay muted playsinline style="object-fit:' + fit + '">' +
      '<source src="' + esc(url) + '" type="application/vnd.apple.mpegurl"></video>';
  } else if (CFG.sourceType === 'mjpeg') {
    feed.innerHTML = '<img src="' + esc(bust(url)) + '" alt="" style="object-fit:' + fit + '">';
  } else if (CFG.sourceType === 'embed') {
    feed.innerHTML = '<iframe src="' + esc(url) + '" frameborder="0" ' +
      'allow="autoplay; encrypted-media"></iframe>';
  } else {
    feed.innerHTML = '<video autoplay muted playsinline src="' + esc(bust(url)) +
      '" style="object-fit:' + fit + '"></video>';
  }
  wireFeed();
}

/* The advert rectangle, in the screen's own coordinates. Percentages keep one
   layout working on a 1080p panel and a 4K totem; pixels are there for a fixed
   creative that must not be resampled. */
function adGeometry(){
  var pos = CFG.position;
  var m = CFG.edgeMargin;
  var pct = CFG.sizeUnit === 'percent';
  var w = pct ? CFG.adWidthPct : CFG.adWidthPx;
  var h = pct ? CFG.adHeightPct : CFG.adHeightPx;
  var css = 'width:' + w + (pct ? '%' : 'px') + ';height:' + h + (pct ? '%' : 'px') + ';';

  if (pos === 'custom') {
    return css + 'left:' + CFG.customLeft + '%;top:' + CFG.customTop + '%;';
  }

  if (pos.indexOf('left') >= 0) css += 'left:' + m + '%;';
  else if (pos.indexOf('right') >= 0) css += 'right:' + m + '%;';
  else css += pct ? 'left:' + ((100 - w) / 2) + '%;' : 'left:calc(50% - ' + (w / 2) + 'px);';

  if (pos.indexOf('top') >= 0) css += 'top:' + m + '%;';
  else if (pos.indexOf('bottom') >= 0) css += 'bottom:' + m + '%;';
  else css += pct ? 'top:' + ((100 - h) / 2) + '%;' : 'top:calc(50% - ' + (h / 2) + 'px);';

  return css;
}

function placeStart(){
  var a = CFG.animation;
  card.style.left = '0';
  card.style.top = '0';
  card.style.opacity = '1';
  if (a === 'fade') card.style.opacity = '0';
  else if (a === 'slide-left') card.style.left = '-100%';
  else if (a === 'slide-right') card.style.left = '100%';
  else if (a === 'slide-up') card.style.top = '100%';
  else if (a === 'slide-down') card.style.top = '-100%';
}

function placeEnd(){
  card.style.left = '0';
  card.style.top = '0';
  card.style.opacity = '1';
}

function adHtml(it){
  var fit = fitOf(CFG.adScale);
  if (it.type === 'image') {
    return '<img src="' + esc(it.src) + '" alt="" style="object-fit:' + fit + '">';
  }
  if (it.type === 'video') {
    return '<video src="' + esc(it.src) + '" autoplay muted playsinline ' +
      'style="object-fit:' + fit + '"></video>';
  }
  if (it.type === 'text') return '<div class="txt">' + esc(it.text) + '</div>';
  if (it.url) {
    return '<iframe src="' + esc(it.url) + '" frameborder="0" ' +
      'allow="autoplay; encrypted-media"></iframe>';
  }
  return '';
}

function showAd(){
  if (!list.length) return;
  var it = list[idx % list.length];
  idx = (idx + 1) % list.length;

  card.innerHTML = adHtml(it);
  card.className = '';
  placeStart();
  box.style.display = 'block';
  /* Chrome 53 will not run a movement started in the same frame the element
     stopped being display:none. Reading a layout property forces the frame. */
  void card.offsetWidth;
  if (CFG.animation !== 'cut') card.className = 'anim';
  placeEnd();
}

function hideAd(){
  if (CFG.animation !== 'cut') {
    card.className = 'anim';
    placeStart();
  }
  setTimeout(function(){
    box.style.display = 'none';
    /* Clearing it releases the decoded image and stops an animated GIF that
       would otherwise keep ticking behind a hidden box for the whole gap. */
    card.innerHTML = '';
    card.className = '';
  }, CFG.animation === 'cut' ? 0 : MOVE_MS);
}

/* A chain of timeouts rather than an interval: over a screen's 24/7 run the
   drift of a repeating interval accumulates, and the advert slowly walks away
   from the schedule someone was sold. */
function tick(){
  if (list.length) {
    showAd();
    clearTimeout(playTimer);
    playTimer = setTimeout(hideAd, CFG.playMs);
  }
  clearTimeout(cycleTimer);
  cycleTimer = setTimeout(tick, CFG.cycleMs);
}

/* The advert list arrives over the network, so the opening delay can elapse
   before there is anything to show. Starting the cycle on the timer alone
   would then burn a whole interval on an empty screen — with a long interval,
   the first advert of the day simply never lands when anyone is watching. */
function maybeStart(){
  if (started || !delayDone || !list.length) return;
  started = true;
  tick();
}

function setList(payload){
  var items = (payload && payload.items) ? payload.items : [];
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    /* A second decoder is one more than most signage panels have. */
    if (it.type === 'video' && !CFG.allowVideoAds) continue;
    if (it.type === 'image' && !it.src) continue;
    out.push(it);
  }
  /* Deactivating the advert playlist should stop the adverts, not keep the
     last copy running until someone reboots the screen. */
  if (payload && payload.projectActive === false) out = [];
  list = out;
  /* Deleting a design or an app removes its playlist items too, so the list
     can shrink under a screen that has been up for a week. */
  if (idx >= list.length) idx = 0;
  maybeStart();
}

box.style.cssText = adGeometry();
if (CFG.adRadius > 0) box.style.borderRadius = CFG.adRadius + 'px';
if (CFG.adBackdrop) card.style.background = CFG.adBackdrop;

buildFeed();
pollData(CFG.adsUrl, CFG.pollMs, setList);
setTimeout(function(){ delayDone = true; maybeStart(); }, CFG.startDelayMs);

if (CFG.reloadMs > 0) {
  setTimeout(function(){ window.location.reload(); }, CFG.reloadMs);
}
`
