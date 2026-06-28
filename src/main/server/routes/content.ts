import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { v4 as uuid } from 'uuid'
import { WebSocketServer, WebSocket } from 'ws'
import type { JsonDB } from '../database'
import type { ContentItem } from '../types'

export function createContentRouter(
  db: JsonDB,
  uploadsDir: string,
  wss: WebSocketServer,
  tvClients: Map<string, WebSocket>,
) {
  const router = Router()

  const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname)
      cb(null, `${uuid()}${ext}`)
    },
  })
  const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } })

  function broadcast(msg: object) {
    const data = JSON.stringify(msg)
    tvClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })
  }

  // GET /api/content
  router.get('/', (_req, res) => {
    res.json({ items: db.getAllContent() })
  })

  // GET /api/content/active  (used by TV player)
  router.get('/active', (_req, res) => {
    const items = db.getAllContent().filter(c => c.isActive)
    res.json({ items })
  })

  // POST /api/content  (multipart for file types, JSON for html/text)
  router.post('/', upload.single('file'), (req, res) => {
    const body = req.body as Record<string, string>

    const type = body.type as ContentItem['type']
    if (!['image', 'video', 'html', 'text'].includes(type)) {
      res.status(400).json({ error: 'Invalid type' })
      return
    }

    const now = new Date().toISOString()
    const maxOrder = db.getAllContent().reduce((m, c) => Math.max(m, c.orderIndex), -1)

    const item: ContentItem = {
      id: uuid(),
      name: body.name || 'Untitled',
      type,
      durationSeconds: parseInt(body.durationSeconds ?? '10', 10),
      scheduleMode: (body.scheduleMode as ContentItem['scheduleMode']) ?? 'loop',
      isActive: body.isActive !== 'false',
      orderIndex: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    }

    if (body.scheduleStartTime) item.scheduleStartTime = body.scheduleStartTime
    if (body.scheduleEndTime) item.scheduleEndTime = body.scheduleEndTime
    if (body.scheduleDays) {
      try { item.scheduleDays = JSON.parse(body.scheduleDays) } catch { /* ignore */ }
    }

    if ((type === 'image' || type === 'video') && req.file) {
      item.filePath = `/uploads/${req.file.filename}`
      item.fileName = req.file.originalname
      item.mimeType = req.file.mimetype
    } else if (type === 'html') {
      item.htmlUrl = body.htmlUrl
    } else if (type === 'text') {
      item.textContent = body.textContent ?? ''
      item.textBgColor = body.textBgColor ?? '#000000'
      item.textFgColor = body.textFgColor ?? '#ffffff'
      item.textFontSize = parseInt(body.textFontSize ?? '72', 10)
      item.textPosition = (body.textPosition as ContentItem['textPosition']) ?? 'center'
    }

    db.insertContent(item)
    broadcast({ type: 'playlist_update' })
    res.status(201).json(item)
  })

  // PUT /api/content/:id
  router.put('/:id', upload.single('file'), (req, res) => {
    const existing = db.getContentById(req.params.id)
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }

    const body = req.body as Record<string, string>
    const updates: Partial<ContentItem> = {}

    if (body.name !== undefined) updates.name = body.name
    if (body.durationSeconds !== undefined) updates.durationSeconds = parseInt(body.durationSeconds, 10)
    if (body.scheduleMode !== undefined) updates.scheduleMode = body.scheduleMode as ContentItem['scheduleMode']
    if (body.scheduleStartTime !== undefined) updates.scheduleStartTime = body.scheduleStartTime
    if (body.scheduleEndTime !== undefined) updates.scheduleEndTime = body.scheduleEndTime
    if (body.scheduleDays !== undefined) {
      try { updates.scheduleDays = JSON.parse(body.scheduleDays) } catch { /* ignore */ }
    }
    if (body.isActive !== undefined) updates.isActive = body.isActive !== 'false'
    if (body.htmlUrl !== undefined) updates.htmlUrl = body.htmlUrl
    if (body.textContent !== undefined) updates.textContent = body.textContent
    if (body.textBgColor !== undefined) updates.textBgColor = body.textBgColor
    if (body.textFgColor !== undefined) updates.textFgColor = body.textFgColor
    if (body.textFontSize !== undefined) updates.textFontSize = parseInt(body.textFontSize, 10)
    if (body.textPosition !== undefined) updates.textPosition = body.textPosition as ContentItem['textPosition']

    if (req.file && (existing.type === 'image' || existing.type === 'video')) {
      // Delete old file
      if (existing.filePath) {
        const old = path.join(uploadsDir, path.basename(existing.filePath))
        if (fs.existsSync(old)) fs.unlinkSync(old)
      }
      updates.filePath = `/uploads/${req.file.filename}`
      updates.fileName = req.file.originalname
      updates.mimeType = req.file.mimetype
    }

    const updated = db.updateContent(req.params.id, updates)
    broadcast({ type: 'playlist_update' })
    res.json(updated)
  })

  // PATCH /api/content/reorder
  router.patch('/reorder', (req, res) => {
    const { ids } = req.body as { ids: string[] }
    if (!Array.isArray(ids)) { res.status(400).json({ error: 'ids array required' }); return }
    db.reorderContent(ids)
    broadcast({ type: 'playlist_update' })
    res.json({ ok: true })
  })

  // DELETE /api/content/:id
  router.delete('/:id', (req, res) => {
    const item = db.getContentById(req.params.id)
    if (!item) { res.status(404).json({ error: 'Not found' }); return }

    if (item.filePath) {
      const filePath = path.join(uploadsDir, path.basename(item.filePath))
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }

    db.deleteContent(req.params.id)
    broadcast({ type: 'playlist_update' })
    res.json({ ok: true })
  })

  return router
}
