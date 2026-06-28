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

/* content layers */
.layer{position:absolute;inset:0;display:none;opacity:0;transition:opacity 0.6s ease}
.layer.active{display:flex;opacity:1}

#image-layer{align-items:center;justify-content:center;background:#000}
#image-layer img{max-width:100%;max-height:100%;object-fit:contain}

#video-layer{background:#000}
#video-layer video{width:100%;height:100%;object-fit:contain}

#html-layer{background:#000}
#html-layer iframe{width:100%;height:100%;border:none}

#text-layer{align-items:center;justify-content:center;padding:80px}
.text-inner{text-align:center;word-break:break-word;line-height:1.4}

#ticker-layer{
  position:absolute;left:0;right:0;bottom:0;
  height:72px;display:none;align-items:center;overflow:hidden;
}
#ticker-layer.active{display:flex}
.ticker-scroll{
  white-space:nowrap;
  display:inline-block;
  animation:ticker 30s linear infinite;
}
@keyframes ticker{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}

/* progress bar */
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
  font-size:28px;gap:20px;
}
#no-content .icon{font-size:72px}
</style>
</head>
<body>
<div id="player">
  <div id="image-layer" class="layer"><img id="img" src="" alt=""></div>
  <div id="video-layer" class="layer"><video id="vid" autoplay muted playsinline></video></div>
  <div id="html-layer" class="layer"><iframe id="frame" src="" allowfullscreen></iframe></div>
  <div id="text-layer" class="layer"><div class="text-inner" id="text-inner"></div></div>
  <div id="ticker-layer"><div class="ticker-scroll" id="ticker-text"></div></div>
  <div id="progress"></div>
  <div id="osd" id="osd"></div>
  <div id="no-content" style="display:none">
    <div class="icon">📺</div>
    <div>No active content scheduled</div>
  </div>
</div>
<script>
(function(){
  'use strict';

  // ── helpers ────────────────────────────────────────────────────────────────

  function qs(sel){ return document.querySelector(sel) }

  function uuid(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
      var r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);
    });
  }

  // ── device identity ────────────────────────────────────────────────────────

  var params = new URLSearchParams(location.search);
  var deviceId = params.get('deviceId') || localStorage.getItem('signage_device_id') || uuid();
  localStorage.setItem('signage_device_id',deviceId);
  if(!params.get('deviceId')){
    history.replaceState({},'','?deviceId='+deviceId);
  }

  var BASE = location.origin;

  // ── state ──────────────────────────────────────────────────────────────────

  var playlist = [];
  var currentIndex = 0;
  var advanceTimer = null;
  var ws = null;
  var progressStart = null;
  var progressDuration = 0;
  var progressRAF = null;

  // ── OSD ────────────────────────────────────────────────────────────────────

  var osdTimer = null;
  function showOSD(msg, durationMs){
    var el = qs('#osd');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(osdTimer);
    if(durationMs > 0) osdTimer = setTimeout(function(){ el.classList.remove('show'); }, durationMs);
  }

  // ── progress bar ───────────────────────────────────────────────────────────

  function startProgress(durationMs){
    var bar = qs('#progress');
    bar.style.transition='none';
    bar.style.width='0%';
    progressDuration = durationMs;
    progressStart = performance.now();
    cancelAnimationFrame(progressRAF);
    function step(){
      var elapsed = performance.now() - progressStart;
      var pct = Math.min(100, (elapsed/durationMs)*100);
      bar.style.width = pct+'%';
      if(pct < 100) progressRAF = requestAnimationFrame(step);
    }
    progressRAF = requestAnimationFrame(step);
  }

  function clearProgress(){
    cancelAnimationFrame(progressRAF);
    var bar = qs('#progress');
    bar.style.transition='none';
    bar.style.width='0%';
  }

  // ── layers ─────────────────────────────────────────────────────────────────

  var LAYERS = ['image-layer','video-layer','html-layer','text-layer'];

  function hideAll(){
    LAYERS.forEach(function(id){
      var el = qs('#'+id);
      el.classList.remove('active');
      el.style.display='none';
    });
    qs('#ticker-layer').classList.remove('active');
    qs('#no-content').style.display='none';
    var vid = qs('#vid');
    vid.pause();
    vid.src='';
    qs('#frame').src='';
  }

  function showLayer(id){
    hideAll();
    var el = qs('#'+id);
    el.style.display='flex';
    // force reflow then fade in
    el.getBoundingClientRect();
    el.classList.add('active');
  }

  // ── scheduling ─────────────────────────────────────────────────────────────

  var DAYS = ['sun','mon','tue','wed','thu','fri','sat'];

  function isScheduledNow(item){
    if(item.scheduleMode === 'loop') return true;
    if(item.scheduleMode === 'manual') return false;
    if(item.scheduleMode === 'scheduled'){
      var now = new Date();
      var day = DAYS[now.getDay()];
      var days = item.scheduleDays || DAYS;
      if(days.indexOf(day) === -1) return false;
      var hh = String(now.getHours()).padStart(2,'0');
      var mm = String(now.getMinutes()).padStart(2,'0');
      var cur = hh+':'+mm;
      var start = item.scheduleStartTime || '00:00';
      var end   = item.scheduleEndTime   || '23:59';
      return cur >= start && cur <= end;
    }
    return false;
  }

  function getActiveItems(){
    return playlist
      .filter(function(i){ return i.isActive && isScheduledNow(i); })
      .sort(function(a,b){ return a.orderIndex - b.orderIndex; });
  }

  // ── playback ───────────────────────────────────────────────────────────────

  function scheduleNext(ms){
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(playNext, ms);
  }

  function playItem(item){
    clearTimeout(advanceTimer);
    clearProgress();
    var dur = (item.durationSeconds || 10) * 1000;

    if(item.type === 'image'){
      showLayer('image-layer');
      qs('#img').src = BASE + item.filePath;
      startProgress(dur);
      scheduleNext(dur);

    } else if(item.type === 'video'){
      showLayer('video-layer');
      var vid = qs('#vid');
      vid.src = BASE + item.filePath;
      vid.play().catch(function(){});
      startProgress(dur);
      var advanced = false;
      function advance(){
        if(advanced) return; advanced = true;
        clearTimeout(advanceTimer);
        playNext();
      }
      vid.onended = advance;
      scheduleNext(dur);

    } else if(item.type === 'html'){
      showLayer('html-layer');
      qs('#frame').src = item.htmlUrl || '';
      startProgress(dur);
      scheduleNext(dur);

    } else if(item.type === 'text'){
      if(item.textPosition === 'ticker'){
        // ticker bar at bottom
        hideAll();
        var tl = qs('#ticker-layer');
        tl.style.background = item.textBgColor || '#111';
        tl.style.height = '72px';
        var tt = qs('#ticker-text');
        tt.textContent = item.textContent || '';
        tt.style.fontSize = (item.textFontSize || 48) + 'px';
        tt.style.color = item.textFgColor || '#fff';
        var len = (item.textContent || '').length;
        var speed = Math.max(8, len * 0.12);
        tt.style.animationDuration = speed + 's';
        tl.classList.add('active');
        startProgress(dur);
        scheduleNext(dur);
      } else {
        showLayer('text-layer');
        var tLayer = qs('#text-layer');
        var align = {center:'center',top:'flex-start',bottom:'flex-end'}[item.textPosition||'center'] || 'center';
        tLayer.style.alignItems = align;
        tLayer.style.background = item.textBgColor || '#000';
        var inner = qs('#text-inner');
        inner.textContent = item.textContent || '';
        inner.style.fontSize = (item.textFontSize || 72) + 'px';
        inner.style.color = item.textFgColor || '#fff';
        startProgress(dur);
        scheduleNext(dur);
      }
    }
  }

  function playNext(){
    var items = getActiveItems();
    if(items.length === 0){
      hideAll();
      qs('#no-content').style.display='flex';
      // retry after 15s
      scheduleNext(15000);
      return;
    }
    if(currentIndex >= items.length) currentIndex = 0;
    var item = items[currentIndex];
    currentIndex = (currentIndex + 1) % items.length;
    playItem(item);
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  function connectWS(){
    var wsUrl = BASE.replace(/^http/, 'ws');
    try { ws = new WebSocket(wsUrl); } catch(e){ setTimeout(connectWS,5000); return; }

    ws.onopen = function(){
      ws.send(JSON.stringify({
        type:'register',
        deviceId: deviceId,
        name: 'TV-'+deviceId.slice(0,6),
      }));
      showOSD('Connected',2500);
    };

    ws.onmessage = function(evt){
      try {
        var msg = JSON.parse(evt.data);
        if(msg.type === 'playlist_update'){
          fetchPlaylist();
        } else if(msg.type === 'manual_push' && msg.content){
          clearTimeout(advanceTimer);
          currentIndex = 0; // reset after manual
          playItem(msg.content);
          // resume normal playlist after the manual item finishes
          var manualDur = (msg.content.durationSeconds || 10) * 1000 + 800;
          scheduleNext(manualDur);
        }
      } catch(e){}
    };

    ws.onclose = function(){
      showOSD('Reconnecting…',0);
      setTimeout(connectWS, 4000);
    };

    ws.onerror = function(){ ws.close(); };
  }

  // ── fetch playlist ─────────────────────────────────────────────────────────

  function fetchPlaylist(cb){
    fetch(BASE+'/api/content/active')
      .then(function(r){ return r.json(); })
      .then(function(data){
        playlist = data.items || [];
        if(cb) cb();
      })
      .catch(function(){
        setTimeout(function(){ fetchPlaylist(cb); }, 5000);
      });
  }

  // also register device via REST so it shows in the manager
  function registerDevice(){
    fetch(BASE+'/api/devices/register',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        id: deviceId,
        name: 'TV-'+deviceId.slice(0,6),
      }),
    }).catch(function(){});
  }

  // ── init ───────────────────────────────────────────────────────────────────

  registerDevice();
  connectWS();
  fetchPlaylist(function(){
    playNext();
  });

  // re-check schedule every minute (for scheduled items)
  setInterval(function(){
    fetchPlaylist(function(){
      // only interrupt if nothing is actively playing or we need to add new scheduled items
    });
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
