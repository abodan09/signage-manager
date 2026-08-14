// signage-analytics — download gateway + telemetry ingest + admin dashboard.
//
//   GET  /d/:platform      log the download, 302 to the latest GitHub release asset
//                          (:platform = windows | android | webos | tizen)
//   POST /ingest           anonymous telemetry batches from the desktop app
//   GET  /admin            dashboard (data endpoints need the admin token)
//   GET  /api/stats        aggregated stats JSON        (Bearer ADMIN_TOKEN)
//   GET  /api/stats/github GitHub per-asset download counts (Bearer ADMIN_TOKEN)
//
// Secrets: ADMIN_TOKEN (dashboard auth), IP_SALT (IP hashing — raw IPs never stored)

import ADMIN_HTML from './admin.html'

const PLATFORM_EXT = { windows: '.exe', android: '.apk', webos: '.ipk', tizen: '.wgt' }

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|skype|slackbot|discordbot|preview|embed|headless|lighthouse|pingdom|uptime|monitor|scanner|python-requests|go-http-client/i

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const path = url.pathname
    try {
      if (path.startsWith('/d/')) return handleDownload(request, env, ctx, url)
      if (path === '/ingest') {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
        if (request.method === 'POST') return handleIngest(request, env)
        return json({ error: 'method not allowed' }, 405, CORS)
      }
      if (path === '/admin' || path === '/admin/') {
        return new Response(ADMIN_HTML, {
          headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' },
        })
      }
      if (path === '/api/stats') return withAuth(request, env, () => handleStats(env, url))
      if (path === '/api/stats/github') return withAuth(request, env, () => handleGithubStats(env))
      if (path === '/api/health') return json({ ok: true })
      if (path === '/') return Response.redirect(env.LANDING_URL, 302)
      return json({ error: 'not found' }, 404)
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500)
    }
  },
}

/* ── download gateway ──────────────────────────────────────────────────────── */

async function handleDownload(request, env, ctx, url) {
  const platform = url.pathname.slice(3).replace(/\/+$/, '').toLowerCase()
  const ext = PLATFORM_EXT[platform]
  if (!ext) return json({ error: 'unknown platform' }, 404)

  const release = await getLatestRelease(env).catch(() => null)
  const asset = release && (release.assets || []).find(a => a.name && a.name.toLowerCase().endsWith(ext))
  const target = asset
    ? asset.browser_download_url
    : `https://github.com/${env.GITHUB_REPO}/releases/latest`

  const headers = new Headers({ Location: target, 'cache-control': 'no-store' })

  const ua = request.headers.get('user-agent') || ''
  const isBot = BOT_RE.test(ua)

  let deviceId = getCookie(request, 'sm_did')
  const newDevice = deviceId ? 0 : 1
  if (!deviceId && !isBot) {
    deviceId = crypto.randomUUID()
    // 2 years; HttpOnly first-party cookie identifies a browser that downloads again
    headers.append('set-cookie', `sm_did=${deviceId}; Max-Age=63072000; Path=/; Secure; HttpOnly; SameSite=Lax`)
  }

  if (!isBot && request.method === 'GET') {
    ctx.waitUntil(
      logDownload(env, request, url, {
        platform,
        file: asset ? asset.name : null,
        version: release ? String(release.tag_name || '').replace(/^v/, '') : null,
        deviceId,
        newDevice,
        ua,
      }).catch(() => {})
    )
  }

  return new Response(null, { status: 302, headers })
}

async function logDownload(env, request, url, d) {
  const cf = request.cf || {}
  const ip = request.headers.get('cf-connecting-ip') || ''
  const ipHash = await sha16(`${ip}|${env.IP_SALT || ''}`)
  const fpHash = await sha16(`${ip}|${d.ua}|${env.IP_SALT || ''}`)

  const ref = (request.headers.get('referer') || '').slice(0, 200) || null
  const srcParam = (url.searchParams.get('src') || '').slice(0, 32)
  const source = srcParam || (ref && ref.includes('signage.frozenbit.eu') ? 'landing' : 'direct')

  const now = new Date().toISOString()
  const round1 = v => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : null
  }

  await env.DB.prepare(
    `INSERT INTO downloads
       (ts, day, platform, file, version, country, city, region, continent, lat, lon,
        ua, os, browser, ref, source, device_id, ip_hash, fp_hash, new_device)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    now, now.slice(0, 10), d.platform, d.file, d.version,
    cf.country || null, cf.city || null, cf.region || null, cf.continent || null,
    round1(cf.latitude), round1(cf.longitude),
    d.ua.slice(0, 300), uaOS(d.ua), uaBrowser(d.ua),
    ref, source, d.deviceId || null, ipHash, fpHash, d.newDevice
  ).run()
}

/* ── telemetry ingest ──────────────────────────────────────────────────────── */

async function handleIngest(request, env) {
  const len = parseInt(request.headers.get('content-length') || '0', 10)
  if (len > 128 * 1024) return json({ error: 'too large' }, 413, CORS)

  let body
  try { body = await request.json() } catch { return json({ error: 'bad json' }, 400, CORS) }

  const installId = String(body.installId || '')
  if (!/^[0-9a-f][0-9a-f-]{7,63}$/i.test(installId)) return json({ error: 'bad installId' }, 400, CORS)

  const raw = Array.isArray(body.events) ? body.events.slice(0, 200) : []
  const cf = request.cf || {}
  const now = new Date().toISOString()
  const nowMs = Date.now()
  const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null)

  const appVersion = clip(body.appVersion, 32)
  const os = clip(body.os, 64)
  const arch = clip(body.arch, 16)
  const locale = clip(body.locale, 16)

  const eventStmts = []
  let sessionStarts = 0
  for (const e of raw) {
    if (!e || typeof e.name !== 'string' || !/^[a-z0-9_.:-]{1,64}$/i.test(e.name)) continue
    if (e.name === 'app_start') sessionStarts++

    // keep the client timestamp when plausible (offline queues flush late); else stamp now
    let ts = typeof e.ts === 'string' ? Date.parse(e.ts) : NaN
    if (!Number.isFinite(ts) || ts > nowMs + 5 * 60_000 || nowMs - ts > 90 * 86400_000) ts = nowMs
    const iso = new Date(ts).toISOString()

    let props = null
    if (e.props && typeof e.props === 'object') {
      try { props = JSON.stringify(e.props).slice(0, 2048) } catch { /* unserializable — drop */ }
    }

    eventStmts.push(
      env.DB.prepare(
        `INSERT INTO events (ts, day, install_id, session_id, name, props, app_version, country)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(iso, iso.slice(0, 10), installId, clip(e.sessionId, 64), e.name, props, appVersion, cf.country || null)
    )
  }

  const upsert = env.DB.prepare(
    `INSERT INTO installs
       (install_id, first_seen, last_seen, app_version, os, arch, locale, country, city, sessions, events)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(install_id) DO UPDATE SET
       last_seen   = excluded.last_seen,
       app_version = excluded.app_version,
       os          = excluded.os,
       arch        = excluded.arch,
       locale      = excluded.locale,
       country     = excluded.country,
       city        = excluded.city,
       sessions    = sessions + ?,
       events      = events + ?`
  ).bind(
    installId, now, now, appVersion, os, arch, locale,
    cf.country || null, cf.city || null,
    sessionStarts, eventStmts.length,
    sessionStarts, eventStmts.length
  )

  await env.DB.batch([upsert, ...eventStmts])
  return json({ ok: true, accepted: eventStmts.length }, 200, CORS)
}

/* ── stats API ─────────────────────────────────────────────────────────────── */

async function handleStats(env, url) {
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30))
  const sinceDay = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const iso7 = new Date(Date.now() - 7 * 86400_000).toISOString()
  const iso30 = new Date(Date.now() - 30 * 86400_000).toISOString()
  const p = sql => env.DB.prepare(sql)
  const dev = `COALESCE(device_id, fp_hash)`

  const stmts = [
    /* 0 */ p(`SELECT COUNT(*) total, COUNT(DISTINCT ${dev}) uniq FROM downloads WHERE day >= ?`).bind(sinceDay),
    /* 1 */ p(`SELECT COUNT(*) total, COUNT(DISTINCT ${dev}) uniq FROM downloads`),
    /* 2 */ p(`SELECT platform, COUNT(*) c, COUNT(DISTINCT ${dev}) devices FROM downloads WHERE day >= ? GROUP BY platform ORDER BY c DESC`).bind(sinceDay),
    /* 3 */ p(`SELECT day, platform, COUNT(*) c FROM downloads WHERE day >= ? GROUP BY day, platform ORDER BY day`).bind(sinceDay),
    /* 4 */ p(`SELECT COALESCE(country,'??') country, COUNT(*) c, COUNT(DISTINCT ${dev}) devices FROM downloads WHERE day >= ? GROUP BY 1 ORDER BY c DESC LIMIT 15`).bind(sinceDay),
    /* 5 */ p(`SELECT COALESCE(country,'??') country, COALESCE(city,'Unknown') city, COUNT(*) c FROM downloads WHERE day >= ? GROUP BY 1,2 ORDER BY c DESC LIMIT 15`).bind(sinceDay),
    /* 6 */ p(`SELECT ts, platform, version, country, city, os, browser, source, ${dev} dev, new_device FROM downloads ORDER BY id DESC LIMIT 30`),
    /* 7 */ p(`SELECT ${dev} dev,
                 MAX(CASE WHEN device_id IS NOT NULL THEN 1 ELSE 0 END) has_cookie,
                 COUNT(*) c, MIN(ts) first_ts, MAX(ts) last_ts,
                 GROUP_CONCAT(DISTINCT platform) platforms,
                 MAX(country) country, MAX(city) city
               FROM downloads GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY c DESC LIMIT 50`),
    /* 8 */ p(`SELECT COUNT(*) installs,
                 SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) active7,
                 SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) active30,
                 COALESCE(SUM(sessions),0) sessions FROM installs`).bind(iso7, iso30),
    /* 9 */ p(`SELECT day, COUNT(DISTINCT install_id) c FROM events WHERE day >= ? GROUP BY day ORDER BY day`).bind(sinceDay),
    /* 10 */ p(`SELECT substr(first_seen,1,10) day, COUNT(*) c FROM installs WHERE first_seen >= ? GROUP BY 1 ORDER BY 1`).bind(sinceDay),
    /* 11 */ p(`SELECT day, COUNT(*) c FROM events WHERE name = 'app_start' AND day >= ? GROUP BY day ORDER BY day`).bind(sinceDay),
    /* 12 */ p(`SELECT name, COUNT(*) c, COUNT(DISTINCT install_id) installs FROM events WHERE day >= ? GROUP BY name ORDER BY c DESC LIMIT 40`).bind(sinceDay),
    /* 13 */ p(`SELECT COALESCE(app_version,'?') v, COUNT(*) c FROM installs GROUP BY 1 ORDER BY c DESC LIMIT 15`),
    /* 14 */ p(`SELECT COALESCE(os,'?') os, COUNT(*) c FROM installs GROUP BY 1 ORDER BY c DESC LIMIT 15`),
    /* 15 */ p(`SELECT COALESCE(country,'??') country, COUNT(*) c FROM installs GROUP BY 1 ORDER BY c DESC LIMIT 15`),
    /* 16 */ p(`SELECT install_id, first_seen, last_seen, app_version, os, country, city, sessions, events FROM installs ORDER BY last_seen DESC LIMIT 50`),
    /* 17 */ p(`SELECT install_id, COUNT(DISTINCT day) d FROM events GROUP BY install_id`),
    /* 18 */ p(`SELECT ROUND(AVG(m),1) avgMin FROM (
                  SELECT session_id, MAX(CAST(json_extract(props,'$.uptimeMin') AS REAL)) m
                  FROM events WHERE name = 'heartbeat' AND session_id IS NOT NULL AND day >= ?
                  GROUP BY session_id)`).bind(sinceDay),
  ]

  const r = await env.DB.batch(stmts)
  const rows = i => (r[i] && r[i].results) || []
  const one = i => rows(i)[0] || {}

  const daysActive = {}
  for (const row of rows(17)) daysActive[row.install_id] = row.d

  return json({
    days,
    sinceDay,
    generatedAt: new Date().toISOString(),
    downloads: {
      total: one(0).total || 0,
      uniqueDevices: one(0).uniq || 0,
      allTimeTotal: one(1).total || 0,
      allTimeUnique: one(1).uniq || 0,
      byPlatform: rows(2),
      perDay: rows(3),
      topCountries: rows(4),
      topCities: rows(5),
      recent: rows(6),
      repeats: rows(7),
    },
    usage: {
      totals: one(8),
      activePerDay: rows(9),
      newInstallsPerDay: rows(10),
      sessionsPerDay: rows(11),
      topEvents: rows(12),
      versionDist: rows(13),
      osDist: rows(14),
      countries: rows(15),
      installs: rows(16).map(i => ({ ...i, daysActive: daysActive[i.install_id] || 0 })),
      avgSessionMin: one(18).avgMin ?? null,
    },
  })
}

/* ── GitHub baseline (includes updater + pre-gateway downloads) ────────────── */

let ghCache = { at: 0, data: null }

async function handleGithubStats(env) {
  const now = Date.now()
  if (ghCache.data && now - ghCache.at < 5 * 60_000) return json(ghCache.data)

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/releases?per_page=100`, {
    headers: { 'user-agent': 'signage-analytics-worker', accept: 'application/vnd.github+json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  })
  if (!res.ok) return json({ error: `github ${res.status}` }, 502)

  const releases = await res.json()
  const byExt = {}
  const out = releases.map(rel => ({
    tag: rel.tag_name,
    publishedAt: rel.published_at,
    assets: (rel.assets || []).map(a => {
      const ext = Object.keys(PLATFORM_EXT).find(k => a.name.toLowerCase().endsWith(PLATFORM_EXT[k]))
      if (ext) byExt[ext] = (byExt[ext] || 0) + (a.download_count || 0)
      return { name: a.name, count: a.download_count || 0 }
    }),
  }))

  const data = {
    totalsByPlatform: byExt,
    grandTotal: Object.values(byExt).reduce((a, b) => a + b, 0),
    releases: out,
  }
  ghCache = { at: now, data }
  return json(data)
}

/* ── latest-release resolution (10-min cache) ──────────────────────────────── */

let releaseCache = { at: 0, data: null }

async function getLatestRelease(env) {
  const now = Date.now()
  if (releaseCache.data && now - releaseCache.at < 10 * 60_000) return releaseCache.data
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/releases/latest`, {
    headers: { 'user-agent': 'signage-analytics-worker', accept: 'application/vnd.github+json' },
    cf: { cacheTtl: 600, cacheEverything: true },
  })
  if (!res.ok) {
    if (releaseCache.data) return releaseCache.data // serve stale over failing
    throw new Error(`github ${res.status}`)
  }
  const data = await res.json()
  releaseCache = { at: now, data }
  return data
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

async function withAuth(request, env, fn) {
  const h = request.headers.get('authorization') || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!env.ADMIN_TOKEN || !token || !(await digestsEqual(token, env.ADMIN_TOKEN))) {
    return json({ error: 'unauthorized' }, 401)
  }
  return fn()
}

async function digestsEqual(a, b) {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const va = new Uint8Array(ha)
  const vb = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
}

async function sha16(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function getCookie(request, name) {
  const cookie = request.headers.get('cookie') || ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return m ? m[1] : null
}

function uaOS(ua) {
  if (/windows nt/i.test(ua)) return 'Windows'
  if (/android/i.test(ua)) return 'Android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS'
  if (/mac os x|macintosh/i.test(ua)) return 'macOS'
  if (/cros/i.test(ua)) return 'ChromeOS'
  if (/tizen/i.test(ua)) return 'Tizen'
  if (/web0s|webos/i.test(ua)) return 'webOS'
  if (/linux/i.test(ua)) return 'Linux'
  return 'Other'
}

function uaBrowser(ua) {
  if (/edg\//i.test(ua)) return 'Edge'
  if (/opr\//i.test(ua)) return 'Opera'
  if (/samsungbrowser/i.test(ua)) return 'Samsung Internet'
  if (/firefox\//i.test(ua)) return 'Firefox'
  if (/chrome\//i.test(ua)) return 'Chrome'
  if (/safari\//i.test(ua)) return 'Safari'
  if (/curl|wget|powershell/i.test(ua)) return 'CLI'
  return 'Other'
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...extra },
  })
}
