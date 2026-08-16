import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Design, PackCategory, PackTemplate } from '../types'
import { CategoryPicker } from '../components/CategoryPicker'
import { SceneThumb } from '../scene/SceneView'
import { useSceneFonts } from '../scene/fonts'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

const THUMB_W = 260
const THUMB_H = 150

export default function TemplatesPage() {
  const serverUrl = useServerUrl()
  const navigate = useNavigate()
  useSceneFonts(serverUrl)

  const [tab, setTab] = useState<'templates' | 'designs'>('templates')
  const [cats, setCats] = useState<PackCategory[]>([])
  const [templates, setTemplates] = useState<PackTemplate[]>([])
  const [designs, setDesigns] = useState<Design[]>([])
  const [activeCat, setActiveCat] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [manage, setManage] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Design | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!serverUrl) return
    try {
      const [cRes, tRes, dRes] = await Promise.all([
        fetch(`${serverUrl}/api/packs`),
        fetch(`${serverUrl}/api/packs/templates`),
        fetch(`${serverUrl}/api/designs`),
      ])
      const [c, t, d] = await Promise.all([cRes.json(), tRes.json(), dRes.json()])
      setCats(c.categories ?? [])
      setTemplates(t.templates ?? [])
      setDesigns(d.designs ?? [])
      setError('')
    } catch {
      setError('Could not reach the signage server.')
    } finally {
      setLoaded(true)
    }
  }, [serverUrl])

  useEffect(() => { load() }, [load])

  const installed = useMemo(() => cats.filter(c => c.installed), [cats])
  const catName = useCallback((id: string) => cats.find(c => c.category === id)?.name ?? id, [cats])

  const visibleTemplates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return templates.filter(t => {
      if (activeCat !== 'all' && t.category !== activeCat) return false
      if (!q) return true
      return t.name.toLowerCase().includes(q)
        || (t.description ?? '').toLowerCase().includes(q)
        || (t.tags ?? []).some(tag => tag.toLowerCase().includes(q))
    })
  }, [templates, activeCat, search])

  const visibleDesigns = useMemo(() => {
    const q = search.trim().toLowerCase()
    return designs.filter(d => !q || d.name.toLowerCase().includes(q))
  }, [designs, search])

  async function customise(t: PackTemplate) {
    setBusyKey(`${t.category}/${t.key}`)
    setError('')
    try {
      const res = await fetch(`${serverUrl}/api/designs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromTemplate: { category: t.category, key: t.key } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not open this template')
      navigate(`/designer/${data.design.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not open this template')
      setBusyKey('')
    }
  }

  async function newBlank() {
    setBusyKey('blank')
    try {
      const res = await fetch(`${serverUrl}/api/designs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Untitled design',
          width: 1920, height: 1080,
          background: { color: '#0f172a' },
          elements: [],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not create a design')
      navigate(`/designer/${data.design.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not create a design')
      setBusyKey('')
    }
  }

  async function removeDesign(d: Design) {
    try {
      const res = await fetch(`${serverUrl}/api/designs/${d.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not delete this design')
      }
      setDeleteTarget(null)
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete this design')
    }
  }

  const noneInstalled = loaded && installed.length === 0

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Templates</h1>
          <p className="subtitle">
            Start from a ready-made design, then make it yours in the Designer.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setManage(true)}>Manage categories</button>
          <button className="btn btn-primary" onClick={newBlank} disabled={busyKey === 'blank'}>
            {busyKey === 'blank' ? 'Creating…' : '+ Blank design'}
          </button>
        </div>
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {noneInstalled ? (
        <div className="card">
          <h2>Choose your template categories</h2>
          <p className="subtitle" style={{ marginBottom: 20 }}>
            Templates are grouped by industry and downloaded only when you pick them,
            so your install stays lean. Choose one to get started.
          </p>
          <CategoryPicker serverUrl={serverUrl} onChange={load} />
        </div>
      ) : (
        <>
          <div className="type-tabs" style={{ maxWidth: 360 }}>
            <button className={`type-tab ${tab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>
              Templates ({templates.length})
            </button>
            <button className={`type-tab ${tab === 'designs' ? 'active' : ''}`} onClick={() => setTab('designs')}>
              My designs ({designs.length})
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
            {tab === 'templates' && (
              <div className="days-row" style={{ flex: 1 }}>
                <button className={`day-chip ${activeCat === 'all' ? 'selected' : ''}`} onClick={() => setActiveCat('all')}>
                  All
                </button>
                {installed.map(c => (
                  <button key={c.category}
                    className={`day-chip ${activeCat === c.category ? 'selected' : ''}`}
                    onClick={() => setActiveCat(c.category)}>
                    {c.icon} {c.name}
                  </button>
                ))}
              </div>
            )}
            <input
              className="form-input"
              style={{ maxWidth: 260, marginLeft: 'auto' }}
              placeholder="Search templates…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {tab === 'templates' ? (
            visibleTemplates.length ? (
              <div className="content-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_W}px, 1fr))` }}>
                {visibleTemplates.map(t => {
                  const key = `${t.category}/${t.key}`
                  return (
                    <div key={key} className="content-card">
                      <div className="content-thumb" style={{ height: THUMB_H, padding: 0 }}>
                        <SceneThumb design={t.design} base={serverUrl} width={THUMB_W} height={THUMB_H} />
                      </div>
                      <div className="content-body">
                        <div className="content-name" title={t.name}>{t.name}</div>
                        <div className="content-meta">
                          <span className="badge badge-gray">{catName(t.category)}</span>
                          {t.design.width < t.design.height && <span className="badge badge-blue">Portrait</span>}
                        </div>
                        <div className="content-actions">
                          <button className="btn btn-primary btn-sm" style={{ flex: 1 }}
                            disabled={busyKey === key} onClick={() => customise(t)}>
                            {busyKey === key ? 'Opening…' : 'Edit'}
                          </button>
                          <button className="btn btn-ghost btn-sm"
                            onClick={() => window.open(`${serverUrl}/tv/template/${t.category}/${t.key}`, '_blank')}>
                            Preview
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-icon">🔍</div>
                <p>No templates match that search.</p>
              </div>
            )
          ) : (
            visibleDesigns.length ? (
              <div className="content-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_W}px, 1fr))` }}>
                {visibleDesigns.map(d => (
                  <div key={d.id} className="content-card">
                    <div className="content-thumb" style={{ height: THUMB_H, padding: 0 }}>
                      <SceneThumb design={d} base={serverUrl} width={THUMB_W} height={THUMB_H} />
                    </div>
                    <div className="content-body">
                      <div className="content-name" title={d.name}>{d.name}</div>
                      <div className="content-meta">
                        {d.published
                          ? <span className="badge badge-green">On screens</span>
                          : <span className="badge badge-gray">Draft</span>}
                        {d.category && <span className="badge badge-gray">{catName(d.category)}</span>}
                      </div>
                      <div className="content-actions">
                        <button className="btn btn-primary btn-sm" style={{ flex: 1 }}
                          onClick={() => navigate(`/designer/${d.id}`)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(d)}>Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-icon">🎨</div>
                <p>You have not saved any designs yet.</p>
                <p style={{ fontSize: 13 }}>Open a template and hit Save — it will show up here.</p>
              </div>
            )
          )}
        </>
      )}

      {manage && (
        <div className="modal-backdrop" onClick={() => setManage(false)}>
          <div className="modal" style={{ maxWidth: 900 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Template categories</h2>
              <button className="btn-icon" onClick={() => setManage(false)}>✕</button>
            </div>
            <p className="subtitle">
              Install the industries you need. Removing a category only hides its templates —
              designs you have already saved are never touched.
            </p>
            <CategoryPicker serverUrl={serverUrl} onChange={load} />
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setManage(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Delete design</h2>
              <button className="btn-icon" onClick={() => setDeleteTarget(null)}>✕</button>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>
              Delete <b>{deleteTarget.name}</b>?
              {deleteTarget.published && ' It is currently on your screens and will be removed from the playlist.'}
            </p>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => removeDesign(deleteTarget)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
