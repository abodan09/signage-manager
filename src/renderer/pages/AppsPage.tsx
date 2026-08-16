import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppDefinitionInfo, AppInstanceInfo } from '../types'
import { AppConfigForm, defaultsFor } from '../components/AppConfigForm'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

const CATEGORY_LABEL: Record<string, string> = {
  social: 'Social', media: 'Media', information: 'Information',
  productivity: 'Productivity', utility: 'Utility',
}

function relTime(iso?: string) {
  if (!iso) return 'never'
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export default function AppsPage() {
  const serverUrl = useServerUrl()

  const [defs, setDefs] = useState<AppDefinitionInfo[]>([])
  const [instances, setInstances] = useState<AppInstanceInfo[]>([])
  const [picker, setPicker] = useState(false)
  const [editing, setEditing] = useState<{ def: AppDefinitionInfo; instance?: AppInstanceInfo } | null>(null)
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AppInstanceInfo | null>(null)
  const [busyId, setBusyId] = useState('')
  const [status, setStatus] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!serverUrl) return
    try {
      const [a, i] = await Promise.all([
        fetch(`${serverUrl}/api/apps`).then(r => r.json()),
        fetch(`${serverUrl}/api/apps/instances`).then(r => r.json()),
      ])
      setDefs(a.apps ?? [])
      setInstances(i.instances ?? [])
      setError('')
    } catch {
      setError('Could not reach the signage server.')
    } finally {
      setLoaded(true)
    }
  }, [serverUrl])

  useEffect(() => { load() }, [load])
  // App data refreshes in the background; the list shows when each last updated.
  useEffect(() => {
    if (!serverUrl) return
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
  }, [serverUrl, load])

  const byCategory = useMemo(() => {
    const map: Record<string, AppDefinitionInfo[]> = {}
    defs.forEach(d => { (map[d.category] = map[d.category] || []).push(d) })
    return map
  }, [defs])

  function startCreate(def: AppDefinitionInfo) {
    setPicker(false)
    setEditing({ def })
    setName(def.name)
    setConfig(defaultsFor(def.fields))
    setFormError('')
  }

  function startEdit(inst: AppInstanceInfo) {
    const def = defs.find(d => d.id === inst.appId)
    if (!def) { setError('That app is no longer available.'); return }
    setEditing({ def, instance: inst })
    setName(inst.name)
    setConfig({ ...defaultsFor(def.fields), ...inst.config })
    setFormError('')
  }

  async function save() {
    if (!editing) return
    setSaving(true); setFormError('')
    try {
      const isNew = !editing.instance
      const url = isNew
        ? `${serverUrl}/api/apps/instances`
        : `${serverUrl}/api/apps/instances/${editing.instance!.id}`
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew ? { appId: editing.def.id, name, config } : { name, config }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save this app')
      setEditing(null)
      await load()
      // A first fetch can fail for reasons only the operator can fix — a bad
      // feed URL, an account with no posts — so say so instead of silently
      // showing an empty card.
      const saved = data.instance as AppInstanceInfo
      if (saved?.lastError) setError(`${saved.name}: ${saved.lastError}`)
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Could not save this app')
    } finally {
      setSaving(false)
    }
  }

  async function refreshNow(inst: AppInstanceInfo) {
    setBusyId(inst.id); setError('')
    try {
      const res = await fetch(`${serverUrl}/api/apps/instances/${inst.id}/refresh`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not refresh')
      setStatus(`${inst.name} updated`)
      setTimeout(() => setStatus(''), 2500)
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not refresh')
    } finally {
      setBusyId('')
    }
  }

  async function publish(inst: AppInstanceInfo) {
    setBusyId(inst.id)
    try {
      const res = await fetch(`${serverUrl}/api/apps/instances/${inst.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not add this app to your screens')
      setStatus(`${inst.name} is on your screens`)
      setTimeout(() => setStatus(''), 3000)
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not publish')
    } finally {
      setBusyId('')
    }
  }

  async function remove(inst: AppInstanceInfo) {
    try {
      const res = await fetch(`${serverUrl}/api/apps/instances/${inst.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not remove this app')
      }
      setDeleteTarget(null)
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not remove this app')
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Apps</h1>
          <p className="subtitle">
            Live content for your screens — social feeds, dashboards, clocks and more.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setPicker(true)}>+ Add app</button>
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {status && <div style={{ color: 'var(--success)', fontSize: 13, marginBottom: 16 }}>{status}</div>}

      {loaded && instances.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🧩</div>
          <p>No apps set up yet.</p>
          <p style={{ fontSize: 13 }}>Add one to put a live feed, a dashboard or a clock on your screens.</p>
          <button className="btn btn-primary" onClick={() => setPicker(true)}>+ Add app</button>
        </div>
      ) : (
        <div className="content-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {instances.map(inst => (
            <div key={inst.id} className="content-card">
              <div className="content-body">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 26 }}>{inst.appIcon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="content-name" title={inst.name}>{inst.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{inst.appName}</div>
                  </div>
                  {inst.published
                    ? <span className="badge badge-green">On screens</span>
                    : <span className="badge badge-gray">Not on screens</span>}
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Updated {relTime(inst.lastFetchedAt)}
                </div>
                {inst.lastError && (
                  <div style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 6 }}>
                    Last update failed: {inst.lastError}
                  </div>
                )}
                {inst.needsConnection && (
                  <div style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 6 }}>
                    No account connected yet.
                  </div>
                )}

                <div className="content-actions" style={{ flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(inst)}>Settings</button>
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => window.open(`${serverUrl}/tv/app/${inst.id}`, '_blank')}>Preview</button>
                  <button className="btn btn-ghost btn-sm" disabled={busyId === inst.id}
                    onClick={() => refreshNow(inst)}>
                    {busyId === inst.id ? '…' : 'Refresh'}
                  </button>
                  {!inst.published && (
                    <button className="btn btn-primary btn-sm" disabled={busyId === inst.id}
                      onClick={() => publish(inst)}>Push to screens</button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(inst)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Select App ── */}
      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(false)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Select App</h2>
              <button className="btn-icon" onClick={() => setPicker(false)}>✕</button>
            </div>
            <p className="subtitle">Customise your screen with a social wall, a dashboard, or live information.</p>

            {Object.keys(byCategory).map(cat => (
              <div key={cat} style={{ marginBottom: 18 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
                  textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10,
                }}>{CATEGORY_LABEL[cat] ?? cat}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
                  {byCategory[cat].map(def => (
                    <button key={def.id} onClick={() => startCreate(def)}
                      style={{
                        background: 'var(--bg-primary)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', padding: '16px 12px', cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                        color: 'var(--text-primary)', textAlign: 'center',
                      }}>
                      <span style={{ fontSize: 32 }}>{def.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{def.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        {def.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {!defs.length && (
              <div className="empty"><p>No apps are available in this version.</p></div>
            )}
          </div>
        </div>
      )}

      {/* ── Configure ── */}
      {editing && (
        <div className="modal-backdrop" onClick={() => !saving && setEditing(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 24 }}>{editing.def.icon}</span> {editing.def.name}
              </h2>
              <button className="btn-icon" onClick={() => setEditing(null)}>✕</button>
            </div>

            <div className="form-group">
              <label className="form-label">Name <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input className="form-input" value={name} autoFocus
                placeholder="Give this app a name"
                onChange={e => setName(e.target.value)} />
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                For your own reference. It is not shown on screens.
              </div>
            </div>

            <AppConfigForm fields={editing.def.fields} config={config} onChange={setConfig} serverUrl={serverUrl} />

            {formError && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{formError}</div>}

            <div className="modal-footer">
              {editing.instance && (
                <button className="btn btn-ghost" style={{ marginRight: 'auto' }}
                  onClick={() => window.open(`${serverUrl}/tv/app/${editing.instance!.id}`, '_blank')}>
                  Preview
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>Close</button>
              <button className="btn btn-primary" disabled={saving || !name.trim()} onClick={save}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Remove app</h2>
              <button className="btn-icon" onClick={() => setDeleteTarget(null)}>✕</button>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>
              Remove <b>{deleteTarget.name}</b>?
              {deleteTarget.published && ' It is currently on your screens and will be taken off the playlist.'}
            </p>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => remove(deleteTarget)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
