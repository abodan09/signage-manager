import { Router } from 'express'

const PLAYER_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Signage Player</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000;font-family:Arial,Helvetica,sans-serif}
#player{position:relative;width:100vw;height:100vh;background:#000}

/* main content layers */
.layer{position:absolute;inset:0;display:none;opacity:0;transition:opacity 0.6s ease}
.layer.active{display:flex;opacity:1}

#image-layer{align-items:center;justify-content:center;background:#000}
#image-layer img{max-width:100%;max-height:100%;object-fit:contain}

#video-layer{background:#000}
#video-layer video{width:100%;height:100%;object-fit:contain}

#html-layer{background:#000}
#html-layer iframe{width:100%;height:100%;border:none}

/* text overlay — runs concurrently on top of main content */
#overlay-layer{
  position:absolute;inset:0;
  z-index:5;
  display:none;
  pointer-events:none;
  transition:opacity 0.5s ease;
}
#overlay-layer.active{display:flex}
.overlay-inner{
  width:100%;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:80px;
  word-break:break-word;
  line-height:1.4;
  text-align:center;
}

/* ticker bar — z-index above overlay */
#ticker-layer{
  position:absolute;left:0;right:0;bottom:0;
  height:72px;display:none;align-items:center;overflow:hidden;
  z-index:6;
}
#ticker-layer.active{display:flex}
.ticker-scroll{
  white-space:nowrap;
  display:inline-block;
  animation:ticker 30s linear infinite;
}
@keyframes ticker{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

/* progress bar (main content) */
#progress{
  position:absolute;bottom:0;left:0;height:4px;
  background:#3b82f6;width:0%;z-index:10;
}

/* OSD */
#osd{
  position:absolute;top:16px;right:16px;z-index:20;
  background:rgba(0,0,0,0.65);color:#fff;
  padding:6px 14px;border-radius:20px;font-size:13px;
  opacity:0;transition:opacity 0.4s;pointer-events:none;
}
#osd.show{opacity:1}

/* no-content screen */
#no-content{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;color:#555;
  font-size:28px;gap:20px;z-index:1;
}
#no-content .icon{font-size:72px}
</style>
</head>
<body>
<div id="player">
  <div id="image-layer" class="layer"><img id="img" src="" alt=""></div>
  <div id="video-layer" class="layer"><video id="vid" autoplay muted playsinline></video></div>
  <div id="html-layer"  class="layer"><iframe id="frame" src="" allowfullscreen></iframe></div>

  <!-- text overlay: always on top of main content, cycles independently -->
  <div id="overlay-layer">
    <div class="overlay-inner" id="overlay-inner"></div>
  </div>

  <!-- ticker bar -->
  <div id="ticker-layer"><div class="ticker-scroll" id="ticker-text"></div></div>

  <div id="progress"></div>
  <div id="osd"></div>
  <div id="no-content" style="display:none">
    <div class="icon">📺</div>
    <div>No active content scheduled</div>
  </div>
</div>
<script>
(function(){
  'use strict';

  function qs(sel){ return document.querySelector(sel); }

  function uuid(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
      var r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);
    });
  }

  // ── device identity ────────────────────────────────────────────────────────

  var params   = new URLSearchParams(location.search);
  var deviceId = params.get('deviceId') || localStorage.getItem('signage_device_id') || uuid();
  localStorage.setItem('signage_device_id', deviceId);
  if (!params.get('deviceId')) history.replaceState({}, '', '?deviceId=' + deviceId);

  var BASE = location.origin;

  // ── state ──────────────────────────────────────────────────────────────────

  var fullPlaylist   = [];   // all active items from server
  var mainPlaylist   = [];   // image / video / html
  var overlayItems   = [];   // text (center/top/bottom) — run concurrently
  var tickerItems    = [];   // text (ticker position)

  var mainIndex    = 0;
  var overlayIndex = 0;
  var tickerIndex  = 0;

  var mainTimer    = null;
  var overlayTimer = null;
  var tickerTimer  = null;
  var ws           = null;

  var progressStart    = null;
  var progressDuration = 0;
  var progressRAF      = null;

  // ── OSD ────────────────────────────────────────────────────────────────────

  var osdTimer = null;
  function showOSD(msg, durationMs) {
    var el = qs('#osd');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(osdTimer);
    if (durationMs > 0) osdTimer = setTimeout(function(){ el.classList.remove('show'); }, durationMs);
  }

  // ── progress bar ───────────────────────────────────────────────────────────

  function startProgress(durationMs) {
    var bar = qs('#progress');
    bar.style.transition = 'none';
    bar.style.width = '0%';
    progressDuration = durationMs;
    progressStart    = performance.now();
    cancelAnimationFrame(progressRAF);
    function step() {
      var elapsed = performance.now() - progressStart;
      var pct = Math.min(100, (elapsed / durationMs) * 100);
      bar.style.width = pct + '%';
      if (pct < 100) progressRAF = requestAnimationFrame(step);
    }
    progressRAF = requestAnimationFrame(step);
  }

  function clearProgress() {
    cancelAnimationFrame(progressRAF);
    var bar = qs('#progress');
    bar.style.transition = 'none';
    bar.style.width = '0%';
  }

  // ── layers ─────────────────────────────────────────────────────────────────

  var MAIN_LAYERS = ['image-layer', 'video-layer', 'html-layer'];

  function hideMainLayers() {
    MAIN_LAYERS.forEach(function(id) {
      var el = qs('#' + id);
      el.classList.remove('active');
      el.style.display = 'none';
    });
    qs('#no-content').style.display = 'none';
    var vid = qs('#vid');
    vid.pause();
    vid.src = '';
    qs('#frame').src = '';
  }

  function showLayer(id) {
    hideMainLayers();
    var el = qs('#' + id);
    el.style.display = 'flex';
    el.getBoundingClientRect(); // force reflow → triggers transition
    el.classList.add('active');
  }

  // ── scheduling ─────────────────────────────────────────────────────────────

  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  function isScheduledNow(item) {
    if (item.scheduleMode === 'loop')   return true;
    if (item.scheduleMode === 'manual') return false;
    if (item.scheduleMode === 'scheduled') {
      var now = new Date();
      var day  = DAYS[now.getDay()];
      var days = item.scheduleDays || DAYS;
      if (days.indexOf(day) === -1) return false;
      var hh  = String(now.getHours()).padStart(2, '0');
      var mm  = String(now.getMinutes()).padStart(2, '0');
      var cur = hh + ':' + mm;
      var start = item.scheduleStartTime || '00:00';
      var end   = item.scheduleEndTime   || '23:59';
      return cur >= start && cur <= end;
    }
    return false;
  }

  function splitPlaylist() {
    var active = fullPlaylist.filter(function(i){ return i.isActive && isScheduledNow(i); });
    active.sort(function(a, b){ return a.orderIndex - b.orderIndex; });

    mainPlaylist  = active.filter(function(i){ return i.type !== 'text'; });
    overlayItems  = active.filter(function(i){ return i.type === 'text' && i.textPosition !== 'ticker'; });
    tickerItems   = active.filter(function(i){ return i.type === 'text' && i.textPosition === 'ticker'; });
  }

  // ── main content playback ──────────────────────────────────────────────────

  function playMain(item) {
    clearTimeout(mainTimer);
    clearProgress();
    var dur = (item.durationSeconds || 10) * 1000;

    if (item.type === 'image') {
      showLayer('image-layer');
      qs('#img').src = BASE + item.filePath;
      startProgress(dur);
      mainTimer = setTimeout(nextMain, dur);

    } else if (item.type === 'video') {
      showLayer('video-layer');
      var vid = qs('#vid');
      vid.src = BASE + item.filePath;
      vid.play().catch(function(){});
      startProgress(dur);
      var advanced = false;
      function advance() { if (advanced) return; advanced = true; clearTimeout(mainTimer); nextMain(); }
      vid.onended = advance;
      mainTimer = setTimeout(advance, dur);

    } else if (item.type === 'html') {
      showLayer('html-layer');
      qs('#frame').src = item.htmlUrl || '';
      startProgress(dur);
      mainTimer = setTimeout(nextMain, dur);
    }
  }

  function nextMain() {
    if (mainPlaylist.length === 0) {
      hideMainLayers();
      qs('#no-content').style.display = 'flex';
      mainTimer = setTimeout(nextMain, 15000);
      return;
    }
    if (mainIndex >= mainPlaylist.length) mainIndex = 0;
    var item = mainPlaylist[mainIndex];
    mainIndex = (mainIndex + 1) % mainPlaylist.length;
    playMain(item);
  }

  // ── text overlay playback (concurrent) ────────────────────────────────────

  function showOverlayItem(item) {
    var layer   = qs('#overlay-layer');
    var inner   = qs('#overlay-inner');
    var opacity = (item.overlayOpacity != null ? item.overlayOpacity : 85) / 100;
    var align   = { center: 'center', top: 'flex-start', bottom: 'flex-end' }[item.textPosition || 'center'] || 'center';
    var bgColor = item.textBgColor === 'transparent' ? 'transparent' : (item.textBgColor || 'rgba(0,0,0,0.75)');

    layer.style.opacity      = String(opacity);
    layer.style.alignItems   = align;
    layer.style.background   = 'transparent';

    inner.textContent        = item.textContent || '';
    inner.style.fontSize     = (item.textFontSize || 72) + 'px';
    inner.style.color        = item.textFgColor || '#ffffff';
    inner.style.background   = bgColor;
    inner.style.borderRadius = bgColor === 'transparent' ? '0' : '12px';
    inner.style.padding      = bgColor === 'transparent' ? '0' : '16px 32px';

    layer.style.display = 'flex';
    layer.getBoundingClientRect();
    layer.classList.add('active');
  }

  function hideOverlay() {
    var layer = qs('#overlay-layer');
    layer.classList.remove('active');
    layer.style.display = 'none';
  }

  function nextOverlay() {
    clearTimeout(overlayTimer);
    if (overlayItems.length === 0) { hideOverlay(); return; }
    if (overlayIndex >= overlayItems.length) overlayIndex = 0;
    var item = overlayItems[overlayIndex];
    overlayIndex = (overlayIndex + 1) % overlayItems.length;
    showOverlayItem(item);
    var dur = (item.durationSeconds || 10) * 1000;
    overlayTimer = setTimeout(nextOverlay, dur);
  }

  // ── ticker playback ────────────────────────────────────────────────────────

  function showTickerItem(item) {
    var tl = qs('#ticker-layer');
    var tt = qs('#ticker-text');
    tl.style.background = item.textBgColor === 'transparent' ? 'rgba(0,0,0,0.8)' : (item.textBgColor || '#111');
    tt.textContent      = item.textContent || '';
    tt.style.fontSize   = (item.textFontSize || 48) + 'px';
    tt.style.color      = item.textFgColor || '#fff';
    var speed = Math.max(8, (item.textContent || '').length * 0.12);
    tt.style.animationDuration = speed + 's';
    tl.classList.add('active');
  }

  function nextTicker() {
    clearTimeout(tickerTimer);
    var tl = qs('#ticker-layer');
    if (tickerItems.length === 0) { tl.classList.remove('active'); return; }
    if (tickerIndex >= tickerItems.length) tickerIndex = 0;
    var item = tickerItems[tickerIndex];
    tickerIndex = (tickerIndex + 1) % tickerItems.length;
    showTickerItem(item);
    var dur = (item.durationSeconds || 30) * 1000;
    tickerTimer = setTimeout(nextTicker, dur);
  }

  // ── playlist refresh ───────────────────────────────────────────────────────

  function rebuildAndRestart() {
    splitPlaylist();

    // Main
    clearTimeout(mainTimer);
    mainIndex = 0;
    nextMain();

    // Overlay
    clearTimeout(overlayTimer);
    overlayIndex = 0;
    nextOverlay();

    // Ticker
    clearTimeout(tickerTimer);
    tickerIndex = 0;
    nextTicker();
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  function connectWS() {
    var wsUrl = BASE.replace(/^http/, 'ws');
    try { ws = new WebSocket(wsUrl); } catch(e){ setTimeout(connectWS, 5000); return; }

    ws.onopen = function() {
      ws.send(JSON.stringify({ type: 'register', deviceId: deviceId, name: 'TV-' + deviceId.slice(0, 6) }));
      showOSD('Connected', 2500);
    };

    ws.onmessage = function(evt) {
      try {
        var msg = JSON.parse(evt.data);
        if (msg.type === 'playlist_update') {
          fetchPlaylist(rebuildAndRestart);
        } else if (msg.type === 'manual_push' && msg.content) {
          clearTimeout(mainTimer);
          mainIndex = 0;
          playMain(msg.content);
          var manualDur = (msg.content.durationSeconds || 10) * 1000 + 800;
          mainTimer = setTimeout(nextMain, manualDur);
        }
      } catch(e) {}
    };

    ws.onclose = function() { showOSD('Reconnecting…', 0); setTimeout(connectWS, 4000); };
    ws.onerror = function() { ws.close(); };
  }

  // ── fetch playlist ─────────────────────────────────────────────────────────

  function fetchPlaylist(cb) {
    fetch(BASE + '/api/content/active')
      .then(function(r){ return r.json(); })
      .then(function(data){
        fullPlaylist = data.items || [];
        if (cb) cb();
      })
      .catch(function(){ setTimeout(function(){ fetchPlaylist(cb); }, 5000); });
  }

  function registerDevice() {
    fetch(BASE + '/api/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: deviceId, name: 'TV-' + deviceId.slice(0, 6) }),
    }).catch(function(){});
  }

  // ── init ───────────────────────────────────────────────────────────────────

  registerDevice();
  connectWS();
  fetchPlaylist(rebuildAndRestart);

  // re-check schedule every minute
  setInterval(function(){
    splitPlaylist();
  }, 60000);

})();
</script>
</body>
</html>`

export function createPlayerRouter() {
  const router = Router()

  router.get('/player', (_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.send(PLAYER_HTML)
  })

  return router
}
