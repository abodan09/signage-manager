import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { WebSocket } from 'ws'
import type { JsonDB } from '../database'
import type { PackStore } from '../packs'
import type { ContentItem, Design } from '../types'
import { sanitizeDesign } from '../scenes'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i

export function createDesignsRouter(
  db: JsonDB,
  packs: PackStore,
  uploadsDir: string,
  tvClients: Map<string, WebSocket>,
) {
  const router = Router()

  const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname)}`),
  })
  const upload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 },
    // Designs reference uploads by path and the scene renderer emits them into
    // an <img>; anything that is not an image has no way to render and no
    // business being reachable through this route.
    fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
  })

  function broadcast(msg: object) {
    const data = JSON.stringify(msg)
    tvClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })
  }

  /** GET /api/designs — the operator's saved designs, newest first.
   *  `?templates=1` returns their own saved templates instead; the two are the
   *  same shape but never belong in the same list. */
  router.get('/', (req, res) => {
    const wantTemplates = req.query.templates === '1'
    const designs = db.getAllDesigns().filter(d => !!d.isTemplate === wantTemplates)
    // Which designs are already on the wall, so the gallery can say so without
    // a second round-trip.
    const published = new Set(db.getAllContent().filter(c => c.designId).map(c => c.designId))
    res.json({ designs: designs.map(d => ({ ...d, published: published.has(d.id) })) })
  })

  /** GET /api/designs/assets — every image already on this machine, so the
   *  Designer can reuse a logo instead of making the operator find the file
   *  again. Declared before /:id or Express would read "assets" as an id. */
  router.get('/assets', (_req, res) => {
    let files: string[] = []
    try {
      files = fs.readdirSync(uploadsDir).filter(f => IMAGE_EXT.test(f))
    } catch { /* uploads dir vanished — an empty library is the right answer */ }

    // Original filenames live on content items; anything else shows its own.
    const named = new Map<string, string>()
    db.getAllContent().forEach(c => {
      if (c.filePath && c.fileName) named.set(path.basename(c.filePath), c.fileName)
    })

    const assets = files.map(f => {
      let mtime = 0
      try { mtime = fs.statSync(path.join(uploadsDir, f)).mtimeMs } catch { /* raced with a delete */ }
      return { path: `/uploads/${f}`, name: named.get(f) ?? f, mtime }
    }).sort((a, b) => b.mtime - a.mtime)

    res.json({ assets })
  })

  // POST /api/designs/upload — add an image to the library from the Designer
  router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) { res.status(400).json({ error: 'Choose an image file (PNG, JPG, GIF, WEBP or SVG).' }); return }
    res.status(201).json({ path: `/uploads/${req.file.filename}`, name: req.file.originalname })
  })

  // GET /api/designs/:id
  router.get('/:id', (req, res) => {
    const design = db.getDesignById(req.params.id)
    if (!design) { res.status(404).json({ error: 'Design not found' }); return }
    res.json({ design })
  })

  /** POST /api/designs
   *  Either a full design body, or { fromTemplate: { category, key } } to open
   *  a pack template as a fresh editable copy — the pack file itself is never
   *  mutated, so "reset to the original" is always just re-importing it. */
  router.post('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    let source: unknown = body

    const from = body.fromTemplate as { category?: unknown; key?: unknown } | undefined
    if (from && typeof from === 'object') {
      const category = String(from.category ?? '')
      const key = String(from.key ?? '')
      const tpl = packs.getTemplate(category, key)
      if (!tpl) { res.status(404).json({ error: 'Template not found. Install its category first.' }); return }
      source = {
        ...tpl.design,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : tpl.name,
        category: tpl.category,
        templateKey: tpl.key,
      }
    }

    const clean = sanitizeDesign(source)
    if (!clean.ok) { res.status(400).json({ error: clean.error }); return }

    const now = new Date().toISOString()
    const created = db.insertDesign({ id: uuid(), ...clean.design, createdAt: now, updatedAt: now })
    res.status(201).json({ design: created })
  })

  // PUT /api/designs/:id — whole-document replace (the Designer always sends the
  // full scene; partial merges of a canvas are ambiguous and lose deletions).
  router.put('/:id', (req, res) => {
    const existing = db.getDesignById(req.params.id)
    if (!existing) { res.status(404).json({ error: 'Design not found' }); return }

    const clean = sanitizeDesign({
      // Provenance is not editable from the canvas — carry it forward.
      category: existing.category,
      templateKey: existing.templateKey,
      ...(req.body ?? {}),
    })
    if (!clean.ok) { res.status(400).json({ error: clean.error }); return }

    const updated = db.updateDesign(req.params.id, clean.design as Partial<Design>)
    // Scenes are rendered server-side on request, so a TV showing this design
    // only needs to be told to rebuild its rotation to pick up the new version.
    if (db.getContentByDesignId(req.params.id).length) broadcast({ type: 'playlist_update' })
    res.json({ design: updated })
  })

  // DELETE /api/designs/:id
  router.delete('/:id', (req, res) => {
    const result = db.deleteDesign(req.params.id)
    if (!result.deleted) { res.status(404).json({ error: 'Design not found' }); return }
    if (result.removedContentIds.length) broadcast({ type: 'playlist_update' })
    res.json({ ok: true, removedFromPlaylist: result.removedContentIds.length })
  })

  /** POST /api/designs/:id/save-as-template — add this design to the team's
   *  own template library.
   *
   *  A copy, deliberately: the operator carries on editing the design, and the
   *  template stays as it was when they saved it. Stored as an ordinary design
   *  flagged `isTemplate`, so it needs no second storage shape and shows up in
   *  the Designer's rail beside the shipped packs. */
  router.post('/:id/save-as-template', (req, res) => {
    const design = db.getDesignById(req.params.id)
    if (!design) { res.status(404).json({ error: 'Design not found' }); return }

    const raw = (req.body ?? {}) as Record<string, unknown>
    const name = (typeof raw.name === 'string' && raw.name.trim() ? raw.name : design.name).trim().slice(0, 80)

    const existing = db.getAllDesigns().find(d => d.isTemplate && d.name === name)
    const now = new Date().toISOString()
    const saved = existing
      ? db.updateDesign(existing.id, {
        width: design.width, height: design.height,
        background: design.background, elements: design.elements,
      })
      : db.insertDesign({
        id: uuid(),
        ...JSON.parse(JSON.stringify({
          name,
          category: design.category,
          templateKey: design.templateKey,
          width: design.width,
          height: design.height,
          background: design.background,
          elements: design.elements,
        })),
        isTemplate: true,
        createdAt: now,
        updatedAt: now,
      })

    res.status(existing ? 200 : 201).json({ template: saved, replaced: !!existing })
  })

  /** POST /api/designs/:id/publish — put the design on the wall.
   *  One design maps to at most one playlist item: publishing twice updates the
   *  existing entry instead of stacking duplicates on every save. */
  router.post('/:id/publish', (req, res) => {
    const design = db.getDesignById(req.params.id)
    if (!design) { res.status(404).json({ error: 'Design not found' }); return }

    const body = (req.body ?? {}) as Record<string, unknown>
    const duration = Number(body.durationSeconds)
    const durationSeconds = Number.isFinite(duration) && duration >= 1 && duration <= 3600 ? Math.round(duration) : 15
    const mode = body.scheduleMode
    const scheduleMode = mode === 'scheduled' || mode === 'manual' ? mode : 'loop'

    const existing = db.getContentByDesignId(design.id)[0]
    let item: ContentItem | null

    if (existing) {
      item = db.updateContent(existing.id, { name: design.name, durationSeconds, scheduleMode, isActive: true })
    } else {
      const now = new Date().toISOString()
      const maxOrder = db.getAllContent().reduce((m, c) => Math.max(m, c.orderIndex), -1)
      item = db.insertContent({
        id: uuid(),
        name: design.name,
        type: 'design',
        designId: design.id,
        durationSeconds,
        scheduleMode,
        isActive: true,
        orderIndex: maxOrder + 1,
        createdAt: now,
        updatedAt: now,
      })
    }

    broadcast({ type: 'playlist_update' })
    res.status(existing ? 200 : 201).json({ item })
  })

  return router
}
