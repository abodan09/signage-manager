import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ContentItem, Project } from '../types'
import ContentForm from '../components/ContentForm'
import ProjectForm from '../components/ProjectForm'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

const TYPE_BADGE: Record<string, string> = {
  image: 'badge-blue', video: 'badge-yellow', html: 'badge-green', text: 'badge-gray', design: 'badge-blue',
}
const SCHEDULE_BADGE: Record<string, string> = {
  loop: 'badge-blue', scheduled: 'badge-yellow', manual: 'badge-gray',
}

type Tab = 'content' | 'projects'

export default function ContentPage() {
  const serverUrl = useServerUrl()
  const navigate = useNavigate()
  const [tab, setTab]         = useState<Tab>('content')

  // ── Content state ──────────────────────────────────────────────────────────
  const [items, setItems]           = useState<ContentItem[]>([])
  const [showForm, setShowForm]     = useState(false)
  const [editItem, setEditItem]     = useState<ContentItem | undefined>()
  const [deleteId, setDeleteId]     = useState<string | null>(null)

  // ── Projects state ─────────────────────────────────────────────────────────
  const [projects, setProjects]           = useState<(Project & { items: ContentItem[] })[]>([])
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [editProject, setEditProject]         = useState<Project | undefined>()
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null)
  const [expandedProject, setExpandedProject] = useState<string | null>(null)

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadContent = () => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/content`).then(r => r.json()).then(d => setItems(d.items ?? []))
  }

  const loadProjects = () => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/projects`).then(r => r.json()).then(d => setProjects(d.projects ?? []))
  }

  useEffect(() => { loadContent(); loadProjects() }, [serverUrl])

  // ── Content actions ────────────────────────────────────────────────────────

  async function handleDeleteContent(id: string) {
    await fetch(`${serverUrl}/api/content/${id}`, { method: 'DELETE' })
    setDeleteId(null)
    loadContent()
  }

  async function toggleActive(item: ContentItem) {
    const fd = new FormData()
    fd.append('isActive', String(!item.isActive))
    await fetch(`${serverUrl}/api/content/${item.id}`, { method: 'PUT', body: fd })
    loadContent()
  }

  // ── Project actions ────────────────────────────────────────────────────────

  async function handleDeleteProject(id: string) {
    await fetch(`${serverUrl}/api/projects/${id}`, { method: 'DELETE' })
    setDeleteProjectId(null)
    loadProjects(); loadContent()
  }

  async function toggleProjectActive(p: Project) {
    await fetch(`${serverUrl}/api/projects/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !p.isActive }),
    })
    loadProjects()
  }

  async function detachFromProject(projectId: string, contentId: string) {
    await fetch(`${serverUrl}/api/projects/${projectId}/content/${contentId}`, { method: 'DELETE' })
    loadProjects(); loadContent()
  }

  // ── Standalone content (no project) ───────────────────────────────────────
  const standaloneItems = items.filter(i => !i.projectId)

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Content Library</h1>
          <p className="subtitle">Manage advertisements, media, and projects</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tab === 'content' && (
            <button className="btn btn-primary" onClick={() => { setEditItem(undefined); setShowForm(true) }}>
              + Add Content
            </button>
          )}
          {tab === 'projects' && (
            <button className="btn btn-primary" onClick={() => { setEditProject(undefined); setShowProjectForm(true) }}>
              + New Project
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid var(--border)' }}>
        {(['content', 'projects'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 22px', fontSize: 14, fontWeight: tab === t ? 600 : 400,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderBottom: tab === t ? '2px solid #3b82f6' : '2px solid transparent',
              marginBottom: -1, transition: 'color 0.15s',
            }}
          >
            {t === 'content' ? `Content (${standaloneItems.length})` : `Projects (${projects.length})`}
          </button>
        ))}
      </div>

      {/* ── Content Tab ─────────────────────────────────────────────────── */}
      {tab === 'content' && (
        standaloneItems.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">🖼️</div>
            <p>No standalone content yet.</p>
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>Add your first item</button>
          </div>
        ) : (
          <div className="content-grid">
            {standaloneItems.map(item => (
              <div key={item.id} className={`content-card ${item.isActive ? '' : 'inactive'}`}>
                <div className="content-thumb">
                  {item.type === 'image' && item.filePath
                    ? <img src={`${serverUrl}${item.filePath}`} alt={item.name} />
                    : item.type === 'video' && item.filePath
                    ? <video src={`${serverUrl}${item.filePath}`} muted />
                    : <span>{typeIcon(item.type)}</span>
                  }
                </div>
                <div className="content-body">
                  <div className="content-name" title={item.name}>{item.name}</div>
                  <div className="content-meta">
                    <span className={`badge ${TYPE_BADGE[item.type] ?? 'badge-gray'}`}>{item.type}</span>
                    {item.type === 'text' && (
                      <span className="badge badge-gray" title="Runs as overlay on top of media">overlay</span>
                    )}
                    <span className={`badge ${SCHEDULE_BADGE[item.scheduleMode] ?? 'badge-gray'}`}>{item.scheduleMode}</span>
                    <span className="badge badge-gray">⏱ {item.durationSeconds}s</span>
                  </div>
                  {item.type === 'text' && item.overlayOpacity != null && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                      Opacity: {item.overlayOpacity}%
                    </div>
                  )}
                  {item.scheduleMode === 'scheduled' && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
                      {item.scheduleStartTime} – {item.scheduleEndTime}
                      {item.scheduleDays ? ` · ${item.scheduleDays.join(', ')}` : ''}
                    </div>
                  )}
                  <div className="content-actions">
                    {/* A design item is a pointer at a Designer document, so its
                        "Edit" has to open the Designer, not the content form. */}
                    {item.type === 'design' && item.designId ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/designer/${item.designId}`)}>
                        Edit design
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditItem(item); setShowForm(true) }}>Edit</button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(item)}>
                      {item.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(item.id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Projects Tab ────────────────────────────────────────────────── */}
      {tab === 'projects' && (
        projects.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">📁</div>
            <p>No projects yet.</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Group content into a project to share schedule settings and upload multiple files at once.
            </p>
            <button className="btn btn-primary" onClick={() => { setEditProject(undefined); setShowProjectForm(true) }}>Create your first project</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {projects.map(p => (
              <div
                key={p.id}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                {/* Project header */}
                <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 22 }}>📁</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                    {p.description && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{p.description}</div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      <span className={`badge ${p.isActive ? 'badge-blue' : 'badge-gray'}`}>
                        {p.isActive ? 'active' : 'inactive'}
                      </span>
                      <span className={`badge ${SCHEDULE_BADGE[p.scheduleMode] ?? 'badge-gray'}`}>{p.scheduleMode}</span>
                      <span className="badge badge-gray">⏱ {p.durationSeconds}s/item</span>
                      <span className="badge badge-gray">{p.items.length} item{p.items.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setExpandedProject(expandedProject === p.id ? null : p.id)}
                    >
                      {expandedProject === p.id ? '▲ Hide' : '▼ View items'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditProject(p); setShowProjectForm(true) }}>Edit</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleProjectActive(p)}>
                      {p.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteProjectId(p.id)}>Delete</button>
                  </div>
                </div>

                {/* Expanded content list */}
                {expandedProject === p.id && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
                    {p.items.length === 0 ? (
                      <div style={{ padding: '16px 18px', fontSize: 13, color: 'var(--text-secondary)' }}>
                        No items yet. Edit the project to add files or existing content.
                      </div>
                    ) : p.items.map(item => (
                      <div key={item.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '8px 18px',
                        borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.04))',
                      }}>
                        <span style={{ fontSize: 16 }}>{typeIcon(item.type)}</span>
                        <span style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.name}
                        </span>
                        <span className={`badge ${TYPE_BADGE[item.type] ?? 'badge-gray'}`}>{item.type}</span>
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Detach from project (keeps the item)"
                          onClick={() => detachFromProject(p.id, item.id)}
                          style={{ fontSize: 11 }}
                        >
                          Detach
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}

      {showForm && (
        <ContentForm
          serverUrl={serverUrl}
          item={editItem}
          onSave={() => { setShowForm(false); setEditItem(undefined); loadContent() }}
          onClose={() => { setShowForm(false); setEditItem(undefined) }}
        />
      )}

      {showProjectForm && (
        <ProjectForm
          serverUrl={serverUrl}
          project={editProject}
          existingContent={standaloneItems}
          onSave={() => { setShowProjectForm(false); setEditProject(undefined); loadProjects(); loadContent() }}
          onClose={() => { setShowProjectForm(false); setEditProject(undefined) }}
        />
      )}

      {deleteId && (
        <div className="modal-backdrop" onClick={() => setDeleteId(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete Content?</h2>
              <button className="btn-icon" onClick={() => setDeleteId(null)}>✕</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              This will permanently delete the content and its file. This cannot be undone.
            </p>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDeleteContent(deleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {deleteProjectId && (
        <div className="modal-backdrop" onClick={() => setDeleteProjectId(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete Project?</h2>
              <button className="btn-icon" onClick={() => setDeleteProjectId(null)}>✕</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              The project will be deleted. Content items inside it will be detached (not deleted) and become standalone.
            </p>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeleteProjectId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDeleteProject(deleteProjectId)}>Delete Project</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function typeIcon(t: string) {
  return { image: '🖼️', video: '🎬', html: '🌐', text: '✏️', design: '🎨' }[t] ?? '📄'
}
