import { useEffect, useState } from 'react'
import type { ContentItem, Device, DeviceGroup, AppInstanceInfo } from '../types'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

interface RunningOverride {
  id: string
  kind: 'emergency' | 'flash'
  name: string
  text?: string
  running: boolean
  deviceCount: number
  secondsRemaining: number
}

export default function Dashboard() {
  const serverUrl = useServerUrl()
  const [content, setContent] = useState<ContentItem[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [groups, setGroups] = useState<DeviceGroup[]>([])
  const [apps, setApps] = useState<AppInstanceInfo[]>([])
  const [live, setLive] = useState<RunningOverride[]>([])

  useEffect(() => {
    if (!serverUrl) return
    const load = () => {
      fetch(`${serverUrl}/api/content`).then(r => r.json()).then(d => setContent(d.items ?? [])).catch(() => {})
      fetch(`${serverUrl}/api/devices`).then(r => r.json()).then(d => setDevices(d.devices ?? [])).catch(() => {})
      fetch(`${serverUrl}/api/groups`).then(r => r.json()).then(d => setGroups(d.groups ?? [])).catch(() => {})
      fetch(`${serverUrl}/api/apps/instances`).then(r => r.json()).then(d => setApps(d.instances ?? [])).catch(() => {})
      fetch(`${serverUrl}/api/overrides`).then(r => r.json())
        .then(d => setLive((d.overrides ?? []).filter((o: RunningOverride) => o.running))).catch(() => {})
    }
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [serverUrl])

  const active   = content.filter(c => c.isActive).length
  const online   = devices.filter(d => d.status === 'online').length
  const loop     = content.filter(c => c.scheduleMode === 'loop').length
  const sched    = content.filter(c => c.scheduleMode === 'scheduled').length
  const manual   = content.filter(c => c.scheduleMode === 'manual').length
  const tvPlayer = `${serverUrl}/tv/player`
  const ungrouped = devices.filter(d => !d.groupIds || d.groupIds.length === 0).length

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="subtitle">Overview of your digital signage system</p>

      {live.map(o => (
        <div key={o.id} className="m-alert">
          <div className="m-alert-body">
            <div className="m-eyebrow" style={{ color: 'var(--danger-text)' }}>
              {o.kind === 'emergency' ? 'EMERGENCY' : 'FLASH'} <span className="sl">//</span> ON AIR NOW
            </div>
            <div className="m-alert-ttl" style={{ marginTop: 6 }}>{o.name}</div>
            {o.text && <div className="m-alert-msg">{o.text}</div>}
            <div className="m-sub">
              Taking over <span className="m-count">{o.deviceCount}</span> screen{o.deviceCount === 1 ? '' : 's'}
              {' · '}<span className="m-count">{mmss(o.secondsRemaining)}</span> left
            </div>
          </div>
          <button
            className="btn btn-danger"
            onClick={() => fetch(`${serverUrl}/api/overrides/${o.id}/stand-down`, { method: 'POST' })
              .then(() => setLive(l => l.filter(x => x.id !== o.id))).catch(() => {})}>
            Stand down
          </button>
        </div>
      ))}

      <div className="m-dash-top">
        {/* fleet ring */}
        <div className="m-ring-card">
          <div className="m-eyebrow" style={{ alignSelf: 'flex-start', marginBottom: 14 }}>
            Fleet <span className="sl">//</span> {online} of {devices.length} online
          </div>
          <Ring online={online} total={devices.length} />
          <div className="m-sub" style={{ textAlign: 'center' }}>
            {devices.length === 0 ? 'No TVs registered yet.' : `${devices.length - online} offline · ${groups.length} group${groups.length === 1 ? '' : 's'}`}
          </div>
        </div>

        {/* KPI stack */}
        <div className="m-kpi">
          <div className="m-kpi-card">
            <div className="m-eyebrow">Content <span className="sl">//</span> library</div>
            <div className="m-num">{content.length}</div>
            <div className="m-sub">{active} active · {content.length - active} off</div>
          </div>
          <div className="m-kpi-card">
            <div className="m-eyebrow">Schedule <span className="sl">//</span> modes</div>
            <div className="m-num">
              {loop}<span className="u">L</span> · {sched}<span className="u">S</span> · {manual}<span className="u">M</span>
            </div>
            <div className="m-sub">Loop / Scheduled / Manual</div>
          </div>
        </div>

        {/* endpoint + groups */}
        <div className="m-col-gap">
          <div className="card">
            <div className="m-eyebrow">TV player <span className="sl">//</span> point any screen here</div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '10px 0 12px' }}>
              Point the TV app to this address. The TV must be on the same network as this PC.
            </p>
            <div className="url-box">
              <span>{tvPlayer}</span>
              <button className="btn btn-primary btn-sm" onClick={() => window.electronAPI.openExternal(tvPlayer)}>
                Open Preview ↗
              </button>
            </div>
          </div>
          <div className="card">
            <div className="m-eyebrow" style={{ marginBottom: 12 }}>Screens <span className="sl">//</span> by group</div>
            {groups.length === 0 && ungrouped === 0
              ? <div className="m-sub">No groups yet.</div>
              : (
                <>
                  {groups.map(g => (
                    <div key={g.id} className="m-row">
                      <span className="m-chip-dot" style={{ background: g.color }} />
                      <span className="m-grow" style={{ fontSize: 13 }}>{g.name}</span>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {g.onlineCount ?? 0}/{g.deviceCount ?? 0}
                      </span>
                    </div>
                  ))}
                  {ungrouped > 0 && (
                    <div className="m-row">
                      <span className="m-chip-dot" style={{ background: 'var(--neutral-dot, #98A0B8)' }} />
                      <span className="m-grow" style={{ fontSize: 13, color: 'var(--muted)' }}>Ungrouped</span>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{ungrouped}</span>
                    </div>
                  )}
                </>
              )}
          </div>
        </div>
      </div>

      {/* apps on air */}
      {apps.length > 0 && (
        <div className="m-sec">
          <div className="m-sec-head">
            <div className="m-eyebrow">Apps <span className="sl">//</span> {apps.length} configured</div>
          </div>
          <div className="m-cat">
            {apps.slice(0, 6).map(a => (
              <div key={a.id} className="m-cat-item" style={{ cursor: 'default' }}>
                <span className={`dot ${a.lastError ? 'dot-gray' : 'dot-green'}`} />
                <span style={{ minWidth: 0 }}>
                  <span className="m-cat-nm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <span className="m-cat-sub">{a.appName}{a.published ? ' · in rotation' : ''}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="m-dash-cols">
        {/* Recent content */}
        <div className="card">
          <div className="m-eyebrow" style={{ marginBottom: 12 }}>Recent Content</div>
          {content.length === 0
            ? <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No content added yet.</div>
            : [...content].slice(-5).reverse().map(c => (
              <div key={c.id} className="m-row">
                <TypeIcon type={c.type} />
                <span className="m-grow" style={{ fontSize: 13 }}>{c.name}</span>
                <span className={`badge ${c.isActive ? 'badge-green' : 'badge-gray'}`}>{c.isActive ? 'Active' : 'Off'}</span>
              </div>
            ))
          }
        </div>

        {/* Devices */}
        <div className="card">
          <div className="m-eyebrow" style={{ marginBottom: 12 }}>Registered Devices</div>
          {devices.length === 0
            ? <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>No TVs registered yet.</div>
            : devices.map(d => (
              <div key={d.id} className="m-row">
                <span className={`dot ${d.status === 'online' ? 'dot-green' : 'dot-gray'}`} />
                <span className="m-grow" style={{ fontSize: 13 }}>{d.name}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {d.lastSeen ? relTime(d.lastSeen) : 'Never'}
                </span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

/* Fleet gauge. A ring is only honest here because both halves are known:
   every registered screen is either online or it is not. */
function Ring({ online, total }: { online: number; total: number }) {
  const r = 72
  const c = 2 * Math.PI * r
  const pct = total > 0 ? online / total : 0
  const stroke = total === 0 ? 'var(--hairline-strong)' : online === total ? 'var(--ok)' : 'var(--accent)'
  return (
    <div className="m-ring">
      <svg width="168" height="168" viewBox="0 0 168 168">
        <circle cx="84" cy="84" r={r} fill="none" stroke="var(--hairline)" strokeWidth="12" />
        <circle
          cx="84" cy="84" r={r} fill="none" stroke={stroke} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="m-ring-mid">
        <div className="m-ring-num">{online}<span style={{ color: 'var(--muted)', fontSize: 20 }}>/{total}</span></div>
        <div className="m-ring-cap">screens online</div>
      </div>
    </div>
  )
}

function TypeIcon({ type }: { type: string }) {
  const common = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const style = { color: 'var(--muted)', flexShrink: 0 }
  if (type === 'image') return <svg {...common} style={style}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="m4 17 5-5 4 4 3-2 4 4" /></svg>
  if (type === 'video') return <svg {...common} style={style}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></svg>
  if (type === 'html')  return <svg {...common} style={style}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" /></svg>
  if (type === 'text')  return <svg {...common} style={style}><path d="M4 7V5h16v2M12 5v14M9 19h6" /></svg>
  return <svg {...common} style={style}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
}

function mmss(total: number) {
  const s = Math.max(0, total)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec < 10 ? '0' : ''}${sec}`
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
