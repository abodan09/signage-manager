import { useEffect, useState } from 'react'
import type { ContentItem, Device } from '../types'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

export default function Dashboard() {
  const serverUrl = useServerUrl()
  const [content, setContent] = useState<ContentItem[]>([])
  const [devices, setDevices] = useState<Device[]>([])

  useEffect(() => {
    if (!serverUrl) return
    const load = () => {
      fetch(`${serverUrl}/api/content`).then(r => r.json()).then(d => setContent(d.items ?? []))
      fetch(`${serverUrl}/api/devices`).then(r => r.json()).then(d => setDevices(d.devices ?? []))
    }
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [serverUrl])

  const active   = content.filter(c => c.isActive).length
  const online   = devices.filter(d => d.status === 'online').length
  const tvPlayer = `${serverUrl}/tv/player`

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="subtitle">Overview of your digital signage system</p>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Content</div>
          <div className="stat-value">{content.length}</div>
          <div className="stat-sub">{active} active</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Connected TVs</div>
          <div className="stat-value" style={{ color: online > 0 ? 'var(--success)' : undefined }}>{online}</div>
          <div className="stat-sub">{devices.length} registered</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Schedule Modes</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {content.filter(c => c.scheduleMode === 'loop').length}L &nbsp;
            {content.filter(c => c.scheduleMode === 'scheduled').length}S &nbsp;
            {content.filter(c => c.scheduleMode === 'manual').length}M
          </div>
          <div className="stat-sub">Loop / Scheduled / Manual</div>
        </div>
      </div>

      {/* TV Player URL */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>TV Player URL</div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Point the TV app to this address. The TV must be on the same network as this PC.
        </p>
        <div className="url-box">
          <span>{tvPlayer}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => window.electronAPI.openExternal(tvPlayer)}>
            Open Preview ↗
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Recent content */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Recent Content</div>
          {content.length === 0
            ? <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No content added yet.</div>
            : [...content].slice(-5).reverse().map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(51,65,85,.4)' }}>
                <span>{typeIcon(c.type)}</span>
                <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <span className={`badge ${c.isActive ? 'badge-green' : 'badge-gray'}`}>{c.isActive ? 'Active' : 'Off'}</span>
              </div>
            ))
          }
        </div>

        {/* Devices */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 14 }}>Registered Devices</div>
          {devices.length === 0
            ? <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No TVs registered yet.</div>
            : devices.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(51,65,85,.4)' }}>
                <span className={`dot ${d.status === 'online' ? 'dot-green' : 'dot-gray'}`} />
                <span style={{ flex: 1, fontSize: 13 }}>{d.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{d.lastSeen ? relTime(d.lastSeen) : 'Never'}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

function typeIcon(t: string) {
  return { image: '🖼️', video: '🎬', html: '🌐', text: '✏️' }[t] ?? '📄'
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
