import { useEffect, useState } from 'react'
import type { ContentItem, Device, DeviceGroup, AppInstanceInfo, Project } from '../types'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

interface Override {
  id: string
  kind: 'emergency' | 'flash'
  name: string
  text?: string
  textColor?: string
  backgroundColor?: string
  targetKind: 'all' | 'groups' | 'devices'
  targetIds: string[]
  running: boolean
  deviceCount: number
  seconds: number
  secondsRemaining: number
  startedAt?: string
}

export default function Dashboard() {
  const serverUrl = useServerUrl()
  const [content, setContent]   = useState<ContentItem[]>([])
  const [devices, setDevices]   = useState<Device[]>([])
  const [groups, setGroups]     = useState<DeviceGroup[]>([])
  const [apps, setApps]         = useState<AppInstanceInfo[]>([])
  const [overrides, setOver]    = useState<Override[]>([])
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    if (!serverUrl) return
    const j = (p: string) => fetch(`${serverUrl}${p}`).then(r => r.json()).catch(() => null)
    const load = () => {
      j('/api/content').then(d => d && setContent(d.items ?? []))
      j('/api/devices').then(d => d && setDevices(d.devices ?? []))
      j('/api/groups').then(d => d && setGroups(d.groups ?? []))
      j('/api/apps/instances').then(d => d && setApps(d.instances ?? []))
      j('/api/overrides').then(d => d && setOver(d.overrides ?? []))
      j('/api/projects').then(d => d && setProjects(d.projects ?? []))
    }
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [serverUrl])

  const online    = devices.filter(d => d.status === 'online').length
  const offline   = devices.length - online
  const active    = content.filter(c => c.isActive).length
  const loop      = content.filter(c => c.scheduleMode === 'loop').length
  const sched     = content.filter(c => c.scheduleMode === 'scheduled').length
  const manual    = content.filter(c => c.scheduleMode === 'manual').length
  const running   = overrides.filter(o => o.running)
  const lead      = running[0]
  const ungrouped = devices.filter(d => !d.groupIds || d.groupIds.length === 0).length
  const tvPlayer  = `${serverUrl}/tv/player`

  // Which screens a running override has taken over.
  const overridden = new Set<string>()
  for (const o of running) {
    if (o.targetKind === 'all') devices.forEach(d => overridden.add(d.id))
    else if (o.targetKind === 'devices') o.targetIds.forEach(id => overridden.add(id))
    else o.targetIds.forEach(gid => devices.filter(d => (d.groupIds ?? []).includes(gid)).forEach(d => overridden.add(d.id)))
  }
  const leadTargets = devices.filter(d => overridden.has(d.id))

  const standDown = (id: string) =>
    fetch(`${serverUrl}/api/overrides/${id}/stand-down`, { method: 'POST' })
      .then(() => setOver(l => l.map(o => (o.id === id ? { ...o, running: false } : o)))).catch(() => {})

  return (
    <div>
      <div className="md-head">
        <div>
          <div className="m-eyebrow">
            Mission control <span className="sl">//</span> {online} of {devices.length} reporting
          </div>
          <h1>Dashboard</h1>
          <p className="md-lede">
            What your screens are connected to right now — fleet, content and anything taking them over.
          </p>
        </div>
        <div className="md-pills">
          <span className="md-pill"><span className="dot dot-green" />{online} online</span>
          <span className="md-pill">
            <span className="dot" style={{ background: 'var(--danger)' }} />{offline} offline
          </span>
          {overridden.size > 0 && (
            <span className="md-pill">
              <span className="md-sq" style={{ background: 'var(--danger)' }} />{overridden.size} overridden
            </span>
          )}
        </div>
      </div>

      {lead && (
        <div className="md-ovr">
          <div className="md-scene" style={{ background: lead.backgroundColor || '#12161F' }}>
            <div className="md-scene-bars" style={{ top: 0 }} />
            <div className="md-scene-bars" style={{ bottom: 0 }} />
            <div className="md-scene-in">
              <div className="md-scene-t" style={{ color: lead.textColor || '#FF4D4D' }}>
                {lead.kind === 'emergency' ? 'EMERGENCY' : 'NOTICE'}
              </div>
              <div className="md-scene-s" style={{ color: lead.textColor || '#FFF' }}>
                {(lead.text ?? lead.name).slice(0, 64)}
              </div>
            </div>
          </div>

          <div className="md-ovr-body">
            <div className="m-eyebrow" style={{ color: 'var(--danger-text)' }}>
              {lead.kind === 'emergency' ? 'Emergency' : 'Flash'} <span className="sl">//</span> on screen now
            </div>
            <div className="md-ovr-ttl">{lead.text || lead.name}</div>
            <div className="md-ovr-meta">
              Started {sinceText(lead.startedAt)} · clears itself automatically
            </div>
            <div className="m-chips" style={{ marginTop: 10 }}>
              {leadTargets.slice(0, 6).map(d => (
                <span key={d.id} className="md-tchip">
                  <span className="md-sq" style={{ background: 'var(--danger)' }} />{d.name}
                </span>
              ))}
              {running.length > 1 && (
                <span className="md-tchip">+{running.length - 1} more message{running.length > 2 ? 's' : ''}</span>
              )}
            </div>
          </div>

          <div className="md-ovr-right">
            <div className="md-ovr-clock">{mmss(lead.secondsRemaining)}</div>
            <div className="md-ovr-cap">clears in</div>
            <button className="btn btn-danger" onClick={() => standDown(lead.id)}>Stand down</button>
          </div>
        </div>
      )}

      <div className="md-grid">
        {/* fleet */}
        <div className="card">
          <div className="m-eyebrow">Fleet <span className="sl">//</span> {online} of {devices.length} online</div>
          <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 0 4px' }}>
            <Ring online={online} total={devices.length} />
          </div>
          <div className="md-fleet-list">
            {overridden.size > 0 && (
              <div className="md-fl">
                <span className="md-sq" style={{ background: 'var(--danger)' }} />
                <span><b>{overridden.size} screen{overridden.size === 1 ? '' : 's'}</b> showing the emergency override</span>
              </div>
            )}
            {devices.filter(d => d.status !== 'online').map(d => (
              <div key={d.id} className="md-fl">
                <span className="dot" style={{ background: 'var(--danger)' }} />
                <span><b>{d.name}</b> offline{d.lastSeen ? ` · ${relTime(d.lastSeen)}` : ''}</span>
              </div>
            ))}
            {offline === 0 && overridden.size === 0 && (
              <div className="md-fl">
                <span className="dot dot-green" /><span>Every screen is reporting in.</span>
              </div>
            )}
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
            <div className="m-eyebrow">Connected TVs <span className="sl">//</span> now</div>
            <div className="m-num">{online} <span className="u">of {devices.length}</span></div>
            <div className="m-sub">{offline} offline · {groups.length} group{groups.length === 1 ? '' : 's'}</div>
          </div>
          <div className="m-kpi-card">
            <div className="m-eyebrow">Schedule <span className="sl">//</span> modes</div>
            <div className="m-num">{loop}<span className="u">L</span> · {sched}<span className="u">S</span> · {manual}<span className="u">M</span></div>
            <div className="m-sub">{loop} Loop · {sched} Scheduled · {manual} Manual</div>
          </div>
        </div>

        {/* endpoint + groups */}
        <div className="m-col-gap">
          <div className="card">
            <div className="m-eyebrow">TV player <span className="sl">//</span> point any screen here</div>
            <div className="md-title">Player endpoint</div>
            <div className="url-box">
              <span>{tvPlayer}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => window.electronAPI.openExternal(tvPlayer)}>
                Open Preview ↗
              </button>
            </div>
            <div className="md-note">
              Opens the live player in your browser — exactly what your TVs render.
            </div>
          </div>

          <div className="card">
            <div className="m-eyebrow">
              Groups <span className="sl">//</span> {groups.length} group{groups.length === 1 ? '' : 's'} · {devices.length} screen{devices.length === 1 ? '' : 's'}
            </div>
            <div className="md-title">Screens by group</div>
            {groups.length === 0 && ungrouped === 0
              ? <div className="m-sub">No screens registered yet.</div>
              : (<>
                  {groups.map(g => (
                    <div key={g.id} className="md-grow">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                        <span className="m-chip-dot" style={{ background: g.color }} />
                        <span className="m-grow">{g.name}</span>
                      </span>
                      <span className="md-right-mono">{g.onlineCount ?? 0}/{g.deviceCount ?? 0} online</span>
                    </div>
                  ))}
                  {ungrouped > 0 && (
                    <div className="md-grow">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span className="m-chip-dot" style={{ background: 'var(--neutral-dot)' }} />
                        <span style={{ color: 'var(--muted)' }}>Ungrouped</span>
                      </span>
                      <span className="md-right-mono">
                        {devices.filter(d => (!d.groupIds || d.groupIds.length === 0) && d.status === 'online').length}/{ungrouped} online
                      </span>
                    </div>
                  )}
                </>)}
          </div>
        </div>
      </div>

      {/* apps on air */}
      {apps.length > 0 && (
        <div className="md-apps">
          {apps.slice(0, 6).map(a => (
            <div key={a.id} className="md-app">
              <div className="md-app-h">
                <AppGlyph />
                <span className="md-app-n">{a.name}</span>
              </div>
              <div className="m-eyebrow" style={{ fontSize: 10 }}>
                {a.appName} <span className="sl">·</span> {a.published ? 'in rotation' : 'not published'}
              </div>
              <div className="md-app-s">
                <span className={`dot ${a.lastError ? '' : 'dot-green'}`} style={a.lastError ? { background: 'var(--warning)' } : undefined} />
                {a.lastError ? 'Last update failed' : a.lastFetchedAt ? `Updated ${relTime(a.lastFetchedAt)}` : 'Runs live on the screen'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* bottom three */}
      <div className="md-bottom">
        <div className="card">
          <div className="m-eyebrow">Library <span className="sl">//</span> recent</div>
          <div className="md-title">Recent content</div>
          {content.length === 0
            ? <div className="m-sub">No content added yet.</div>
            : [...content].slice(-5).reverse().map(c => (
              <div key={c.id} className="md-item">
                <TypeIcon type={c.type} />
                <span className="m-grow">
                  <span className="md-item-n">{c.name}</span>
                  <span className="md-item-m" style={{ display: 'block' }}>
                    {capital(c.type)} · {c.durationSeconds}s · {capital(c.scheduleMode)}
                  </span>
                </span>
                <span className={`badge ${c.isActive ? 'badge-green' : 'badge-gray'}`}>{c.isActive ? 'Active' : 'Off'}</span>
              </div>
            ))}
        </div>

        <div className="card">
          <div className="m-eyebrow">Devices <span className="sl">//</span> status</div>
          <div className="md-title">Fleet overview</div>
          {devices.length === 0
            ? <div className="m-sub">No TVs registered yet.</div>
            : devices.map(d => {
              const ov = overridden.has(d.id)
              return (
                <div key={d.id} className="md-item">
                  {ov
                    ? <span className="md-sq" style={{ background: 'var(--danger)' }} />
                    : <span className={`dot ${d.status === 'online' ? 'dot-green' : 'dot-gray'}`} />}
                  <span className="m-grow md-item-n">{d.name}</span>
                  {ov && <span style={{ fontSize: 11.5, color: 'var(--danger-text)', fontWeight: 620 }}>Override</span>}
                  <span className="md-right-mono">{d.lastSeen ? relTime(d.lastSeen) : 'never'}</span>
                </div>
              )
            })}
        </div>

        <div className="card">
          <div className="m-eyebrow">Emergency <span className="sl">//</span> {overrides.length} prepared</div>
          <div className="md-title">Ready to take over</div>
          {overrides.length === 0
            ? <div className="m-sub">No messages prepared yet.</div>
            : overrides.slice(0, 5).map(o => (
              <div key={o.id} className="md-item">
                <span style={{ color: o.running ? 'var(--danger-text)' : 'var(--muted)', display: 'flex' }}>
                  <BoltIcon emergency={o.kind === 'emergency'} />
                </span>
                <span className="m-grow">
                  <span className="md-item-n">{o.name}</span>
                  <span className="md-item-m" style={{ display: 'block' }}>
                    {o.kind === 'emergency' ? 'Emergency' : 'Flash'} · {o.deviceCount} screen{o.deviceCount === 1 ? '' : 's'}
                  </span>
                </span>
                <span className={`badge ${o.running ? 'badge-red' : 'badge-gray'}`}>{o.running ? 'Live' : 'Ready'}</span>
              </div>
            ))}
        </div>
      </div>

      {projects.length > 0 && (
        <div className="m-sub" style={{ marginTop: 18 }}>
          {projects.length} playlist{projects.length === 1 ? '' : 's'} configured in the Content Library.
        </div>
      )}
    </div>
  )
}

function Ring({ online, total }: { online: number; total: number }) {
  const r = 74
  const c = 2 * Math.PI * r
  const pct = total > 0 ? online / total : 0
  const stroke = total === 0 ? 'var(--hairline-strong)' : online === total ? 'var(--ok)' : 'var(--accent)'
  return (
    <div className="m-ring" style={{ width: 176, height: 176 }}>
      <svg width="176" height="176" viewBox="0 0 176 176">
        <circle cx="88" cy="88" r={r} fill="none" stroke="var(--hairline)" strokeWidth="13" />
        <circle cx="88" cy="88" r={r} fill="none" stroke={stroke} strokeWidth="13" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="m-ring-mid">
        <div className="m-ring-num" style={{ fontSize: 38 }}>
          <span style={{ color: stroke }}>{online}</span>
          <span style={{ color: 'var(--muted)' }}>/{total}</span>
        </div>
        <div className="m-eyebrow" style={{ fontSize: 10, marginTop: 6 }}>screens online</div>
      </div>
    </div>
  )
}

const ICON = {
  width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

function AppGlyph() {
  return <svg {...ICON} style={{ color: 'var(--muted)', flexShrink: 0 }}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
  </svg>
}

function BoltIcon({ emergency }: { emergency: boolean }) {
  return emergency
    ? <svg {...ICON}><path d="M12 4.5 21 19.5H3z" /><path d="M12 10v4" /><circle cx="12" cy="16.8" r=".9" fill="currentColor" stroke="none" /></svg>
    : <svg {...ICON}><path d="M13 3 5 13.5h5.5L11 21l8-10.5h-5.5z" /></svg>
}

function TypeIcon({ type }: { type: string }) {
  const s = { color: 'var(--muted)', flexShrink: 0 }
  if (type === 'image') return <svg {...ICON} style={s}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="m4 17 5-5 4 4 3-2 4 4" /></svg>
  if (type === 'video') return <svg {...ICON} style={s}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></svg>
  if (type === 'html')  return <svg {...ICON} style={s}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" /></svg>
  if (type === 'text')  return <svg {...ICON} style={s}><path d="M4 7V5h16v2M12 5v14M9 19h6" /></svg>
  return <svg {...ICON} style={s}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
}

function capital(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }

function mmss(total: number) {
  const s = Math.max(0, total)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}`
}

function sinceText(iso?: string) {
  if (!iso) return 'just now'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'moments ago'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.floor(m / 60)
  return `${h} hour${h === 1 ? '' : 's'} ago`
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}
