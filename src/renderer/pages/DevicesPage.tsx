import { useEffect, useState } from 'react'
import type { Device, ContentItem, Project } from '../types'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

type PushMode = 'content' | 'project'

export default function DevicesPage() {
  const serverUrl = useServerUrl()
  const [devices, setDevices]       = useState<Device[]>([])
  const [content, setContent]       = useState<ContentItem[]>([])
  const [projects, setProjects]     = useState<(Project & { items?: ContentItem[] })[]>([])

  const [pushTarget, setPushTarget]         = useState<Device | null>(null)
  const [pushMode, setPushMode]             = useState<PushMode>('content')
  const [pushContentId, setPushContentId]   = useState('')
  const [pushProjectId, setPushProjectId]   = useState('')
  const [pushStatus, setPushStatus]         = useState('')

  const [renameTarget, setRenameTarget] = useState<Device | null>(null)
  const [renameName, setRenameName]     = useState('')

  // Discovery info
  const [discoveryInfo, setDiscoveryInfo] = useState<{ ip: string; port: number } | null>(null)

  const load = () => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/devices`).then(r => r.json()).then(d => setDevices(d.devices ?? []))
    fetch(`${serverUrl}/api/content`).then(r => r.json()).then(d => setContent(d.items ?? []))
    fetch(`${serverUrl}/api/projects`).then(r => r.json()).then(d => setProjects(d.projects ?? []))
    fetch(`${serverUrl}/api/discovery`).then(r => r.json()).then(d => setDiscoveryInfo(d)).catch(() => {})
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
    if (!pushTarget) return
    setPushStatus('Sending…')
    try {
      let url: string
      let body: object

      if (pushMode === 'content') {
        if (!pushContentId) return
        url  = `${serverUrl}/api/devices/${pushTarget.id}/push`
        body = { contentId: pushContentId }
      } else {
        if (!pushProjectId) return
        url  = `${serverUrl}/api/devices/${pushTarget.id}/push-project`
        body = { projectId: pushProjectId }
      }

      const res  = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setPushStatus(pushMode === 'project'
        ? `Project pushed (${data.count} items)`
        : 'Sent successfully!')
      setTimeout(() => { setPushTarget(null); setPushStatus(''); setPushContentId(''); setPushProjectId('') }, 1800)
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

  const canPush = pushMode === 'content' ? !!pushContentId : !!pushProjectId

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Devices</h1>
          <p className="subtitle">TVs that have connected to your signage server</p>
        </div>
      </div>

      {/* Discovery banner */}
      {discoveryInfo && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)',
          borderRadius: 10, padding: '10px 18px', marginBottom: 24, fontSize: 13,
        }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite', flexShrink: 0 }} />
          <span>
            Broadcasting on <strong style={{ color: '#4ade80' }}>{discoveryInfo.ip}:{discoveryInfo.port}</strong>
            {' '}— companion TV apps on the same network will auto-detect this server.
          </span>
          <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}`}</style>
        </div>
      )}

      {devices.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📺</div>
          <p>No TVs connected yet.</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-secondary)' }}>
            Install the TV app — it will auto-discover this server on the same network.
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
                  title={d.status !== 'online' ? 'TV must be online to push content' : 'Push content or project to this TV'}
                  onClick={() => { setPushTarget(d); setPushContentId(''); setPushProjectId(''); setPushStatus(''); setPushMode('content') }}
                >
                  Push Content
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setRenameTarget(d); setRenameName(d.name) }}>
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
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Push to {pushTarget.name}</h2>
              <button className="btn-icon" onClick={() => setPushTarget(null)}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Immediately display content on this TV, overriding the current playlist.
            </p>

            {/* Mode tabs */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
              {(['content', 'project'] as PushMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setPushMode(m)}
                  style={{
                    padding: '8px 18px', fontSize: 13,
                    fontWeight: pushMode === m ? 600 : 400,
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: pushMode === m ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderBottom: pushMode === m ? '2px solid #3b82f6' : '2px solid transparent',
                    marginBottom: -1,
                  }}
                >
                  {m === 'content' ? 'Single Item' : 'Project'}
                </button>
              ))}
            </div>

            {pushMode === 'content' && (
              <div className="form-group">
                <label className="form-label">Select Content</label>
                <select className="form-select" value={pushContentId} onChange={e => setPushContentId(e.target.value)}>
                  <option value="">— choose —</option>
                  {content.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                  ))}
                </select>
              </div>
            )}

            {pushMode === 'project' && (
              <div className="form-group">
                <label className="form-label">Select Project</label>
                <select className="form-select" value={pushProjectId} onChange={e => setPushProjectId(e.target.value)}>
                  <option value="">— choose —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.items?.length ?? 0} items)
                    </option>
                  ))}
                </select>
                {pushProjectId && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                    All items in the project will play in sequence on the TV until the next playlist update.
                  </div>
                )}
              </div>
            )}

            {pushStatus && (
              <div style={{ color: pushStatus.includes('success') || pushStatus.includes('pushed') ? 'var(--success)' : 'var(--danger)', fontSize: 13 }}>
                {pushStatus}
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setPushTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePush} disabled={!canPush}>
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
