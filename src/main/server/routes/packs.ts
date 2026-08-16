import { Router } from 'express'
import type { JsonDB } from '../database'
import type { PackStore } from '../packs'

export function createPacksRouter(db: JsonDB, packs: PackStore) {
  const router = Router()

  /** GET /api/packs — every category the registry knows about, each stamped
   *  with whether this install has it. `source` tells the UI whether it is
   *  looking at a live list or the offline fallback, so it can say so. */
  router.get('/', async (req, res) => {
    const { categories, source } = await packs.getCatalog(req.query.refresh === '1')
    res.json({ categories, source, installed: db.getInstalledPacks() })
  })

  /** GET /api/packs/templates?category=… — templates of one installed category,
   *  or of every installed category when the parameter is omitted. This is what
   *  both the gallery and the Designer's template rail read. */
  router.get('/templates', (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined
    if (category && !db.getInstalledPack(category)) {
      res.status(409).json({ error: 'That category is not installed yet.', category }); return
    }
    // Element bodies are heavy and the gallery only needs a thumbnail, so the
    // list is served as headers plus the design; the Designer reads the same
    // payload, which keeps one code path instead of two shapes.
    res.json({ templates: packs.getInstalledTemplates(category) })
  })

  // POST /api/packs/:category/install
  router.post('/:category/install', async (req, res) => {
    const result = await packs.install(req.params.category)
    if (!result.ok) { res.status(502).json({ error: result.error }); return }
    res.json({
      ok: true,
      category: result.pack.category,
      version: result.pack.version,
      templateCount: result.pack.templates.length,
    })
  })

  /** DELETE /api/packs/:category — removes the category from the library.
   *  Designs already created from it are untouched: once a template has been
   *  opened in the Designer it is the operator's own document. */
  router.delete('/:category', (req, res) => {
    if (!packs.uninstall(req.params.category)) {
      res.status(404).json({ error: 'That category is not installed.' }); return
    }
    res.json({ ok: true })
  })

  return router
}
