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
/* NOTE: no CSS "inset" shorthand anywhere in this file — TV WebViews are often
   Chromium < 87 (TCL/Hisense ship 66-83) which silently drops it, collapsing
   every absolutely-positioned layer to 0x0. Use explicit edges. */
.layer{position:absolute;top:0;left:0;right:0;bottom:0;display:none;opacity:0;transition:opacity 0.6s ease}
.layer.active{display:flex;opacity:1}

#image-layer{align-items:center;justify-content:center;background:#000}
#image-layer img{max-width:100%;max-height:100%;object-fit:contain}

#video-layer{background:#000}
#video-layer video{width:100%;height:100%;object-fit:contain}

#html-layer{background:#000}
#html-layer iframe{width:100%;height:100%;border:none}

/* text overlay — runs concurrently on top of main content */
#overlay-layer{
  position:absolute;top:0;left:0;right:0;bottom:0;
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
  position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;color:#555;
  font-size:28px;z-index:1;
}
/* margin, not flex gap: gap in a flex container is Chrome 84+, so on webOS 4
   this screen would render with everything jammed together. */
#no-content .icon{font-size:72px;margin-bottom:20px}

/* template chrome */
#logo-layer{position:absolute;display:none;align-items:center;justify-content:flex-start}
#logo-layer.on{display:flex}
#logo-layer img{max-width:100%;max-height:100%;object-fit:contain}
#clock-layer{
  position:absolute;display:none;flex-direction:column;align-items:flex-end;
  color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.6);line-height:1.1;
}
#clock-layer.on{display:flex}
#clock-time{font-size:44px;font-weight:bold}
#clock-date{font-size:18px;opacity:0.8}

/* pairing screen — shown until this screen has been claimed by a manager.
   No flexbox gap and no CSS inset: both are unsupported on webOS 4 / Chrome 53. */
#pair-screen{
  position:absolute;top:0;left:0;right:0;bottom:0;
  display:none;z-index:50;background:#0b1220;color:#e8eef6;
  text-align:center;
}
#pair-screen.active{display:block}
.pair-inner{
  position:absolute;top:50%;left:0;right:0;
  transform:translateY(-50%);
  padding:0 40px;
}
#pair-screen h1{font-size:34px;font-weight:normal;color:#93a7c0;margin-bottom:28px}
#pair-code{
  font-family:"Courier New",Courier,monospace;
  font-size:96px;letter-spacing:14px;font-weight:bold;color:#4cc9ff;
  margin-bottom:12px;word-break:break-all;
}
#pair-hint{font-size:22px;color:#93a7c0;line-height:1.5;margin-bottom:8px}
#pair-status{font-size:18px;color:#55688a;margin-top:26px}
#pair-screen .brand{
  position:absolute;bottom:36px;left:0;right:0;
  font-size:15px;color:#3a4a63;
}
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

  <div id="logo-layer" style="display:none"><img id="logo-img" src="" alt=""></div>
  <div id="clock-layer" style="display:none"><span id="clock-time"></span><span id="clock-date"></span></div>

  <div id="progress"></div>
  <div id="osd"></div>
  <div id="no-content" style="display:none">
    <div class="icon">📺</div>
    <div>No active content scheduled</div>
  </div>

  <div id="pair-screen">
    <div class="pair-inner">
      <h1>Add this screen in Signage Manager</h1>
      <div id="pair-code">••••-••••</div>
      <div id="pair-hint">Open Signage Manager on your PC, go to <b>Devices</b>, and enter this code.</div>
      <div id="pair-status">Waiting for approval…</div>
    </div>
    <div class="brand">Signage Player</div>
  </div>
</div>
<script>
(function(){
  'use strict';

  function qs(sel){ return document.querySelector(sel); }

  function pad2(n){ return (n < 10 ? '0' : '') + n; }

  function uuid(){
    // crypto.getRandomValues works on plain http; crypto.subtle does not, so
    // never reach for randomUUID here.
    var buf = null;
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        buf = new Uint8Array(16);
        window.crypto.getRandomValues(buf);
      }
    } catch (e) { buf = null; }
    var i = 0;
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
      var r = buf ? (buf[i++ % 16] & 15) : (Math.random()*16|0);
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ── device identity ────────────────────────────────────────────────────────

  var params   = new URLSearchParams(location.search);
  // Preview mode (the template gallery in the manager). It must never register,
  // never open a socket, and never touch stored identity — otherwise it leaks a
  // phantom "online TV" and can steal a real browser player's device id.
  var PREVIEW  = params.get('preview') === '1';
  var deviceId = params.get('deviceId') || (PREVIEW ? 'preview' : (localStorage.getItem('signage_device_id') || uuid()));
  if (!PREVIEW) localStorage.setItem('signage_device_id', deviceId);

  // A native shell hands the token over in the URL fragment: #t=<token>.
  // The fragment (not the query string) because these WebViews predate
  // Chrome 85's referrer default, so a token in ?query would leak through the
  // Referer header to any external site an "html" content item loads.
  var TOKEN_KEY = 'signage_device_token';
  var hash = location.hash || '';
  var mToken = hash.match(/[#&]t=([^&]+)/);
  if (mToken) {
    try { localStorage.setItem(TOKEN_KEY, decodeURIComponent(mToken[1])); } catch (e) {}
  }
  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }

  // Always rewrite the address so the token never lingers in the URL bar,
  // history, or a screenshot of the TV.
  try { history.replaceState({}, '', location.pathname + '?deviceId=' + deviceId); } catch (e) {}

  var BASE = location.origin;
  var PLAYER_VERSION = '__APP_VERSION__';

  function detectPlatform(){
    var ua = navigator.userAgent || '';
    if (/web0s|webos/i.test(ua)) return 'webos';
    if (/tizen/i.test(ua))       return 'tizen';
    if (/android/i.test(ua))     return 'android';
    return 'browser';
  }

  function authHeaders(extra){
    var h = extra || {};
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  function clearToken(){
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

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

  // ── template / layout ──────────────────────────────────────────────────────

  var template = null;
  var clockTimer = null;

  // Cached so a TV powering on while the manager is off still renders with its
  // last known layout instead of falling back to bare fullscreen.
  try {
    var cached = localStorage.getItem('signage_template');
    if (cached) template = JSON.parse(cached);
  } catch (e) { template = null; }

  function len(v){
    if (v === undefined || v === null) return 'auto';
    if (typeof v === 'number') return v + '%';
    return String(v);
  }

  var SLOT_EL = {
    main:    ['#image-layer', '#video-layer', '#html-layer'],
    overlay: ['#overlay-layer'],
    ticker:  ['#ticker-layer'],
    logo:    ['#logo-layer'],
    clock:   ['#clock-layer'],
    progress:['#progress']
  };

  function applyZone(el, zone){
    if (!el || !zone) return;
    var s = el.style;
    // Every edge is written explicitly — zones are re-applied in place when the
    // template changes, so a value left over from the previous layout would
    // otherwise survive. Never the 'inset' shorthand (Chromium < 87 drops it).
    s.left   = len(zone.left);
    s.right  = len(zone.right);
    s.top    = len(zone.top);
    s.bottom = len(zone.bottom);
    s.width  = zone.width  === undefined ? 'auto' : len(zone.width);
    s.height = zone.height === undefined ? 'auto' : len(zone.height);
    s.zIndex = String(zone.z);
    if (zone.pad !== undefined) s.padding = len(zone.pad);
  }

  function applyTemplate(t){
    if (!t || !t.zones) return;
    template = t;
    try { localStorage.setItem('signage_template', JSON.stringify(t)); } catch (e) {}

    var theme = t.theme || {};
    var player = qs('#player');
    if (theme.bgColor) { player.style.background = theme.bgColor; document.body.style.background = theme.bgColor; }
    if (t.fontFamily)  { document.body.style.fontFamily = t.fontFamily; }

    for (var slot in SLOT_EL) {
      if (!SLOT_EL.hasOwnProperty(slot)) continue;
      var zone = t.zones[slot];
      if (!zone) continue;
      var sels = SLOT_EL[slot];
      for (var i = 0; i < sels.length; i++) {
        var el = qs(sels[i]);
        if (!el) continue;
        applyZone(el, zone);
        // Hidden zones are collapsed, not just transparent, so a hidden video
        // zone releases its decoder on low-RAM TVs.
        if (zone.visible === false) { el.style.display = 'none'; el.setAttribute('data-zone-hidden', '1'); }
        else { el.removeAttribute('data-zone-hidden'); }
      }
    }

    // Media fit applies to image/video only — object-fit does nothing on iframes.
    var fit = (t.zones.main && t.zones.main.fit) || 'contain';
    var img = qs('#img'), vid = qs('#vid');
    if (img) img.style.objectFit = fit;
    if (vid) vid.style.objectFit = fit;

    var prog = qs('#progress');
    if (prog && theme.brandColor) prog.style.background = theme.brandColor;

    applyChrome(theme);
    applyOverlayTheme();
  }

  function applyChrome(theme){
    var logo = qs('#logo-layer'), logoImg = qs('#logo-img');
    var showLogo = theme.showLogo && theme.logoPath && template.zones.logo && template.zones.logo.visible !== false;
    if (showLogo) { logoImg.src = BASE + theme.logoPath; logo.classList.add('on'); logo.style.display = 'flex'; }
    else { logo.classList.remove('on'); logo.style.display = 'none'; logoImg.src = ''; }

    var clock = qs('#clock-layer');
    var showClock = theme.showClock && template.zones.clock && template.zones.clock.visible !== false;
    clearInterval(clockTimer);
    if (showClock) {
      clock.classList.add('on'); clock.style.display = 'flex';
      qs('#clock-date').style.display = theme.showClockDate ? 'block' : 'none';
      tickClock(theme);
      clockTimer = setInterval(function(){ tickClock(theme); }, 10000);
    } else {
      clock.classList.remove('on'); clock.style.display = 'none';
    }
  }

  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAYNAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function tickClock(theme){
    var now = new Date();
    var h = now.getHours(), m = pad2(now.getMinutes()), suffix = '';
    if (theme.clockFormat === '12h') {
      suffix = h >= 12 ? ' PM' : ' AM';
      h = h % 12; if (h === 0) h = 12;
    } else {
      h = pad2(h);
    }
    qs('#clock-time').textContent = h + ':' + m + suffix;
    if (theme.showClockDate) {
      qs('#clock-date').textContent = DAYNAMES[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
    }
  }

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
      // pad2, not String.padStart — padStart is ES2017 and throws on webOS 4
      // (Chrome 53), which broke every scheduled item on those panels.
      var hh  = pad2(now.getHours());
      var mm  = pad2(now.getMinutes());
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

    // Detach the previous video's handlers so a late error/ended event can't
    // skip the item that replaced it, and release the decoder when leaving the
    // video layer (a hidden <video> keeps decoding on TV WebViews otherwise).
    var vprev = qs('#vid');
    vprev.onerror = null;
    vprev.onended = null;
    if (item.type !== 'video') {
      try { vprev.pause(); vprev.removeAttribute('src'); vprev.load(); } catch (e) {}
    }

    if (item.type === 'image') {
      showLayer('image-layer');
      var img = qs('#img');
      // Broken/undecodable image (or one too large for a low-RAM TV WebView):
      // skip ahead instead of sitting on a black screen. Small delay so a
      // playlist of all-broken items can't spin in a tight loop.
      img.onerror = function(){ clearTimeout(mainTimer); mainTimer = setTimeout(nextMain, 3000); };
      img.src = BASE + item.filePath;
      startProgress(dur);
      mainTimer = setTimeout(nextMain, dur);

    } else if (item.type === 'video') {
      showLayer('video-layer');
      var vid = qs('#vid');
      var advanced = false;
      function advance() { if (advanced) return; advanced = true; clearTimeout(mainTimer); nextMain(); }
      // Codec the TV WebView can't decode (HEVC/4K on old TCL Chromium etc.)
      // fires error — skip to the next item rather than hanging the layer.
      vid.onerror = function(){ setTimeout(advance, 3000); };
      vid.onended = advance;
      vid.src = BASE + item.filePath;
      vid.play().catch(function(){});
      startProgress(dur);
      mainTimer = setTimeout(advance, dur);

    } else if (item.type === 'html') {
      showLayer('html-layer');
      qs('#frame').src = item.htmlUrl || '';
      startProgress(dur);
      mainTimer = setTimeout(nextMain, dur);

    } else if (item.type === 'design') {
      // A design is rendered by the manager itself, so the frame is same-origin
      // and needs no token: /tv is open to the LAN exactly like this page.
      showLayer('html-layer');
      qs('#frame').src = BASE + '/tv/scene/' + encodeURIComponent(item.designId || '');
      startProgress(dur);
      mainTimer = setTimeout(nextMain, dur);

    } else {
      // Unknown type — never leave the rotation without a pending timer, or the
      // wall freezes on whatever was showing before.
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

  function hexToRgba(hex, pct){
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return 'rgba(0,0,0,' + (pct / 100) + ')';
    return 'rgba(' + parseInt(m[1],16) + ',' + parseInt(m[2],16) + ',' + parseInt(m[3],16) + ',' + (pct / 100) + ')';
  }

  var currentOverlayItem = null;

  function showOverlayItem(item) {
    currentOverlayItem = item;
    var layer   = qs('#overlay-layer');
    var inner   = qs('#overlay-inner');
    // textPosition always routes/aligns the item — the theme never overrides it.
    var align   = { center: 'center', top: 'flex-start', bottom: 'flex-end' }[item.textPosition || 'center'] || 'center';
    var themed  = item.styleSource === 'theme' && template && template.theme;
    var theme   = themed ? template.theme : null;

    layer.style.alignItems = align;
    layer.style.background = 'transparent';

    var bgColor;
    if (themed) {
      // Opacity on the BAND only, so the words stay fully opaque. Items created
      // before templates keep the old whole-layer fade, so nothing already on a
      // wall changes.
      layer.style.opacity  = '1';
      bgColor              = hexToRgba(theme.bandColor, theme.bandOpacity);
      inner.style.color    = theme.textColor || '#ffffff';
      inner.style.fontSize = Math.round((item.textFontSize || 72) * (theme.fontScale || 1)) + 'px';
    } else {
      var opacity = (item.overlayOpacity != null ? item.overlayOpacity : 85) / 100;
      bgColor = item.textBgColor === 'transparent' ? 'transparent' : (item.textBgColor || 'rgba(0,0,0,0.75)');
      layer.style.opacity  = String(opacity);
      inner.style.color    = item.textFgColor || '#ffffff';
      inner.style.fontSize = (item.textFontSize || 72) + 'px';
    }

    inner.textContent        = item.textContent || '';
    inner.style.background   = bgColor;
    inner.style.borderRadius = bgColor === 'transparent' ? '0' : '12px';
    inner.style.padding      = bgColor === 'transparent' ? '0' : '16px 32px';

    layer.style.display = 'flex';
    layer.getBoundingClientRect();
    layer.classList.add('active');
  }

  /** Re-styles whatever is on screen when the template changes mid-rotation. */
  function applyOverlayTheme(){
    if (currentOverlayItem && qs('#overlay-layer').classList.contains('active')) {
      showOverlayItem(currentOverlayItem);
    }
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
    var themed = item.styleSource === 'theme' && template && template.theme;
    if (themed) {
      var th = template.theme;
      tl.style.background = hexToRgba(th.bandColor, th.bandOpacity);
      tt.style.color      = th.textColor || '#fff';
      tt.style.fontSize   = Math.round((item.textFontSize || 48) * (th.fontScale || 1)) + 'px';
    } else {
      tl.style.background = item.textBgColor === 'transparent' ? 'rgba(0,0,0,0.8)' : (item.textBgColor || '#111');
      tt.style.fontSize   = (item.textFontSize || 48) + 'px';
      tt.style.color      = item.textFgColor || '#fff';
    }
    tt.textContent      = item.textContent || '';
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
      var reg = { type: 'register', deviceId: deviceId, name: 'TV-' + deviceId.slice(0, 6) };
      if (token) reg.token = token;
      ws.send(JSON.stringify(reg));
      showOSD('Connected', 2500);
    };

    ws.onmessage = function(evt) {
      try {
        var msg = JSON.parse(evt.data);
        if (msg.type === 'unauthorized' || msg.type === 'unpaired') {
          // The manager revoked or deleted this screen: stop playing and ask to
          // be claimed again rather than leaving stale content on the wall.
          clearToken();
          try { ws.close(); } catch (e) {}
          startPairing();
          return;
        }
        if (msg.type === 'reload_player') { location.reload(); return; }
        if (msg.type === 'template_update' && msg.template) { applyTemplate(msg.template); return; }
        if (msg.template) applyTemplate(msg.template);
        if (msg.type === 'playlist_update') {
          fetchPlaylist(rebuildAndRestart);
        } else if (msg.type === 'manual_push' && msg.content) {
          clearTimeout(mainTimer);
          mainIndex = 0;
          playMain(msg.content);
          var manualDur = (msg.content.durationSeconds || 10) * 1000 + 800;
          mainTimer = setTimeout(nextMain, manualDur);
        } else if (msg.type === 'push_project' && msg.items && msg.items.length) {
          // Override playlist with project items; reset on next playlist_update
          clearTimeout(mainTimer); clearTimeout(overlayTimer);
          mainPlaylist  = msg.items.filter(function(i){ return i.type !== 'text'; });
          overlayItems  = msg.items.filter(function(i){ return i.type === 'text' && i.textPosition !== 'ticker'; });
          tickerItems   = msg.items.filter(function(i){ return i.type === 'text' && i.textPosition === 'ticker'; });
          mainIndex = 0; overlayIndex = 0; tickerIndex = 0;
          showOSD('Project: ' + (msg.project && msg.project.name ? msg.project.name : 'pushed'), 3000);
          nextMain();
          nextOverlay();
          nextTicker();
        }
      } catch(e) {}
    };

    ws.onclose = function() { showOSD('Reconnecting…', 0); setTimeout(connectWS, 4000); };
    ws.onerror = function() { ws.close(); };
  }

  // ── fetch playlist ─────────────────────────────────────────────────────────

  function fetchPlaylist(cb) {
    fetch(BASE + '/api/content/active?deviceId=' + encodeURIComponent(deviceId), { headers: authHeaders({}) })
      .then(function(r){ return r.json(); })
      .then(function(data){
        fullPlaylist = data.items || [];
        if (data.template) {
          try { applyTemplate(data.template); }
          catch (e) { showOSD('Layout error', 4000); }
        }
        // The callback runs in its own guard: a throw in here used to land in
        // the .catch below, which re-fetches every 5s — turning any rendering
        // bug into a permanent black screen with a silent request loop.
        if (cb) {
          try { cb(); }
          catch (e) { showOSD('Playback error', 4000); }
        }
      })
      .catch(function(){ setTimeout(function(){ fetchPlaylist(cb); }, 5000); });
  }

  function registerDevice(onUnauthorized) {
    fetch(BASE + '/api/devices/register', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: deviceId,
        name: 'TV-' + deviceId.slice(0, 6),
        platform: detectPlatform(),
        playerVersion: PLAYER_VERSION,
      }),
    }).then(function(r){
      if (r.status === 401) {
        clearToken();
        if (onUnauthorized) onUnauthorized();
        return null;
      }
      return r.json();
    }).then(function(d){
      // The server is authoritative about identity: adopt the id it returns so
      // a re-paired screen keeps one record instead of forking a new one.
      if (d && d.id && d.id !== deviceId) {
        deviceId = d.id;
        try { localStorage.setItem('signage_device_id', deviceId); } catch (e) {}
      }
    }).catch(function(){});
  }

  // ── pairing ────────────────────────────────────────────────────────────────

  var pairPollTimer = null;
  var pairing = false;

  function showPairScreen(show){
    var el = qs('#pair-screen');
    if (show) { el.classList.add('active'); }
    else { el.classList.remove('active'); }
  }

  function pairStatus(msg){ qs('#pair-status').textContent = msg; }

  function startPairing(){
    if (pairing) return;
    pairing = true;
    clearTimeout(mainTimer); clearTimeout(overlayTimer); clearTimeout(tickerTimer);
    hideMainLayers();
    qs('#overlay-layer').classList.remove('active');
    qs('#ticker-layer').classList.remove('active');
    showPairScreen(true);
    requestCode();
  }

  function stopPairing(){
    pairing = false;
    clearTimeout(pairPollTimer);
    showPairScreen(false);
  }

  function requestCode(){
    qs('#pair-code').textContent = '••••-••••';
    pairStatus('Contacting Signage Manager…');
    fetch(BASE + '/api/pair/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: detectPlatform(),
        playerVersion: PLAYER_VERSION,
        name: 'TV-' + deviceId.slice(0, 6),
      }),
    }).then(function(r){
      if (!r.ok) throw new Error('start failed');
      return r.json();
    }).then(function(d){
      qs('#pair-code').textContent = d.userCode;
      pairStatus('Waiting for approval…');
      var interval = (d.interval || 5) * 1000;
      // Ask for a fresh code when this one lapses, so a screen mounted days
      // before anyone claims it always shows a live code.
      var expiresAt = Date.now() + (d.expiresIn || 900) * 1000;
      pollPair(d.deviceCode, interval, expiresAt);
    }).catch(function(){
      pairStatus('Cannot reach Signage Manager. Retrying…');
      pairPollTimer = setTimeout(requestCode, 10000);
    });
  }

  function pollPair(deviceCode, interval, expiresAt){
    clearTimeout(pairPollTimer);
    pairPollTimer = setTimeout(function(){
      if (Date.now() > expiresAt) { requestCode(); return; }
      fetch(BASE + '/api/pair/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode: deviceCode }),
      }).then(function(r){
        if (r.status === 404) { requestCode(); return null; }
        return r.json();
      }).then(function(d){
        if (!d) return;
        if (d.status === 'paired') {
          token = d.token;
          try { localStorage.setItem(TOKEN_KEY, d.token); } catch (e) {}
          if (d.deviceId) {
            deviceId = d.deviceId;
            try { localStorage.setItem('signage_device_id', deviceId); } catch (e) {}
          }
          pairStatus('Paired! Starting…');
          stopPairing();
          startPlayback();
          return;
        }
        if (d.status === 'denied') { pairStatus('Request declined.'); pairPollTimer = setTimeout(requestCode, 5000); return; }
        if (d.status === 'slow_down' && d.interval) interval = d.interval * 1000;
        pollPair(deviceCode, interval, expiresAt);
      }).catch(function(){
        pollPair(deviceCode, interval, expiresAt);
      });
    }, interval);
  }

  // ── init ───────────────────────────────────────────────────────────────────

  function startPlayback(){
    registerDevice(startPairing);
    connectWS();
    fetchPlaylist(rebuildAndRestart);
  }

  if (PREVIEW) {
    // Render the requested template against whatever content exists, with no
    // registration, no socket and no stored state.
    var previewId = params.get('template');
    qs('#osd').style.display = 'none';
    fetch(BASE + '/api/templates/' + encodeURIComponent(previewId || 'builtin:fullscreen') + '/resolved')
      .then(function(r){ return r.json(); })
      .then(function(d){ if (d && d.template) applyTemplate(d.template); })
      .catch(function(){});
    fetch(BASE + '/api/content/active')
      .then(function(r){ return r.json(); })
      .then(function(d){
        fullPlaylist = d.items || [];
        try { rebuildAndRestart(); } catch (e) {}
      })
      .catch(function(){});
  } else {
    if (template) { try { applyTemplate(template); } catch (e) {} }
    startPlayback();
  }

  // re-check schedule every minute
  setInterval(function(){
    splitPlaylist();
  }, 60000);

})();
</script>
</body>
</html>`

export function createPlayerRouter(appVersion = '0.0.0') {
  const router = Router()
  const html = PLAYER_HTML.replace('__APP_VERSION__', appVersion)

  router.get('/player', (_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    // Keep the fragment token out of any Referer sent to an external page an
    // "html" content item might load.
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.send(html)
  })

  return router
}
