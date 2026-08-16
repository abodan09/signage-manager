import { Router } from 'express'
import type { JsonDB } from '../database'
import type { PackStore } from '../packs'
import type { AppStore } from '../apps/store'
import { fontFaceCss } from '../fonts'
import { renderSceneHtml } from '../scenes'

/** Serves designs as standalone pages for the player's iframe. Mounted under
 *  /tv, which sits outside the operator-only /api gate — a TV anywhere on the
 *  LAN must be able to load it, exactly like /tv/player and /uploads. Nothing
 *  here reads request bodies or mutates state, and the renderer escapes every
 *  string, so the open mount adds no write surface. */
export function createSceneRouter(
  db: JsonDB,
  packs: PackStore,
  fontsDir: string,
  apps?: AppStore,
  getLanUrl?: () => string,
) {
  const router = Router()

  // Computed once: the set of bundled faces cannot change while the app runs.
  const fontCss = fontFaceCss(fontsDir)

  /** `referrer`: 'none' for our own designs, which have no reason to tell
   *  anyone they exist. App pages need 'origin' — an embedded YouTube player
   *  validates the embedding site and fails with a configuration error when no
   *  referrer arrives. strict-origin-when-cross-origin sends only the origin,
   *  never the path, so the instance id still stays private. */
  function send(res: import('express').Response, html: string, referrer: 'none' | 'origin' = 'none') {
    res.setHeader('Content-Type', 'text/html')
    res.setHeader('Referrer-Policy', referrer === 'origin' ? 'strict-origin-when-cross-origin' : 'no-referrer')
    // Scenes change whenever the operator saves; a TV must never show a stale
    // one from the WebView's HTTP cache after a playlist_update.
    res.setHeader('Cache-Control', 'no-store')
    res.send(html)
  }

  function notFound(res: import('express').Response, what: string) {
    send(res, `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not found</title></head>` +
      `<body style="margin:0;height:100%;background:#000;color:#555;font-family:Arial,Helvetica,sans-serif">` +
      `<div style="position:absolute;top:50%;left:0;right:0;text-align:center;font-size:28px">${what}</div>` +
      `</body></html>`)
  }

  // GET /tv/scene/:id — a saved design
  router.get('/scene/:id', (req, res) => {
    const design = db.getDesignById(req.params.id)
    if (!design) { res.status(404); notFound(res, 'Design not found'); return }
    send(res, renderSceneHtml(design, fontCss))
  })

  /** GET /tv/template/:category/:key — a pack template rendered straight from
   *  the catalog. Used for gallery previews, so browsing does not litter the
   *  database with throwaway design records. */
  router.get('/template/:category/:key', (req, res) => {
    const tpl = packs.getTemplate(req.params.category, req.params.key)
    if (!tpl) { res.status(404); notFound(res, 'Template not found'); return }
    send(res, renderSceneHtml({ ...tpl.design, name: tpl.name }, fontCss))
  })

  // GET /tv/app/:id — a configured app, rendered for a screen
  router.get('/app/:id', (req, res) => {
    if (!apps) { res.status(404); notFound(res, 'Apps are not available'); return }
    const inst = db.getAppInstanceById(req.params.id)
    if (!inst) { res.status(404); notFound(res, 'App not found'); return }
    send(res, apps.render(inst, getLanUrl ? getLanUrl() : ''), 'origin')
  })

  /** GET /tv/app/:id/data — the payload the app page polls.
   *
   *  Only what the app already draws on the screen is exposed, never the
   *  credentials used to fetch it: the manager talks to the third party, the
   *  screen talks only to the manager. Serving it separately is what lets a
   *  wall pick up new posts without reloading the page. */
  router.get('/app/:id/data', (req, res) => {
    if (!apps) { res.status(404).json({ error: 'Apps are not available' }); return }
    const inst = db.getAppInstanceById(req.params.id)
    if (!inst) { res.status(404).json({ error: 'App not found' }); return }
    const entry = apps.getCached(inst.id)
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      data: apps.serialize(inst, getLanUrl ? getLanUrl() : ''),
      fetchedAt: entry ? new Date(entry.fetchedAt).toISOString() : null,
      // The page uses this to decide whether to show a quiet "not updating"
      // hint; it must never blank working content over it.
      stale: entry ? entry.expiresAt < Date.now() : true,
      error: entry?.lastError ?? null,
    })
  })

  return router
}
