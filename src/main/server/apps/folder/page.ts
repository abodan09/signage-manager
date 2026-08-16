import type { AppContext, AppField } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'
import type { FolderPayload } from './core'

// The slideshow every cloud-folder app renders.
//
// Two layers that swap, rather than one that is rewritten: the next picture is
// decoded off-screen and only faded in once it is known good, so a slow file
// never shows a half-drawn frame and a broken one never blanks a working wall.
//
// Two notes that cannot go in the emitted script, because the compatibility
// tests read that text and would match the words themselves:
//
//  1. The crossfade is opacity only. These pages contain a <video>, and a TV
//     decodes video on separate hardware behind an alpha hole punched out of
//     the web layer — a transformed layer over it can blank the picture. Fading
//     opacity is safe; sliding or scaling is not.
//  2. Nothing here uses flex gap, grid, or custom properties, which the oldest
//     panels silently drop.

/** The settings shared by every folder app. A provider adds its own credential
 *  and folder fields in front of these. */
export const FOLDER_FIELDS: AppField[] = [
  {
    key: 'order', label: 'Play in this order', type: 'select', default: 'name',
    options: [
      { value: 'name', label: 'File name A → Z', hint: 'Name files 01, 02, 03 to control the order.' },
      { value: 'nameDesc', label: 'File name Z → A' },
      { value: 'newest', label: 'Newest first', hint: 'Newly added files appear first.' },
      { value: 'oldest', label: 'Oldest first' },
      { value: 'random', label: 'Shuffle', hint: 'Reshuffled each time the folder is checked.' },
    ],
  },
  {
    key: 'imageSeconds', label: 'Show each picture for', type: 'number', default: 8, min: 3, max: 120,
    help: 'Seconds. Videos play for as long as they are.',
  },
  {
    key: 'includeVideo', label: 'Play videos too', type: 'checkbox', default: true,
    help: 'Only formats every screen can decode. Anything else is listed as skipped.',
  },
  {
    key: 'videoMaxSeconds', label: 'Stop videos after', type: 'number', default: 0, min: 0, max: 600,
    showIf: { key: 'includeVideo', equals: [true] },
    help: 'Seconds, or 0 to play the whole thing.',
  },
  {
    key: 'transition', label: 'Change with', type: 'select', default: 'fade',
    options: [
      { value: 'fade', label: 'Cross-fade' },
      { value: 'cut', label: 'A straight cut' },
    ],
  },
  {
    key: 'fit', label: 'Fit pictures', type: 'select', default: 'cover',
    options: [
      { value: 'cover', label: 'Fill the screen', hint: 'Edges may be cropped.' },
      { value: 'contain', label: 'Show the whole picture', hint: 'Bars at the sides.' },
    ],
  },
  {
    key: 'background', label: 'Background', type: 'color', default: '#000000',
    showIf: { key: 'fit', equals: ['contain'] },
  },
  {
    key: 'showCaption', label: 'Show the file name', type: 'checkbox', default: false,
  },
  {
    key: 'refreshMinutes', label: 'Check the folder every', type: 'number', default: 5, min: 1, max: 240,
    help: 'Minutes. New files reach the screens within this time.',
  },

  // ── Advanced ──
  {
    key: 'maxItems', label: 'Use at most', type: 'number', default: 60, min: 1, max: 200, advanced: true,
    help: 'Files. The rest of the folder is ignored.',
  },
  {
    key: 'maxFileMb', label: 'Skip files bigger than', type: 'number', default: 300, min: 5, max: 2000,
    advanced: true, help: 'Megabytes.',
  },
]

/** Reads the shared settings back, clamped. Hidden fields are deleted from
 *  config and a cleared box is stored as '', so every read needs a fallback. */
export function folderSettings(config: Record<string, unknown>) {
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const n = Number(v)
    return Math.max(lo, Math.min(hi, Number.isFinite(n) && v !== '' && v !== null ? n : d))
  }
  return {
    order: String(config.order ?? 'name'),
    imageSeconds: num(config.imageSeconds, 8, 3, 120),
    includeVideo: config.includeVideo !== false,
    videoMaxSeconds: num(config.videoMaxSeconds, 0, 0, 600),
    transition: config.transition === 'cut' ? 'cut' : 'fade',
    fit: config.fit === 'contain' ? 'contain' : 'cover',
    background: /^#[0-9a-fA-F]{6}$/.test(String(config.background)) ? String(config.background) : '#000000',
    showCaption: config.showCaption === true,
    refreshMinutes: num(config.refreshMinutes, 5, 1, 240),
    maxItems: num(config.maxItems, 60, 1, 200),
    maxBytes: num(config.maxFileMb, 300, 5, 2000) * 1024 * 1024,
  }
}

export function renderFolderPage(ctx: AppContext, title: string, emptyHint: string): string {
  const s = folderSettings(ctx.instance.config)
  const cfg = {
    // Relative: an XHR from this page must be same-origin with the address the
    // screen used to reach us, which is not always the one this PC believes in.
    dataUrl: `/tv/app/${encodeURIComponent(ctx.instance.id)}/data`,
    pollMs: 60_000,
    fade: s.transition === 'fade' ? 600 : 0,
    fit: s.fit,
    showCaption: s.showCaption,
    videoCapMs: s.videoMaxSeconds * 1000,
    empty: emptyHint,
  }

  return appPage({
    title: `${title} — ${escapeHtml(ctx.instance.name)}`,
    bg: s.background,
    fontCss: ctx.fontCss,
    css: `
body{background:${s.background}}
#root{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:${s.background}}
.layer{position:absolute;top:0;left:0;right:0;bottom:0;opacity:0}
.layer.on{opacity:1}
.layer.fade{transition:opacity ${cfg.fade}ms ease-in-out}
.layer img,.layer video{position:absolute;top:0;left:0;width:100%;height:100%;display:block;
  object-fit:${s.fit}}
#cap{position:absolute;left:0;right:0;bottom:0;color:#fff;font-size:2.2vh;
  padding:.8em 1.2em;background:rgba(0,0,0,.45)}
#cap.off{display:none}
#msg{position:absolute;top:50%;left:0;right:0;margin-top:-1.2em;text-align:center;
  color:rgba(255,255,255,.55);font-size:2.6vh;padding:0 8vw;line-height:1.4}
#msg.off{display:none}
`,
    body:
      '<div id="root">' +
      '<div class="layer" id="a"></div>' +
      '<div class="layer" id="b"></div>' +
      '<div id="cap" class="off"></div>' +
      '<div id="msg"></div>' +
      '</div>',
    script: `var CFG = ${jsonLiteral(cfg)};\n` + FOLDER_JS,
  })
}

const FOLDER_JS = `
var layers = [document.getElementById('a'), document.getElementById('b')];
var cap = document.getElementById('cap');
var msg = document.getElementById('msg');
var items = [];
var idx = 0;
var front = 0;
var timer = null;
var token = 0;

function say(text){
  msg.innerHTML = esc(text);
  msg.className = text ? '' : 'off';
}

/* A signature of the playlist, not its length: a folder where one file was
   replaced by another has the same count, and a screen that only watched the
   count would keep showing the old picture until someone rebooted it. */
function signature(list){
  var s = '';
  for (var i = 0; i < list.length; i++) s += list[i].src + '|';
  return s;
}

function stop(){
  if (timer) { clearTimeout(timer); timer = null; }
}

function showNext(){
  if (!items.length) return;
  var mine = ++token;
  var it = items[idx % items.length];
  idx = (idx + 1) % items.length;

  var back = layers[1 - front];
  var dwell = (it.seconds || 8) * 1000;

  function reveal(){
    if (mine !== token) return;
    back.className = 'layer on' + (CFG.fade ? ' fade' : '');
    layers[front].className = 'layer' + (CFG.fade ? ' fade' : '');
    front = 1 - front;
    say('');
    if (CFG.showCaption) { cap.innerHTML = esc(it.name); cap.className = ''; }
    /* Clearing the layer that just left, after the fade, releases the decoded
       picture and stops a video that is no longer visible from decoding on. */
    setTimeout(function(){
      if (mine === token) layers[1 - front].innerHTML = '';
    }, CFG.fade + 60);
    stop();
    timer = setTimeout(showNext, dwell);
  }

  if (it.kind === 'video') {
    back.innerHTML = '<video autoplay muted playsinline></video>';
    var v = back.firstChild;
    var advanced = false;
    var go = function(){
      if (advanced || mine !== token) return;
      advanced = true;
      stop();
      timer = setTimeout(showNext, 0);
    };
    v.onended = go;
    /* A file that never fires ended — truncated, or a codec the panel accepted
       and then gave up on — would hold the screen for ever without this. */
    v.onerror = go;
    v.onloadeddata = function(){
      if (mine !== token) return;
      reveal();
      stop();
      var cap2 = CFG.videoCapMs;
      var natural = (v.duration && isFinite(v.duration)) ? (v.duration * 1000 + 2000) : 120000;
      timer = setTimeout(go, cap2 > 0 ? Math.min(cap2, natural) : natural);
    };
    v.src = it.src;
    try { var p = v.play(); if (p && p['catch']) p['catch'](function(){}); } catch (e) {}
    return;
  }

  /* Decoded out of sight first. Assigning straight to a visible layer shows the
     picture painting in, and a file that fails leaves a broken icon on a wall. */
  var pre = new Image();
  pre.onload = function(){
    if (mine !== token) return;
    back.innerHTML = '';
    back.appendChild(pre);
    reveal();
  };
  pre.onerror = function(){
    if (mine !== token) return;
    /* Skip it rather than stall. One unreadable file must not end the show. */
    stop();
    timer = setTimeout(showNext, 200);
  };
  pre.src = it.src;
}

function apply(payload){
  var d = payload && payload.data;
  if (!d) return;
  var list = d.items || [];
  if (!list.length) {
    items = [];
    stop();
    token++;
    layers[0].innerHTML = ''; layers[1].innerHTML = '';
    layers[0].className = 'layer'; layers[1].className = 'layer';
    cap.className = 'off';
    say(CFG.empty);
    return;
  }
  if (signature(list) === signature(items)) return;

  var running = items.length > 0;
  items = list;
  if (idx >= items.length) idx = 0;
  /* Only start the loop once. A re-sync mid-show swaps the list under the
     rotation and lets the current picture finish its turn. */
  if (!running) { say(''); showNext(); }
}

say('');
pollData(CFG.dataUrl, CFG.pollMs, apply);
`
