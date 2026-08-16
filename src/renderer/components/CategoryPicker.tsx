import { useCallback, useEffect, useState } from 'react'
import type { PackCategory } from '../types'

type Busy = Record<string, 'installing' | 'removing' | undefined>

/** The category grid behind both the first-run picker and Manage Categories.
 *  Installing downloads the pack; removing only unlists it, because designs
 *  already opened in the Designer belong to the operator from that moment on.
 *  onChange fires after any successful mutation so the host can refresh. */
export function CategoryPicker({
  serverUrl, onChange, compact,
}: {
  serverUrl: string
  onChange?: () => void
  compact?: boolean
}) {
  const [cats, setCats] = useState<PackCategory[]>([])
  const [source, setSource] = useState<string>('')
  const [busy, setBusy] = useState<Busy>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (refresh = false) => {
    if (!serverUrl) return
    try {
      const res = await fetch(`${serverUrl}/api/packs${refresh ? '?refresh=1' : ''}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not load the template catalog')
      setCats(data.categories ?? [])
      setSource(data.source ?? '')
      setError('')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load the template catalog')
    } finally {
      setLoading(false)
    }
  }, [serverUrl])

  useEffect(() => { load() }, [load])

  async function install(cat: PackCategory) {
    setBusy(b => ({ ...b, [cat.category]: 'installing' }))
    setError('')
    try {
      const res = await fetch(`${serverUrl}/api/packs/${cat.category}/install`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Could not install ${cat.name}`)
      window.electronAPI.trackEvent?.('pack_installed_ui', { category: cat.category })
      await load()
      onChange?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `Could not install ${cat.name}`)
    } finally {
      setBusy(b => ({ ...b, [cat.category]: undefined }))
    }
  }

  async function remove(cat: PackCategory) {
    setBusy(b => ({ ...b, [cat.category]: 'removing' }))
    setError('')
    try {
      const res = await fetch(`${serverUrl}/api/packs/${cat.category}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Could not remove ${cat.name}`)
      await load()
      onChange?.()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `Could not remove ${cat.name}`)
    } finally {
      setBusy(b => ({ ...b, [cat.category]: undefined }))
    }
  }

  if (loading) return <div className="empty"><p>Loading template categories…</p></div>

  return (
    <div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {source === 'bundled' && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Offline — showing the categories bundled with this version.{' '}
          <a onClick={() => load(true)} style={{ color: '#60a5fa', cursor: 'pointer', textDecoration: 'underline' }}>Check again</a>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 210 : 250}px, 1fr))`,
        gap: 12,
      }}>
        {cats.map(cat => {
          const state = busy[cat.category]
          return (
            <div key={cat.category} className="card" style={{
              padding: 16,
              borderColor: cat.installed ? 'var(--accent)' : 'var(--border)',
              background: cat.installed ? 'rgba(59,130,246,.08)' : 'var(--bg-secondary)',
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 26 }}>{cat.icon}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{cat.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {cat.templateCount} templates
                    {cat.installed && cat.updateAvailable && ' · update available'}
                  </div>
                </div>
                {cat.installed && <span className="badge badge-blue">Installed</span>}
              </div>

              {!compact && (
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: 12, flex: 1 }}>
                  {cat.description}
                </p>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: compact ? 6 : 0 }}>
                {cat.installed ? (
                  <>
                    {cat.updateAvailable && (
                      <button className="btn btn-primary btn-sm" disabled={!!state} onClick={() => install(cat)}>
                        {state === 'installing' ? 'Updating…' : 'Update'}
                      </button>
                    )}
                    <button className="btn btn-ghost btn-sm" disabled={!!state} onClick={() => remove(cat)}>
                      {state === 'removing' ? 'Removing…' : 'Remove'}
                    </button>
                  </>
                ) : (
                  <button className="btn btn-primary btn-sm" disabled={!!state} onClick={() => install(cat)}>
                    {state === 'installing' ? 'Installing…' : cat.availableOffline ? 'Install' : 'Download'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!cats.length && !error && (
        <div className="empty">
          <div className="empty-icon">📦</div>
          <p>No template categories are available right now.</p>
          <button className="btn btn-ghost btn-sm" onClick={() => load(true)}>Try again</button>
        </div>
      )}
    </div>
  )
}

/** First-run wizard: the same grid wrapped in a dialog that can be skipped. */
export function TemplateSetupWizard({ serverUrl, onClose }: { serverUrl: string; onClose: () => void }) {
  const [installedAny, setInstalledAny] = useState(false)

  async function dismiss() {
    try {
      await fetch(`${serverUrl}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templatesOnboarded: true }),
      })
    } catch { /* the picker reappearing once is better than blocking the app */ }
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: 'var(--bg-primary, #0f172a)', border: '1px solid var(--border)', borderRadius: 14,
        width: '100%', maxWidth: 940, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '24px 28px 16px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ marginBottom: 6 }}>Choose your template categories</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Pick the industries you design for. Only the categories you choose are downloaded —
            you can add or swap them at any time from Templates.
          </p>
        </div>

        <div style={{ padding: '20px 28px', overflowY: 'auto', flex: 1 }}>
          <CategoryPicker serverUrl={serverUrl} onChange={() => setInstalledAny(true)} />
        </div>

        <div style={{
          padding: '16px 28px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: 10,
        }}>
          <button className="btn btn-ghost" onClick={dismiss}>{installedAny ? 'Close' : 'Skip for now'}</button>
          <button className="btn btn-primary" onClick={dismiss} disabled={!installedAny}>Done</button>
        </div>
      </div>
    </div>
  )
}
