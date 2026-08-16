import type { AppContext, AppDefinition, AppRefreshResult } from '../types'
import { appPage, escapeHtml, jsonLiteral } from '../render'

// YouTube.
//
// The visible settings are the reference product's three — Name, URL, Caption —
// with the extras an operator asks for the first week tucked under Advanced.
//
// Two things are done better here than by simply embedding a player:
//
//   * The video's title, channel and poster frame are fetched through oEmbed
//     (public, no API key) and the poster is mirrored to local disk. When the
//     WAN is down, or the TV's browser is too old to run YouTube's player, the
//     screen shows the poster and title instead of a black rectangle.
//   * "Play the whole video" tells the player when the video ends, so a
//     six-minute film is not cut off after the slot's thirty seconds.

const OEMBED = 'https://www.youtube.com/oembed'

/** Accepts anything an operator is likely to paste and returns the video id.
 *  Shorts links are converted rather than refused — the reference product asks
 *  the user to rewrite the URL by hand, which is a support ticket waiting to
 *  happen. */
export function parseYouTube(input: string): { id: string; list?: string; start?: number } | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null

  const idOnly = /^[A-Za-z0-9_-]{11}$/
  if (idOnly.test(raw)) return { id: raw }

  let url: URL
  try {
    url = new URL(raw.indexOf('//') === -1 ? 'https://' + raw : raw)
  } catch {
    return null
  }
  if (!/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(url.hostname)) return null

  const start = (() => {
    const t = url.searchParams.get('t') || url.searchParams.get('start')
    if (!t) return undefined
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t)
    if (!m) return undefined
    const secs = (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0)
    return secs > 0 ? secs : undefined
  })()

  const list = url.searchParams.get('list') || undefined

  if (/youtu\.be$/i.test(url.hostname)) {
    const id = url.pathname.slice(1).split('/')[0]
    return idOnly.test(id) ? { id, list, start } : null
  }

  const v = url.searchParams.get('v')
  if (v && idOnly.test(v)) return { id: v, list, start }

  // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
  const m = /^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname)
  if (m) return { id: m[2], list, start }

  // A playlist link with no video: the embed can play the list from its start.
  if (list) return { id: '', list, start }

  return null
}

interface YtData {
  id: string
  list?: string
  title: string
  author: string
  poster?: string
}

export const youtube: AppDefinition = {
  id: 'youtube',
  name: 'YouTube',
  icon: '▶️',
  description: 'Play a YouTube video, Short, live stream or playlist on your screens.',
  category: 'media',
  defaultDuration: 60,

  fields: [
    {
      key: 'url', label: 'URL', type: 'url', required: true,
      placeholder: 'https://www.youtube.com/watch?v=a-8UFyRXBDg',
      help: 'Paste the link from the address bar. Shorts, youtu.be links, live streams and playlists all work.',
    },
    {
      key: 'caption', label: 'Caption', type: 'checkbox', default: false,
      help: 'Show closed captions, if the video has them. Captions the author added work best; auto-generated ones may not appear.',
    },

    // ── Advanced ──
    {
      key: 'playFull', label: 'Play the whole video', type: 'checkbox', default: true, advanced: true,
      help: 'Move to the next item as soon as the video ends, instead of waiting out its slot in the playlist.',
    },
    {
      key: 'loop', label: 'Loop', type: 'checkbox', default: false, advanced: true,
      help: 'Restart the video when it finishes. Ignored while "Play the whole video" is on.',
    },
    {
      key: 'startAt', label: 'Start at (seconds)', type: 'number', default: 0, min: 0, max: 86400, advanced: true,
      help: 'Skip an intro. Taken from the link automatically if it has a time in it.',
    },
    {
      key: 'showTitle', label: 'Show the video title on screen', type: 'checkbox', default: false, advanced: true,
    },
    {
      key: 'fit', label: 'Picture fit', type: 'select', default: 'contain', advanced: true,
      options: [
        { value: 'contain', label: 'Fit the whole picture', hint: 'Black bars where the video shape differs from the screen' },
        { value: 'cover', label: 'Fill the screen', hint: 'Crops the edges — good for Shorts on a portrait screen' },
      ],
    },
  ],

  validate(config) {
    if (!parseYouTube(String(config.url ?? ''))) {
      return 'That does not look like a YouTube link. Copy the URL from your browser address bar.'
    }
    return null
  },

  async refresh(ctx: AppContext): Promise<AppRefreshResult> {
    const parsed = parseYouTube(String(ctx.instance.config.url ?? ''))
    if (!parsed) throw new Error('That YouTube link could not be read.')

    const watchUrl = parsed.id
      ? `https://www.youtube.com/watch?v=${parsed.id}`
      : `https://www.youtube.com/playlist?list=${parsed.list}`

    let title = ''
    let author = ''
    let poster: string | undefined

    // oEmbed is public and needs no key. It doubles as a liveness check: a
    // private or deleted video 404s here, which is worth telling the operator
    // now rather than letting them find a black screen in the lobby.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await fetch(`${OEMBED}?url=${encodeURIComponent(watchUrl)}&format=json`, {
        signal: ctrl.signal, headers: { 'User-Agent': 'SignageManager/1.0' },
      })
      if (res.status === 401 || res.status === 403) {
        throw new Error('That video is private, or embedding is disabled for it.')
      }
      if (res.status === 404) throw new Error('That video could not be found. Check the link.')
      if (res.ok) {
        const j = await res.json() as Record<string, unknown>
        title = String(j.title ?? '')
        author = String(j.author_name ?? '')
        const thumb = String(j.thumbnail_url ?? '')
        if (thumb) poster = (await ctx.mirror(thumb)) ?? thumb
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : ''
      // A network blip must not wipe a known-good title; only a definitive
      // answer from YouTube is worth surfacing.
      if (/private|could not be found/.test(message)) throw e
    } finally {
      clearTimeout(timer)
    }

    // The best poster YouTube publishes, as a second chance when oEmbed's
    // smaller default is all we got.
    if (parsed.id && !poster) {
      poster = (await ctx.mirror(`https://i.ytimg.com/vi/${parsed.id}/maxresdefault.jpg`))
        ?? (await ctx.mirror(`https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`))
        ?? undefined
    }

    const data: YtData = { id: parsed.id, list: parsed.list, title, author, poster }
    // A video's title and poster change rarely; a live stream's do not change
    // at all. Six hours keeps the poster fresh without pointless traffic.
    return { data, ttlSeconds: 6 * 60 * 60 }
  },

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const parsed = parseYouTube(String(c.url ?? ''))
    const data = (ctx.data ?? null) as YtData | null

    const id = parsed?.id ?? ''
    const list = parsed?.list
    const startAt = Number(c.startAt ?? 0) || parsed?.start || 0
    const playFull = c.playFull !== false
    const loop = c.loop === true && !playFull

    // autoplay only survives if the video is muted — every browser that
    // matters blocks sound-on autoplay, and signage is silent anyway.
    const params: Record<string, string> = {
      autoplay: '1',
      mute: '1',
      controls: '0',
      rel: '0',
      playsinline: '1',
      modestbranding: '1',
      iv_load_policy: '3',
      disablekb: '1',
      fs: '0',
      enablejsapi: '1',
      // `origin` is deliberately absent here and appended in the page instead.
      // A screen may load this over the LAN address while the manager knows
      // itself as localhost, and an origin that disagrees with the page's own
      // makes YouTube refuse to play with a configuration error.
    }
    if (c.caption === true) { params.cc_load_policy = '1'; params.cc_lang_pref = 'en' }
    if (startAt > 0) params.start = String(startAt)
    if (list) params.list = list
    if (loop) { params.loop = '1'; if (id) params.playlist = id }

    const embedBase = id
      ? `https://www.youtube.com/embed/${encodeURIComponent(id)}`
      : `https://www.youtube.com/embed/videoseries`
    const embedUrl = embedBase + '?' + Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&')

    const poster = data?.poster
      ? (data.poster.indexOf('/') === 0 ? ctx.baseUrl + data.poster : data.poster)
      : ''

    const cfg = {
      embedUrl,
      poster,
      title: data?.title ?? '',
      author: data?.author ?? '',
      showTitle: c.showTitle === true,
      fit: String(c.fit ?? 'contain'),
      playFull,
      instanceId: ctx.instance.id,
      unavailable: 'Video unavailable',
    }

    return appPage({
      title: `YouTube — ${escapeHtml(ctx.instance.name)}`,
      bg: '#000000',
      fontCss: ctx.fontCss,
      css: `
body{background:#000;color:#fff}
#stage{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;background:#000}
#frame{position:absolute;border:0;background:#000}
#poster{position:absolute;top:0;left:0;right:0;bottom:0;background-size:cover;
        background-position:50% 50%;background-repeat:no-repeat;opacity:0;transition:opacity 400ms ease}
#poster.on{opacity:1}
#poster:after{content:'';position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.35)}
#title{position:absolute;left:0;right:0;bottom:0;padding:5vh 6vw;z-index:5;
       background:linear-gradient(to bottom,rgba(0,0,0,0),rgba(0,0,0,.85));display:none}
#title.on{display:block}
#title .t{font-size:3.2vh;font-weight:600;line-height:1.25;margin-bottom:.6vh}
#title .a{font-size:2.1vh;opacity:.75}
#fallback{position:absolute;top:50%;left:0;right:0;text-align:center;font-size:3vh;
          opacity:.6;z-index:6;display:none;padding:0 8vw}
#fallback.on{display:block}
`,
      body:
        '<div id="stage">' +
        '<div id="poster"></div>' +
        '<iframe id="frame" allow="autoplay; encrypted-media" allowfullscreen></iframe>' +
        '<div id="fallback"></div>' +
        '<div id="title"><div class="t"></div><div class="a"></div></div>' +
        '</div>',
      script: `var CFG = ${jsonLiteral(cfg)};\n` + YOUTUBE_JS,
    })
  },

  serializeData(ctx: AppContext) {
    const d = (ctx.data ?? null) as YtData | null
    if (!d) return null
    return {
      title: d.title,
      author: d.author,
      poster: d.poster && d.poster.indexOf('/') === 0 ? ctx.baseUrl + d.poster : d.poster,
    }
  },

  suggestName(ctx: AppContext) {
    return ((ctx.data ?? null) as YtData | null)?.title || null
  },
}

const YOUTUBE_JS = `
var stage = document.getElementById('stage');
var frame = document.getElementById('frame');
var poster = document.getElementById('poster');
var fallback = document.getElementById('fallback');
var titleBox = document.getElementById('title');
var started = false;

if (CFG.poster) poster.style.backgroundImage = "url('" + CFG.poster + "')";
if (CFG.showTitle && CFG.title) {
  titleBox.getElementsByClassName('t')[0].textContent = CFG.title;
  titleBox.getElementsByClassName('a')[0].textContent = CFG.author;
  titleBox.className = 'on';
}

/* "Fill the screen" has no CSS equivalent for an iframe — object-fit does
   nothing to one — so the frame is oversized and centred, which crops the
   edges the same way cover would. Portrait Shorts on a landscape panel is the
   case this exists for. */
function sizeFrame(){
  var w = window.innerWidth, h = window.innerHeight;
  if (CFG.fit !== 'cover') {
    frame.style.left = '0'; frame.style.top = '0';
    frame.style.width = w + 'px'; frame.style.height = h + 'px';
    return;
  }
  var ratio = 16 / 9;
  var fw = w, fh = Math.round(w / ratio);
  if (fh < h) { fh = h; fw = Math.round(h * ratio); }
  frame.style.width = fw + 'px'; frame.style.height = fh + 'px';
  frame.style.left = Math.round((w - fw) / 2) + 'px';
  frame.style.top = Math.round((h - fh) / 2) + 'px';
}
sizeFrame();
window.addEventListener('resize', sizeFrame);

/* Show the poster first. If the player never starts — no internet, or a TV
   browser too old to run it — the poster is what stays up, which reads as a
   deliberate still rather than a fault. */
if (CFG.poster) poster.className = 'on';

function showFallback(){
  if (started) return;
  if (!CFG.poster) { fallback.textContent = CFG.unavailable; fallback.className = 'on'; }
  if (CFG.title && !CFG.showTitle) {
    titleBox.getElementsByClassName('t')[0].textContent = CFG.title;
    titleBox.getElementsByClassName('a')[0].textContent = CFG.author;
    titleBox.className = 'on';
  }
}
var fallbackTimer = setTimeout(showFallback, 9000);

/* Tell the player the video finished so the rotation advances early. Same
   origin as the player page, so this is a private conversation between our own
   two pages. */
function reportEnded(){
  try { window.parent.postMessage({ type: 'signage:ended', instanceId: CFG.instanceId }, window.location.origin); } catch (e) {}
}

/* YouTube's iframe API gives us play/end events. It needs the network, so
   everything above works without it and this only ever adds behaviour. */
function onPlayerReady(){
  started = true;
  clearTimeout(fallbackTimer);
  setTimeout(function(){ poster.className = ''; }, 600);
}

window.onYouTubeIframeAPIReady = function(){
  try {
    var player = new window.YT.Player('frame', {
      events: {
        onReady: function(){ onPlayerReady(); },
        onStateChange: function(e){
          if (e.data === 1) onPlayerReady();
          if (e.data === 0 && CFG.playFull) reportEnded();
        },
        onError: function(){ showFallback(); }
      }
    });
    void player;
  } catch (e) {}
};

frame.onload = function(){
  /* onload fires even when the embed renders an error page, so it only
     shortens the fallback wait rather than cancelling it. */
  clearTimeout(fallbackTimer);
  fallbackTimer = setTimeout(showFallback, 4000);
};
frame.src = CFG.embedUrl + '&origin=' + encodeURIComponent(window.location.origin);

var api = document.createElement('script');
api.src = 'https://www.youtube.com/iframe_api';
api.onerror = function(){ /* offline — the poster is already showing */ };
document.body.appendChild(api);
`
