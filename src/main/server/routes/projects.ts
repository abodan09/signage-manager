import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { WebSocketServer, WebSocket } from 'ws'
import type { JsonDB } from '../database'
import type { ContentItem, Project } from '../types'

export function createProjectsRouter(
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

  // GET /api/projects  — list all projects + their content items
  router.get('/', (_req, res) => {
    const projects = db.getAllProjects()
    const withItems = projects.map(p => ({
      ...p,
      items: db.getContentByProjectId(p.id),
    }))
    res.json({ projects: withItems })
  })

  // POST /api/projects  — create project (JSON body)
  router.post('/', (req, res) => {
    const body = req.body as Record<string, any>
    if (!body.name?.trim()) { res.status(400).json({ error: 'Name is required' }); return }

    const now = new Date().toISOString()
    const maxOrder = db.getAllProjects().reduce((m, p) => Math.max(m, p.orderIndex), -1)

    const project: Project = {
      id: uuid(),
      name: body.name.trim(),
      description: body.description?.trim() || undefined,
      durationSeconds: parseInt(body.durationSeconds ?? '10', 10),
      scheduleMode: body.scheduleMode ?? 'loop',
      isActive: body.isActive !== false && body.isActive !== 'false',
      orderIndex: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    }
    if (body.scheduleStartTime) project.scheduleStartTime = body.scheduleStartTime
    if (body.scheduleEndTime)   project.scheduleEndTime   = body.scheduleEndTime
    if (body.scheduleDays) {
      try { project.scheduleDays = typeof body.scheduleDays === 'string' ? JSON.parse(body.scheduleDays) : body.scheduleDays } catch { /* ignore */ }
    }

    db.insertProject(project)
    res.status(201).json(project)
  })

  // PUT /api/projects/:id
  router.put('/:id', (req, res) => {
    const existing = db.getProjectById(req.params.id)
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }

    const body = req.body as Record<string, any>
    const updates: Partial<Project> = {}

    if (body.name !== undefined)            updates.name            = body.name.trim()
    if (body.description !== undefined)     updates.description     = body.description?.trim() || undefined
    if (body.durationSeconds !== undefined) updates.durationSeconds = parseInt(body.durationSeconds, 10)
    if (body.scheduleMode !== undefined)    updates.scheduleMode    = body.scheduleMode
    if (body.scheduleStartTime !== undefined) updates.scheduleStartTime = body.scheduleStartTime
    if (body.scheduleEndTime !== undefined)   updates.scheduleEndTime   = body.scheduleEndTime
    if (body.scheduleDays !== undefined) {
      try { updates.scheduleDays = typeof body.scheduleDays === 'string' ? JSON.parse(body.scheduleDays) : body.scheduleDays } catch { /* ignore */ }
    }
    if (body.isActive !== undefined) updates.isActive = body.isActive !== false && body.isActive !== 'false'

    const updated = db.updateProject(req.params.id, updates)
    broadcast({ type: 'playlist_update' })
    res.json(updated)
  })

  // DELETE /api/projects/:id
  router.delete('/:id', (req, res) => {
    const ok = db.deleteProject(req.params.id)
    if (!ok) { res.status(404).json({ error: 'Not found' }); return }
    broadcast({ type: 'playlist_update' })
    res.json({ ok: true })
  })

  // GET /api/projects/:id/content
  router.get('/:id/content', (req, res) => {
    const project = db.getProjectById(req.params.id)
    if (!project) { res.status(404).json({ error: 'Not found' }); return }
    res.json({ items: db.getContentByProjectId(req.params.id) })
  })

  // POST /api/projects/:id/content  — multi-file upload OR attach existing items
  router.post('/:id/content', upload.array('files'), (req, res) => {
    const project = db.getProjectById(req.params.id)
    if (!project) { res.status(404).json({ error: 'Not found' }); return }

    const body = req.body as Record<string, any>
    const created: ContentItem[] = []

    // Attach existing content items by ID
    const existingIds: string[] = []
    if (body.existingIds) {
      try {
        const parsed = typeof body.existingIds === 'string' ? JSON.parse(body.existingIds) : body.existingIds
        if (Array.isArray(parsed)) existingIds.push(...parsed)
      } catch { /* ignore */ }
    }
    existingIds.forEach(id => {
      const item = db.getContentById(id)
      if (item) db.updateContent(id, { projectId: project.id })
    })

    // Create new items from uploaded files
    const files = (req.files ?? []) as Express.Multer.File[]
    const now = new Date().toISOString()
    const maxOrder = db.getAllContent().reduce((m, c) => Math.max(m, c.orderIndex), -1)

    files.forEach((file, i) => {
      const isVideo = file.mimetype.startsWith('video/')
      const item: ContentItem = {
        id: uuid(),
        name: file.originalname.replace(/\.[^.]+$/, ''),
        type: isVideo ? 'video' : 'image',
        filePath: `/uploads/${file.filename}`,
        fileName: file.originalname,
        mimeType: file.mimetype,
        projectId: project.id,
        durationSeconds: project.durationSeconds,
        scheduleMode: project.scheduleMode,
        scheduleStartTime: project.scheduleStartTime,
        scheduleEndTime: project.scheduleEndTime,
        scheduleDays: project.scheduleDays,
        isActive: project.isActive,
        orderIndex: maxOrder + 1 + i,
        createdAt: now,
        updatedAt: now,
      }
      db.insertContent(item)
      created.push(item)
    })

    broadcast({ type: 'playlist_update' })
    res.status(201).json({ created, attachedCount: existingIds.length })
  })

  // DELETE /api/projects/:id/content/:contentId  — detach from project (keep item)
  router.delete('/:id/content/:contentId', (req, res) => {
    const item = db.getContentById(req.params.contentId)
    if (!item || item.projectId !== req.params.id) { res.status(404).json({ error: 'Not found' }); return }
    db.updateContent(req.params.contentId, { projectId: undefined })
    broadcast({ type: 'playlist_update' })
    res.json({ ok: true })
  })

  return router
}
