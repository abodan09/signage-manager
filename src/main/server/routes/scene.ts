import { Router } from 'express'
import type { JsonDB } from '../database'
import type { PackStore } from '../packs'
import { fontFaceCss } from '../fonts'
import { renderSceneHtml } from '../scenes'

/** Serves designs as standalone pages for the player's iframe. Mounted under
 *  /tv, which sits outside the operator-only /api gate — a TV anywhere on the
 *  LAN must be able to load it, exactly like /tv/player and /uploads. Nothing
 *  here reads request bodies or mutates state, and the renderer escapes every
 *  string, so the open mount adds no write surface. */
export function createSceneRouter(db: JsonDB, packs: PackStore, fontsDir: string) {
  const router = Router()

  // Computed once: the set of bundled faces cannot change while the app runs.
  const fontCss = fontFaceCss(fontsDir)

  function send(res: import('express').Response, html: string) {
    res.setHeader('Content-Type', 'text/html')
    res.setHeader('Referrer-Policy', 'no-referrer')
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

  return router
}
