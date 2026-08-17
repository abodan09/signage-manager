import { useEffect, useMemo, useState } from 'react'
import type { Device, DeviceGroup, ContentItem, Project, PendingPairRequest, Template } from '../types'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

type PushMode = 'content' | 'project'
/** A push is aimed either at one TV or at a whole group. */
type PushTarget =
  | { kind: 'device'; device: Device }
  | { kind: 'group'; group: DeviceGroup }

const GROUP_COLORS = ['#3b82f6', '#f97316', '#10b981', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#ef4444']

export default function DevicesPage() {
  const serverUrl = useServerUrl()
  const [devices, setDevices]   = useState<Device[]>([])
  const [groups, setGroups]     = useState<DeviceGroup[]>([])
  const [content, setContent]   = useState<ContentItem[]>([])
  const [projects, setProjects] = useState<(Project & { items?: ContentItem[] })[]>([])

  const [pushTarget, setPushTarget]       = useState<PushTarget | null>(null)
  const [pushMode, setPushMode]           = useState<PushMode>('content')
  const [pushContentId, setPushContentId] = useState('')
  const [pushProjectId, setPushProjectId] = useState('')
  const [pushStatus, setPushStatus]       = useState('')
  const [pushError, setPushError]         = useState(false)

  const [renameTarget, setRenameTarget] = useState<Device | null>(null)
  const [renameName, setRenameName]     = useState('')

  // Group state
  const [filterGroupId, setFilterGroupId] = useState<string>('all')
  const [groupsTarget, setGroupsTarget]   = useState<Device | null>(null)   // membership editor
  const [draftGroupIds, setDraftGroupIds] = useState<string[]>([])
  const [membershipError, setMembershipError] = useState('')
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false)
  const [editGroup, setEditGroup]         = useState<DeviceGroup | 'new' | null>(null)
  const [groupName, setGroupName]         = useState('')
  const [groupColor, setGroupColor]       = useState(GROUP_COLORS[0])
  const [groupError, setGroupError]       = useState('')

  // Discovery info
  const [discoveryInfo, setDiscoveryInfo] = useState<{ ip: string; port: number } | null>(null)

  // Pairing
  const [pending, setPending]           = useState<PendingPairRequest[]>([])
  const [templates, setTemplates]       = useState<Template[]>([])
  const [pairCode, setPairCode]         = useState('')
  const [pairName, setPairName]         = useState('')
  const [pairGroupIds, setPairGroupIds] = useState<string[]>([])
  const [pairReplaceId, setPairReplaceId] = useState('')
  const [pairError, setPairError]       = useState('')
  const [pairBusy, setPairBusy]         = useState(false)
  const [pairOpen, setPairOpen]         = useState(false)

  const load = () => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/devices`).then(r => r.json()).then(d => setDevices(d.devices ?? []))
    fetch(`${serverUrl}/api/groups`).then(r => r.json()).then(d => setGroups(d.groups ?? [])).catch(() => {})
    fetch(`${serverUrl}/api/pair/pending`).then(r => r.json()).then(d => setPending(d.requests ?? [])).catch(() => {})
    fetch(`${serverUrl}/api/templates`).then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {})
    fetch(`${serverUrl}/api/content`).then(r => r.json()).then(d => setContent(d.items ?? []))
    fetch(`${serverUrl}/api/projects`).then(r => r.json()).then(d => setProjects(d.projects ?? []))
    fetch(`${serverUrl}/api/discovery`).then(r => r.json()).then(d => setDiscoveryInfo(d)).catch(() => {})
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 6000)
    return () => clearInterval(t)
  }, [serverUrl])

  const groupsById = useMemo(() => {
    const m = new Map<string, DeviceGroup>()
    groups.forEach(g => m.set(g.id, g))
    return m
  }, [groups])

  // A filter pointing at a deleted group would show an empty list forever.
  useEffect(() => {
    if (filterGroupId !== 'all' && filterGroupId !== 'ungrouped' && !groupsById.has(filterGroupId)) {
      setFilterGroupId('all')
    }
  }, [groupsById, filterGroupId])

  const visibleDevices = useMemo(() => {
    if (filterGroupId === 'all') return devices
    if (filterGroupId === 'ungrouped') return devices.filter(d => !d.groupIds?.length)
    return devices.filter(d => d.groupIds?.includes(filterGroupId))
  }, [devices, filterGroupId])

  const ungroupedCount = useMemo(() => devices.filter(d => !d.groupIds?.length).length, [devices])

  async function handleDelete(id: string) {
    await fetch(`${serverUrl}/api/devices/${id}`, { method: 'DELETE' })
    load()
  }

  async function handleApprovePair() {
    const code = pairCode.trim()
    if (!code) return
    setPairBusy(true)
    setPairError('')
    try {
      const res = await fetch(`${serverUrl}/api/pair/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          name: pairName.trim() || undefined,
          groupIds: pairGroupIds,
          replaceDeviceId: pairReplaceId || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not add that screen')
      setPairCode(''); setPairName(''); setPairGroupIds([]); setPairReplaceId(''); setPairOpen(false)
      load()
    } catch (e: unknown) {
      setPairError(e instanceof Error ? e.message : 'Could not add that screen')
    } finally {
      setPairBusy(false)
    }
  }

  async function handleRevoke(d: Device) {
    await fetch(`${serverUrl}/api/devices/${d.id}/revoke`, { method: 'POST' })
    load()
  }

  async function assignTemplate(scope: 'device' | 'group', id: string, templateId: string) {
    await fetch(`${serverUrl}/api/templates/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, id, templateId: templateId || null }),
    })
    load()
  }

  async function handlePush() {
    if (!pushTarget) return
    setPushStatus('Sending…')
    setPushError(false)
    try {
      const base = pushTarget.kind === 'device'
        ? `${serverUrl}/api/devices/${pushTarget.device.id}`
        : `${serverUrl}/api/groups/${pushTarget.group.id}`

      let url: string
      let body: object
      if (pushMode === 'content') {
        if (!pushContentId) return
        url  = `${base}/push`
        body = { contentId: pushContentId }
      } else {
        if (!pushProjectId) return
        url  = `${base}/push-project`
        body = { projectId: pushProjectId }
      }

      const res  = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')

      let msg: string
      if (pushTarget.kind === 'group') {
        const screens = `${data.sent} screen${data.sent === 1 ? '' : 's'}`
        msg = pushMode === 'project'
          ? `Project pushed to ${screens} (${data.count} items)`
          : `Sent to ${screens}`
        if (data.offline > 0) msg += ` · ${data.offline} offline, skipped`
      } else {
        msg = pushMode === 'project' ? `Project pushed (${data.count} items)` : 'Sent successfully!'
      }
      setPushStatus(msg)
      setTimeout(() => {
        setPushTarget(null); setPushStatus(''); setPushContentId(''); setPushProjectId('')
      }, 2200)
    } catch (e: unknown) {
      setPushError(true)
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

  async function handleSaveMembership() {
    if (!groupsTarget) return
    setMembershipError('')
    try {
      const res = await fetch(`${serverUrl}/api/devices/${groupsTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupIds: draftGroupIds }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not save group membership')
      }
      setGroupsTarget(null)
      load()
    } catch (e: unknown) {
      // Keep the dialog open with the draft intact so the choice isn't lost.
      setMembershipError(e instanceof Error ? e.message : 'Could not save group membership')
    }
  }

  async function handleSaveGroup() {
    const name = groupName.trim()
    if (!name) return
    setGroupError('')
    const isNew = editGroup === 'new'
    const res = await fetch(
      isNew ? `${serverUrl}/api/groups` : `${serverUrl}/api/groups/${(editGroup as DeviceGroup).id}`,
      {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: groupColor }),
      }
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setGroupError(data.error || 'Could not save the group'); return }
    setEditGroup(null)
    load()
  }

  async function handleDeleteGroup(g: DeviceGroup) {
    await fetch(`${serverUrl}/api/groups/${g.id}`, { method: 'DELETE' })
    setEditGroup(null)
    if (filterGroupId === g.id) setFilterGroupId('all')
    load()
  }

  function openGroupsEditor(d: Device) {
    setGroupsTarget(d)
    setDraftGroupIds(d.groupIds ?? [])
    setMembershipError('')
  }

  function openPush(target: PushTarget) {
    setPushTarget(target)
    setPushContentId(''); setPushProjectId(''); setPushStatus(''); setPushError(false); setPushMode('content')
  }

  const canPush = pushMode === 'content' ? !!pushContentId : !!pushProjectId
  const filterLabel =
    filterGroupId === 'all' ? null
    : filterGroupId === 'ungrouped' ? 'Ungrouped'
    : groupsById.get(filterGroupId)?.name ?? null

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
          borderRadius: 10, padding: '10px 18px', marginBottom: 20, fontSize: 13,
        }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite', flexShrink: 0 }} />
          <span>
            Broadcasting on <strong style={{ color: '#4ade80' }}>{discoveryInfo.ip}:{discoveryInfo.port}</strong>
            {' '}— companion TV apps on the same network will auto-detect this server.
          </span>
          <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}`}</style>
        </div>
      )}

      {/* ── Screens waiting to be added ────────────────────────────────────── */}
      {(pending.length > 0 || pairOpen) && (
        <div className="card" style={{ marginBottom: 20, borderColor: '#3b82f6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>Add a screen</h2>
            {pending.length > 0 && (
              <span className="badge badge-green">{pending.length} waiting</span>
            )}
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setPairOpen(false)}>
              Hide
            </button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
            A new screen shows an 8-letter code. Type it here to add it to this server.
          </p>

          {pending.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {pending.map(p => (
                <button
                  key={p.userCode}
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setPairCode(p.userCode); setPairName(p.suggestedName ?? '') }}
                  title={`${p.platform} · ${p.ip}`}
                  style={{ fontFamily: 'monospace', letterSpacing: 1 }}
                >
                  {p.userCode}
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Code shown on the screen</label>
              <input
                className="form-input"
                value={pairCode}
                placeholder="BCDF-GHJK"
                onChange={e => { setPairCode(e.target.value); setPairError('') }}
                onKeyDown={e => { if (e.key === 'Enter' && pairCode.trim()) handleApprovePair() }}
                style={{ fontFamily: 'monospace', letterSpacing: 2, textTransform: 'uppercase' }}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Name this screen</label>
              <input
                className="form-input"
                value={pairName}
                placeholder="Lobby TV"
                onChange={e => setPairName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && pairCode.trim()) handleApprovePair() }}
              />
            </div>
          </div>

          {groups.length > 0 && (
            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label">Add to groups (optional)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {groups.map(g => {
                  const on = pairGroupIds.includes(g.id)
                  return (
                    <button
                      key={g.id}
                      className="btn btn-sm"
                      onClick={() => setPairGroupIds(ids => on ? ids.filter(x => x !== g.id) : [...ids, g.id])}
                      style={{
                        border: `1px solid ${on ? g.color : 'var(--border)'}`,
                        background: on ? `${g.color}1f` : 'transparent',
                        color: 'var(--text-primary)', borderRadius: 8,
                      }}
                    >
                      {g.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {devices.length > 0 && (
            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label">Replacing a screen? (optional)</label>
              <select className="form-select" value={pairReplaceId} onChange={e => setPairReplaceId(e.target.value)}>
                <option value="">— add as a new screen —</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>Take over “{d.name}” (keeps its name and groups)</option>
                ))}
              </select>
            </div>
          )}

          {pairError && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{pairError}</div>}

          <div style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={handleApprovePair} disabled={!pairCode.trim() || pairBusy}>
              {pairBusy ? 'Adding…' : 'Add screen'}
            </button>
          </div>
        </div>
      )}

      {/* ── Groups bar ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>
            Groups
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            — organise screens by location or purpose, then push to all of them at once
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {!pairOpen && pending.length === 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setPairOpen(true)}>+ Add a screen</button>
          )}
          <FilterChip
            label={`All screens (${devices.length})`}
            active={filterGroupId === 'all'}
            onClick={() => setFilterGroupId('all')}
          />
          {groups.map(g => (
            <div key={g.id} style={{ display: 'inline-flex', alignItems: 'stretch' }}>
              <FilterChip
                label={g.name}
                color={g.color}
                count={`${g.onlineCount ?? 0}/${g.deviceCount ?? 0}`}
                active={filterGroupId === g.id}
                onClick={() => setFilterGroupId(g.id)}
                attached
              />
              <button
                className="btn btn-ghost btn-sm"
                title={`Push content to every online TV in ${g.name}`}
                disabled={!g.onlineCount}
                onClick={() => openPush({ kind: 'group', group: g })}
                style={{ borderRadius: '0', borderLeft: 'none', padding: '0 10px' }}
              >
                Push
              </button>
              <button
                className="btn btn-ghost btn-sm"
                title={`Edit ${g.name}`}
                onClick={() => { setEditGroup(g); setGroupName(g.name); setGroupColor(g.color); setGroupError(''); setConfirmDeleteGroup(false) }}
                style={{ borderRadius: '0 8px 8px 0', borderLeft: 'none', padding: '0 10px' }}
              >
                ⚙
              </button>
            </div>
          ))}
          {ungroupedCount > 0 && (
            <FilterChip
              label={`Ungrouped (${ungroupedCount})`}
              active={filterGroupId === 'ungrouped'}
              onClick={() => setFilterGroupId('ungrouped')}
              muted
            />
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setEditGroup('new'); setGroupName(''); setGroupColor(GROUP_COLORS[groups.length % GROUP_COLORS.length]); setGroupError(''); setConfirmDeleteGroup(false) }}
          >
            + New group
          </button>
        </div>
      </div>

      {devices.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📺</div>
          <p>No TVs connected yet.</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-secondary)' }}>
            Install the TV app — it will auto-discover this server on the same network.
          </p>
        </div>
      ) : visibleDevices.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🗂️</div>
          <p>No screens in {filterLabel}.</p>
          <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-secondary)' }}>
            Use <b>Groups</b> on a device below to add it here.
          </p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setFilterGroupId('all')}>
            Show all screens
          </button>
        </div>
      ) : (
        <div className="device-list">
          {visibleDevices.map(d => {
            const memberships = (d.groupIds ?? []).map(id => groupsById.get(id)).filter(Boolean) as DeviceGroup[]
            return (
              <div key={d.id} className="device-row">
                <span className="device-icon">📺</span>
                <div className="device-info">
                  <div className="device-name" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`dot ${d.status === 'online' ? 'dot-green' : 'dot-gray'}`} />
                    {d.name}
                    <span className={`badge ${d.status === 'online' ? 'badge-green' : 'badge-gray'}`} style={{ marginLeft: 4 }}>
                      {d.status}
                    </span>
                    {d.pairingState === 'paired' && (
                      <span className="badge badge-green" title="This screen was added with a pairing code">🔒 Paired</span>
                    )}
                    {d.pairingState === 'unpaired' && (
                      <span className="badge badge-gray" title="This screen registered itself without a code">Unpaired</span>
                    )}
                    {d.pairingState === 'legacy' && (
                      <span className="badge badge-gray" title="Connected before pairing existed — still trusted">Pre-pairing</span>
                    )}
                    {memberships.map(g => (
                      <span
                        key={g.id}
                        title={`In group ${g.name}`}
                        style={{
                          fontSize: 11, fontWeight: 500, padding: '2px 9px', borderRadius: 20,
                          color: g.color, background: `${g.color}1f`, border: `1px solid ${g.color}59`,
                        }}
                      >
                        {g.name}
                      </span>
                    ))}
                  </div>
                  <div className="device-sub">
                    ID: {d.id.slice(0, 12)}…
                    {d.ipAddress ? ` · ${d.ipAddress}` : ''}
                    {d.lastSeen ? ` · Last seen ${relTime(d.lastSeen)}` : ''}
                  </div>
                  {templates.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Template</span>
                      <select
                        className="form-select"
                        value={d.templateId ?? ''}
                        onChange={e => assignTemplate('device', d.id, e.target.value)}
                        style={{ fontSize: 12, padding: '3px 8px', width: 'auto', minWidth: 160 }}
                      >
                        <option value="">Inherit (group or default)</option>
                        {templates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}{t.builtin ? ' (built-in)' : ''}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="device-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={d.status !== 'online'}
                    title={d.status !== 'online' ? 'TV must be online to push content' : 'Push content or project to this TV'}
                    onClick={() => openPush({ kind: 'device', device: d })}
                  >
                    Push Content
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openGroupsEditor(d)}>
                    Groups{memberships.length ? ` (${memberships.length})` : ''}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setRenameTarget(d); setRenameName(d.name) }}>
                    Rename
                  </button>
                  {d.pairingState === 'paired' && (
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Un-pair this screen. It keeps its name and groups and will show a new code."
                      onClick={() => handleRevoke(d)}
                    >
                      Un-pair
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(d.id)}>Remove</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Push modal */}
      {pushTarget && (
        <div className="modal-backdrop" onClick={() => setPushTarget(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {pushTarget.kind === 'device'
                  ? `Push to ${pushTarget.device.name}`
                  : `Push to ${pushTarget.group.name}`}
              </h2>
              <button className="btn-icon" onClick={() => setPushTarget(null)}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              {pushTarget.kind === 'device'
                ? 'Immediately display content on this TV, overriding the current playlist.'
                : `Immediately display content on every online TV in this group (${pushTarget.group.onlineCount ?? 0} of ${pushTarget.group.deviceCount ?? 0} online). Offline screens are skipped.`}
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
              <div style={{ color: pushError ? 'var(--danger)' : 'var(--success)', fontSize: 13 }}>
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

      {/* Group membership editor */}
      {groupsTarget && (
        <div className="modal-backdrop" onClick={() => setGroupsTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Groups for {groupsTarget.name}</h2>
              <button className="btn-icon" onClick={() => setGroupsTarget(null)}>✕</button>
            </div>

            {groups.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                You haven&apos;t created any groups yet. Close this and choose <b>+ New group</b> to make one.
              </p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
                  A screen can belong to several groups at once.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
                  {groups.map(g => {
                    const checked = draftGroupIds.includes(g.id)
                    return (
                      <label
                        key={g.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                          padding: '9px 12px', borderRadius: 8,
                          border: `1px solid ${checked ? g.color + '80' : 'var(--border)'}`,
                          background: checked ? `${g.color}14` : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setDraftGroupIds(ids =>
                            checked ? ids.filter(x => x !== g.id) : [...ids, g.id]
                          )}
                          style={{ width: 15, height: 15, accentColor: g.color, cursor: 'pointer' }}
                        />
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: g.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 14 }}>{g.name}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
                          {g.deviceCount ?? 0} screen{(g.deviceCount ?? 0) === 1 ? '' : 's'}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </>
            )}

            {membershipError && (
              <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{membershipError}</div>
            )}

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setGroupsTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveMembership} disabled={groups.length === 0}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Create / edit group */}
      {editGroup && (
        <div className="modal-backdrop" onClick={() => setEditGroup(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editGroup === 'new' ? 'New Group' : 'Edit Group'}</h2>
              <button className="btn-icon" onClick={() => setEditGroup(null)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">Group Name</label>
              <input
                className="form-input"
                value={groupName}
                placeholder="Lobby, Cafeteria, Menu Boards…"
                onChange={e => { setGroupName(e.target.value); setGroupError('') }}
                onKeyDown={e => { if (e.key === 'Enter' && groupName.trim()) handleSaveGroup() }}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Colour</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {GROUP_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setGroupColor(c)}
                    aria-label={`Use colour ${c}`}
                    style={{
                      width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer',
                      border: groupColor === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                      outline: groupColor === c ? `2px solid ${c}` : 'none', outlineOffset: 1,
                    }}
                  />
                ))}
              </div>
            </div>

            {groupError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{groupError}</div>}

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div>
                {editGroup !== 'new' && (
                  confirmDeleteGroup ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Delete?</span>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDeleteGroup(editGroup)}>Yes, delete</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteGroup(false)}>No</button>
                    </div>
                  ) : (
                    <button className="btn btn-danger btn-sm" onClick={() => setConfirmDeleteGroup(true)}>
                      Delete group
                    </button>
                  )
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" onClick={() => setEditGroup(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSaveGroup} disabled={!groupName.trim()}>Save</button>
              </div>
            </div>
            {editGroup !== 'new' && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10 }}>
                Deleting a group only removes the grouping — the screens themselves stay connected.
              </p>
            )}
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
              <input
                className="form-input"
                value={renameName}
                onChange={e => setRenameName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && renameName.trim()) handleRename() }}
                autoFocus
              />
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

function FilterChip({
  label, count, color, active, muted, attached, onClick,
}: {
  label: string
  count?: string
  color?: string
  active: boolean
  muted?: boolean
  attached?: boolean
  onClick: () => void
}) {
  const accent = color ?? 'var(--accent, #3b82f6)'
  return (
    <button
      onClick={onClick}
      className="btn btn-sm"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        borderRadius: attached ? '8px 0 0 8px' : 8,
        border: `1px solid ${active ? accent : 'var(--border)'}`,
        background: active ? `${color ? color + '1f' : 'rgba(59,130,246,0.12)'}` : 'transparent',
        color: active ? 'var(--text-primary)' : muted ? 'var(--text-secondary)' : 'var(--text-primary)',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {color && <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />}
      {label}
      {count && (
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
          {count}
        </span>
      )}
    </button>
  )
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
