import { useEffect, useState } from 'react'
import type { Device, ContentItem } from '../types'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

export default function DevicesPage() {
  const serverUrl = useServerUrl()
  const [devices, setDevices] = useState<Device[]>([])
  const [content, setContent] = useState<ContentItem[]>([])
  const [pushTarget, setPushTarget] = useState<Device | null>(null)
  const [pushContentId, setPushContentId] = useState('')
  const [pushStatus, setPushStatus] = useState('')
  const [renameTarget, setRenameTarget] = useState<Device | null>(null)
  const [renameName, setRenameName] = useState('')

  const load = () => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/devices`).then(r => r.json()).then(d => setDevices(d.devices ?? []))
    fetch(`${serverUrl}/api/content`).then(r => r.json()).then(d => setContent(d.items ?? []))
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [serverUrl])

  async function handleDelete(id: string) {
    await fetch(`${serverUrl}/api/devices/${id}`, { method: 'DELETE' })
    load()
  }

  async function handlePush() {
    if (!pushTarget || !pushContentId) return
    setPushStatus('Sending…')
    try {
      const res = await fetch(`${serverUrl}/api/devices/${pushTarget.id}/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentId: pushContentId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setPushStatus('Sent successfully!')
      setTimeout(() => { setPushTarget(null); setPushStatus(''); setPushContentId('') }, 1500)
    } catch (e: unknown) {
      setPushStatus(e instanceof Error ? e.message : 'Error')
    }
  }

  async function handleRename() {
    if (!renameTarget || !renameName.trim()) return
    await fetch(`${serverUrl}/api/devices/${renameTarget.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameName.trim() }),
    })
    setRenameTarget(null)
    load()
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Devices</h1>
          <p className="subtitle">TVs that have connected to your signage server</p>
        </div>
      </div>

      {devices.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📺</div>
          <p>No TVs connected yet.</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            Install the TV app and point it at your server URL shown in Settings.
          </p>
        </div>
      ) : (
        <div className="device-list">
          {devices.map(d => (
            <div key={d.id} className="device-row">
              <span className="device-icon">📺</span>
              <div className="device-info">
                <div className="device-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`dot ${d.status === 'online' ? 'dot-green' : 'dot-gray'}`} />
                  {d.name}
                  <span className={`badge ${d.status === 'online' ? 'badge-green' : 'badge-gray'}`} style={{ marginLeft: 4 }}>
                    {d.status}
                  </span>
                </div>
                <div className="device-sub">
                  ID: {d.id.slice(0, 12)}…
                  {d.ipAddress ? ` · ${d.ipAddress}` : ''}
                  {d.lastSeen ? ` · Last seen ${relTime(d.lastSeen)}` : ''}
                </div>
              </div>
              <div className="device-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={d.status !== 'online'}
                  title={d.status !== 'online' ? 'TV must be online to push content' : 'Push content to this TV'}
                  onClick={() => { setPushTarget(d); setPushContentId(''); setPushStatus('') }}
                >
                  Push Content
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setRenameTarget(d); setRenameName(d.name) }}
                >
                  Rename
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(d.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Push modal */}
      {pushTarget && (
        <div className="modal-backdrop" onClick={() => setPushTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Push to {pushTarget.name}</h2>
              <button className="btn-icon" onClick={() => setPushTarget(null)}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Immediately display a content item on this TV, overriding the current playlist.
            </p>
            <div className="form-group">
              <label className="form-label">Select Content</label>
              <select className="form-select" value={pushContentId} onChange={e => setPushContentId(e.target.value)}>
                <option value="">— choose —</option>
                {content.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                ))}
              </select>
            </div>
            {pushStatus && (
              <div style={{ color: pushStatus.includes('success') ? 'var(--success)' : 'var(--danger)', fontSize: 13 }}>
                {pushStatus}
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setPushTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePush} disabled={!pushContentId}>
                Push Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {renameTarget && (
        <div className="modal-backdrop" onClick={() => setRenameTarget(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Rename Device</h2>
              <button className="btn-icon" onClick={() => setRenameTarget(null)}>✕</button>
            </div>
            <div className="form-group">
              <label className="form-label">Device Name</label>
              <input className="form-input" value={renameName} onChange={e => setRenameName(e.target.value)} autoFocus />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setRenameTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleRename} disabled={!renameName.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
