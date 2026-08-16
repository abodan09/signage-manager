import { useEffect, useState } from 'react'
import type { PresetId, PresetInfo, Template, Theme } from '../types'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

const FONTS: Array<{ id: Theme['fontStack']; label: string }> = [
  { id: 'sans',        label: 'Sans (Arial)' },
  { id: 'sans-narrow', label: 'Narrow' },
  { id: 'serif',       label: 'Serif (Georgia)' },
  { id: 'mono',        label: 'Monospace' },
]
const SCALES = [0.75, 1, 1.25, 1.5]

/** Hand-drawn wireframes â€” a generated screenshot would need a headless browser
 *  and would go stale; these never do. */
function PresetThumb({ preset }: { preset: PresetId }) {
  const box = (x: number, y: number, w: number, h: number, fill: string, key?: string) =>
    <rect key={key} x={x} y={y} width={w} height={h} fill={fill} rx="2" />
  const shapes: Record<PresetId, JSX.Element[]> = {
    'fullscreen':        [box(2, 2, 116, 62, '#334155', 'a'), box(30, 24, 60, 18, '#64748b', 'b')],
    'fullscreen-ticker': [box(2, 2, 116, 48, '#334155', 'a'), box(2, 54, 116, 10, '#3b82f6', 'b')],
    'lower-third':       [box(2, 2, 116, 62, '#334155', 'a'), box(2, 40, 116, 14, '#64748b', 'b'), box(2, 56, 116, 8, '#3b82f6', 'c')],
    'branded-frame':     [box(2, 2, 116, 62, '#1e3a5f', 'a'), box(8, 14, 104, 40, '#334155', 'b'), box(8, 4, 22, 7, '#3b82f6', 'c'), box(2, 56, 116, 8, '#3b82f6', 'd')],
    'welcome-lobby':     [box(2, 2, 116, 62, '#334155', 'a'), box(6, 6, 24, 8, '#3b82f6', 'b'), box(24, 26, 72, 16, '#64748b', 'c')],
    'portrait-poster':   [box(38, 2, 44, 40, '#334155', 'a'), box(38, 44, 44, 20, '#64748b', 'b')],
  }
  return (
    <svg viewBox="0 0 120 66" width="100%" height="72" style={{ display: 'block', background: '#0f172a', borderRadius: 6 }}>
      {shapes[preset]}
    </svg>
  )
}

export default function LayoutsPage() {
  const serverUrl = useServerUrl()
  const [templates, setTemplates] = useState<Template[]>([])
  const [presets, setPresets]     = useState<PresetInfo[]>([])
  const [defaultId, setDefaultId] = useState('')
  const [selected, setSelected]   = useState<Template | null>(null)
  const [draft, setDraft]         = useState<Template | null>(null)
  const [error, setError]         = useState('')
  const [saved, setSaved]         = useState('')
  const [newName, setNewName]     = useState('')
  const [previewNonce, setPreviewNonce] = useState(0)

  const load = () => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/templates`).then(r => r.json()).then(d => {
      setTemplates(d.templates ?? [])
      setPresets(d.presets ?? [])
      setDefaultId(d.defaultTemplateId ?? '')
      setSelected(prev => prev ? (d.templates ?? []).find((t: Template) => t.id === prev.id) ?? null : null)
    }).catch(() => {})
  }
  useEffect(load, [serverUrl])

  function open(t: Template) {
    setSelected(t)
    setDraft(JSON.parse(JSON.stringify(t)))
    setError(''); setSaved('')
    setPreviewNonce(n => n + 1)
  }

  function patchTheme(patch: Partial<Theme>) {
    if (!draft) return
    setDraft({ ...draft, theme: { ...draft.theme, ...patch } })
  }

  async function save() {
    if (!draft || draft.builtin) return
    setError(''); setSaved('')
    const res = await fetch(`${serverUrl}/api/templates/${draft.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: draft.name, preset: draft.preset, theme: draft.theme }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Could not save'); return }
    setSaved('Saved â€” screens using this layout have been updated.')
    setTimeout(() => setSaved(''), 3500)
    setPreviewNonce(n => n + 1)
    load()
  }

  async function createFrom(preset: PresetId, name: string) {
    const res = await fetch(`${serverUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, preset }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error || 'Could not create'); return }
    setNewName('')
    load()
    open(data)
  }

  async function duplicate(t: Template) {
    const res = await fetch(`${serverUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${t.name} copy`, preset: t.preset, theme: t.theme }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) { load(); open(data) }
  }

  async function remove(t: Template) {
    await fetch(`${serverUrl}/api/templates/${t.id}`, { method: 'DELETE' })
    setSelected(null); setDraft(null)
    load()
  }

  async function makeDefault(t: Template) {
    await fetch(`${serverUrl}/api/templates/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'default', templateId: t.id }),
    })
    load()
  }

  const previewSrc = draft
    ? `${serverUrl}/tv/player?preview=1&template=${encodeURIComponent(draft.id)}&n=${previewNonce}`
    : ''

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Templates</h1>
          <p className="subtitle">Choose how your content is framed on screen â€” layout, colours, logo and clock</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Library */}
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 15 }}>Your templates</h2>
            {templates.filter(t => !t.builtin).length === 0 && (
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 8 }}>
                None yet â€” start from a layout below.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {templates.filter(t => !t.builtin).map(t => (
                <button
                  key={t.id}
                  className="btn btn-ghost btn-sm"
                  onClick={() => open(t)}
                  style={{
                    justifyContent: 'space-between', textAlign: 'left',
                    borderColor: selected?.id === t.id ? '#3b82f6' : 'var(--border)',
                  }}
                >
                  <span>{t.name}</span>
                  {defaultId === t.id && <span className="badge badge-green">default</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 15 }}>Start from a layout</h2>
            <div className="form-group" style={{ marginTop: 10 }}>
              <input
                className="form-input"
                placeholder="Name, e.g. Cafeteria board"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {presets.map(p => (
                <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                  <PresetThumb preset={p.id} />
                  <div style={{ fontWeight: 500, fontSize: 13.5, marginTop: 8 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '3px 0 8px', lineHeight: 1.5 }}>
                    {p.description}
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!newName.trim()}
                    title={!newName.trim() ? 'Give it a name first' : `Create a template from ${p.name}`}
                    onClick={() => createFrom(p.id, newName.trim())}
                  >
                    Use this layout
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Editor + preview */}
        <div>
          {!draft ? (
            <div className="empty">
              <div className="empty-icon">ðŸŽ¨</div>
              <p>Pick a template to edit, or create one from a layout.</p>
              <p style={{ fontSize: 13, marginTop: 4, color: 'var(--text-secondary)' }}>
                Screens keep the classic fullscreen look until you assign a template.
              </p>
            </div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0 }}>{draft.name}</h2>
                  {draft.builtin && <span className="badge badge-gray">built-in</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {draft.builtin ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => duplicate(draft)}>Duplicate to edit</button>
                    ) : (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => makeDefault(draft)} disabled={defaultId === draft.id}>
                          {defaultId === draft.id ? 'Default' : 'Make default'}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => remove(draft)}>Delete</button>
                        <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
                      </>
                    )}
                  </div>
                </div>

                {/* live preview â€” the real player, so it can never drift */}
                <div style={{
                  width: '100%', aspectRatio: draft.preset === 'portrait-poster' ? '9 / 16' : '16 / 9',
                  maxHeight: 380, margin: '0 auto', background: '#000',
                  border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden',
                }}>
                  <iframe
                    key={previewSrc}
                    src={previewSrc}
                    title="Template preview"
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, textAlign: 'center' }}>
                  Live preview using your real content â€” this is the same player the TVs run.
                </div>
              </div>

              {!draft.builtin && (
                <div className="card">
                  <h2 style={{ fontSize: 15, marginBottom: 14 }}>Design</h2>

                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <input className="form-input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Layout</label>
                    <select className="form-select" value={draft.preset} onChange={e => { setDraft({ ...draft, preset: e.target.value as PresetId }) }}>
                      {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
                    {([
                      ['bgColor', 'Background'],
                      ['brandColor', 'Accent'],
                      ['textColor', 'Text'],
                      ['bandColor', 'Text band'],
                    ] as const).map(([key, label]) => (
                      <div className="form-group" key={key} style={{ margin: 0 }}>
                        <label className="form-label">{label}</label>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            type="color"
                            value={draft.theme[key]}
                            onChange={e => patchTheme({ [key]: e.target.value } as Partial<Theme>)}
                            style={{ width: 42, height: 32, padding: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: 'pointer' }}
                          />
                          <code style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{draft.theme[key]}</code>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="form-group" style={{ marginTop: 14 }}>
                    <label className="form-label">Text band opacity â€” {draft.theme.bandOpacity}%</label>
                    <input
                      type="range" min={0} max={100} value={draft.theme.bandOpacity}
                      onChange={e => patchTheme({ bandOpacity: Number(e.target.value) })}
                      style={{ width: '100%', accentColor: '#3b82f6' }}
                    />
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Fades the band behind text â€” the words themselves stay fully readable.
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Font</label>
                      <select className="form-select" value={draft.theme.fontStack} onChange={e => patchTheme({ fontStack: e.target.value as Theme['fontStack'] })}>
                        {FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Text size</label>
                      <select className="form-select" value={draft.theme.fontScale} onChange={e => patchTheme({ fontScale: Number(e.target.value) })}>
                        {SCALES.map(s => <option key={s} value={s}>{s === 1 ? 'Normal' : `${s}Ã—`}</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                    {([
                      ['showClock', 'Show a clock'],
                      ['showClockDate', 'Include the date'],
                      ['tickerEnabled', 'Allow the scrolling ticker bar'],
                    ] as const).map(([key, label]) => (
                      <label key={key} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                        <input
                          type="checkbox"
                          checked={!!draft.theme[key]}
                          onChange={e => patchTheme({ [key]: e.target.checked } as Partial<Theme>)}
                          style={{ width: 15, height: 15, accentColor: '#3b82f6', cursor: 'pointer' }}
                        />
                        {label}
                      </label>
                    ))}
                    {draft.theme.showClock && (
                      <div className="form-group" style={{ margin: '4px 0 0 25px', maxWidth: 200 }}>
                        <select className="form-select" value={draft.theme.clockFormat} onChange={e => patchTheme({ clockFormat: e.target.value as '12h' | '24h' })}>
                          <option value="24h">24-hour</option>
                          <option value="12h">12-hour</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</div>}
                  {saved && <div style={{ color: 'var(--success)', fontSize: 13, marginTop: 12 }}>{saved}</div>}

                  <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" onClick={save}>Save changes</button>
                    <button className="btn btn-ghost" onClick={() => setPreviewNonce(n => n + 1)}>Refresh preview</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

