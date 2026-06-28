import { useEffect, useState } from 'react'
import type { ContentItem } from '../types'
import ContentForm from '../components/ContentForm'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

const TYPE_BADGE: Record<string, string> = {
  image: 'badge-blue', video: 'badge-yellow', html: 'badge-green', text: 'badge-gray',
}
const SCHEDULE_BADGE: Record<string, string> = {
  loop: 'badge-blue', scheduled: 'badge-yellow', manual: 'badge-gray',
}

export default function ContentPage() {
  const serverUrl = useServerUrl()
  const [items, setItems] = useState<ContentItem[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<ContentItem | undefined>()
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const load = () => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/content`).then(r => r.json()).then(d => setItems(d.items ?? []))
  }

  useEffect(() => { load() }, [serverUrl])

  async function handleDelete(id: string) {
    await fetch(`${serverUrl}/api/content/${id}`, { method: 'DELETE' })
    setDeleteId(null)
    load()
  }

  async function toggleActive(item: ContentItem) {
    const fd = new FormData()
    fd.append('isActive', String(!item.isActive))
    await fetch(`${serverUrl}/api/content/${item.id}`, { method: 'PUT', body: fd })
    load()
  }

  function handleSaved() {
    setShowForm(false)
    setEditItem(undefined)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Content Library</h1>
          <p className="subtitle">Manage your advertisements and display content</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditItem(undefined); setShowForm(true) }}>
          + Add Content
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🖼️</div>
          <p>No content added yet.</p>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>Add your first ad</button>
        </div>
      ) : (
        <div className="content-grid">
          {items.map(item => (
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
                  <span className={`badge ${SCHEDULE_BADGE[item.scheduleMode] ?? 'badge-gray'}`}>{item.scheduleMode}</span>
                  <span className="badge badge-gray">⏱ {item.durationSeconds}s</span>
                </div>
                {item.scheduleMode === 'scheduled' && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
                    {item.scheduleStartTime} – {item.scheduleEndTime}
                    {item.scheduleDays ? ` · ${item.scheduleDays.join(', ')}` : ''}
                  </div>
                )}
                <div className="content-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditItem(item); setShowForm(true) }}>Edit</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(item)}>
                    {item.isActive ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteId(item.id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <ContentForm
          serverUrl={serverUrl}
          item={editItem}
          onSave={handleSaved}
          onClose={() => { setShowForm(false); setEditItem(undefined) }}
        />
      )}

      {/* Delete confirm */}
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
              <button className="btn btn-danger" onClick={() => handleDelete(deleteId)}>Delete</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function typeIcon(t: string) {
  return { image: '🖼️', video: '🎬', html: '🌐', text: '✏️' }[t] ?? '📄'
}
