import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AppField } from '../types'

/** Renders any app's settings from its declared fields.
 *
 *  There are two dozen apps and they all get this one form. A new app is a
 *  server file; nothing here changes. It also means the shape the operator
 *  edits and the shape the server validates come from the same declaration,
 *  so the two can never drift apart. */

type Config = Record<string, unknown>

function visible(field: AppField, config: Config): boolean {
  if (!field.showIf) return true
  return field.showIf.equals.some(v => v === config[field.showIf!.key])
}

export function defaultsFor(fields: AppField[]): Config {
  const out: Config = {}
  for (const f of fields) {
    if (f.type === 'note' || f.type === 'connection') continue
    out[f.key] = f.default !== undefined ? f.default : (f.type === 'checkbox' ? false : '')
  }
  return out
}

/** Picture picker: upload a new one, or reuse anything already on this
 *  machine. Apps store an /uploads path, never a remote URL, so a screen that
 *  loses its internet keeps showing the picture. */
function ImagePicker({ serverUrl, value, onChange }: {
  serverUrl: string
  value: string
  onChange: (v: string) => void
}) {
  const [assets, setAssets] = useState<Array<{ path: string; name: string }>>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!serverUrl || !open) return
    fetch(`${serverUrl}/api/designs/assets`)
      .then(r => r.json())
      .then(d => setAssets(d.assets ?? []))
      .catch(() => { /* an empty picker still lets them upload */ })
  }, [serverUrl, open])

  async function upload(file: File) {
    setBusy(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${serverUrl}/api/designs/upload`, { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      onChange(data.path)
      setOpen(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {value
          ? <img src={serverUrl + value} alt="" style={{ width: 64, height: 42, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
          : <div style={{ width: 64, height: 42, borderRadius: 6, border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: 'var(--text-secondary)' }}>🖼️</div>}
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>
          {open ? 'Hide' : 'Choose'}
        </button>
        {value && <button className="btn btn-ghost btn-sm" onClick={() => onChange('')}>Clear</button>}
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{error}</div>}
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(74px, 1fr))', gap: 6, marginTop: 8 }}>
          {assets.map(a => (
            <img key={a.path} src={serverUrl + a.path} alt={a.name} title={a.name}
              onClick={() => { onChange(a.path); setOpen(false) }}
              style={{
                width: '100%', height: 50, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', display: 'block',
                border: value === a.path ? '2px solid var(--accent)' : '1px solid var(--border)',
              }} />
          ))}
          {!assets.length && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', gridColumn: '1 / -1' }}>
              No pictures on this computer yet — upload one.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface Zone {
  name: string
  top: number; left: number; width: number; height: number
  kind: 'app' | 'design' | 'project' | 'empty'
  refId: string
}

const ZONE_PRESETS: Array<{ label: string; zones: Zone[] }> = [
  {
    label: 'Main + bottom strip',
    zones: [
      { name: 'Main', top: 0, left: 0, width: 100, height: 88, kind: 'empty', refId: '' },
      { name: 'Bottom strip', top: 88, left: 0, width: 100, height: 12, kind: 'empty', refId: '' },
    ],
  },
  {
    label: 'Main + sidebar',
    zones: [
      { name: 'Main', top: 0, left: 0, width: 72, height: 100, kind: 'empty', refId: '' },
      { name: 'Sidebar', top: 0, left: 72, width: 28, height: 100, kind: 'empty', refId: '' },
    ],
  },
  {
    label: 'Main, sidebar + strip',
    zones: [
      { name: 'Main', top: 0, left: 0, width: 72, height: 88, kind: 'empty', refId: '' },
      { name: 'Sidebar', top: 0, left: 72, width: 28, height: 88, kind: 'empty', refId: '' },
      { name: 'Bottom strip', top: 88, left: 0, width: 100, height: 12, kind: 'empty', refId: '' },
    ],
  },
  {
    label: 'Quarters',
    zones: [
      { name: 'Top left', top: 0, left: 0, width: 50, height: 50, kind: 'empty', refId: '' },
      { name: 'Top right', top: 0, left: 50, width: 50, height: 50, kind: 'empty', refId: '' },
      { name: 'Bottom left', top: 50, left: 0, width: 50, height: 50, kind: 'empty', refId: '' },
      { name: 'Bottom right', top: 50, left: 50, width: 50, height: 50, kind: 'empty', refId: '' },
    ],
  },
]

const ZONE_TINTS = ['#2e7d9a', '#3aa99a', '#e8e6a8', '#a67cb8', '#d98b5f', '#6b8fb5', '#8fb56b', '#b56b8f']

/** The zone editor: a row per region, and a live plan of the screen. The
 *  percentages are the real mechanism, so they are what the operator edits —
 *  the preview is there to make a mistake obvious, not to be dragged. */
/** The caption above each zone's number boxes. Declared here rather than
 *  borrowed from the Designer's inspector: nothing in this file imports from
 *  there, and a bare `label` identifier was a ReferenceError that only fired
 *  once a zone row rendered — invisible to `npm run build`, which typechecks
 *  src/main and lets Vite strip the renderer's types unchecked. */
const CAPTION: CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--text-secondary)',
  marginBottom: 2, textTransform: 'capitalize',
}

/** A linked account. The first control here that edits nothing — the connection
 *  lives outside config, so this shows status and offers the two buttons.
 *
 *  Sign-in opens a real browser window in the main process and can take minutes
 *  with MFA, so the request returns immediately and this polls for the result
 *  rather than holding a spinner on a hanging fetch. */
function ConnectionField({ serverUrl, field, config }: {
  serverUrl: string
  field: AppField
  config: Config
}) {
  const provider = field.provider ?? ''
  const [account, setAccount] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    if (!serverUrl || !provider) return
    fetch(`${serverUrl}/api/apps/connections`)
      .then(r => r.json())
      .catch(() => ({}))
      .then((d: { connections?: Array<{ provider: string; accountName?: string }> }) => {
        const c = (d.connections ?? []).find(x => x.provider === provider)
        setAccount(c ? (c.accountName || 'Connected') : null)
      })
  }
  useEffect(load, [serverUrl, provider])

  async function signIn() {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${serverUrl}/api/apps/connections/${provider}/signin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: config.url ?? '' }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not start sign-in')
      // The window is open now; the operator drives it. Poll until it lands.
      let tries = 0
      const timer = setInterval(() => {
        tries++
        load()
        if (tries > 60) { clearInterval(timer); setBusy(false) }
      }, 2000)
      setTimeout(() => { clearInterval(timer); setBusy(false); load() }, 125_000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not start sign-in')
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true); setError('')
    try {
      await fetch(`${serverUrl}/api/apps/connections/${provider}`, { method: 'DELETE' })
    } finally {
      setBusy(false); load()
    }
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      padding: 10, background: 'var(--bg-primary)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: account ? 'var(--success, #22c55e)' : 'var(--text-secondary)',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>{account ?? 'Not signed in'}</div>
        {error && <div style={{ color: 'var(--danger)', fontSize: 11 }}>{error}</div>}
      </div>
      {account
        ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={signOut}>Sign out</button>
        : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={signIn}>
            {busy ? 'Waiting for sign-in…' : 'Sign In'}
          </button>}
    </div>
  )
}

/** Picks one of the manager's playlists. The stored value is a project id; the
 *  word shown to the operator is "playlist", which is what they call it
 *  everywhere else in the product. Loaded eagerly rather than on open, or a
 *  saved instance reopens reading "Choose…" over a perfectly good selection. */
function ProjectPicker({ serverUrl, value, onChange }: {
  serverUrl: string
  value: string
  onChange: (v: string) => void
}) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/projects`)
      .then(r => r.json())
      .catch(() => ({}))
      .then((p: { projects?: Array<{ id: string; name: string }> }) =>
        setProjects((p.projects ?? []).map(x => ({ id: x.id, name: x.name }))))
  }, [serverUrl])

  return (
    <select className="form-select" value={value ?? ''} onChange={e => onChange(e.target.value)}>
      <option value="">{projects.length ? 'Choose a playlist…' : 'No playlists yet'}</option>
      {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  )
}

function ZonesEditor({ serverUrl, value, onChange }: {
  serverUrl: string
  value: Zone[]
  onChange: (v: Zone[]) => void
}) {
  const zones = Array.isArray(value) ? value : []
  const [choices, setChoices] = useState<{
    app: Array<{ id: string; name: string }>
    design: Array<{ id: string; name: string }>
    project: Array<{ id: string; name: string }>
  }>({ app: [], design: [], project: [] })

  useEffect(() => {
    if (!serverUrl) return
    Promise.all([
      fetch(`${serverUrl}/api/apps/instances`).then(r => r.json()).catch(() => ({})),
      fetch(`${serverUrl}/api/designs`).then(r => r.json()).catch(() => ({})),
      fetch(`${serverUrl}/api/projects`).then(r => r.json()).catch(() => ({})),
    ]).then(([a, d, p]) => setChoices({
      app: (a.instances ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })),
      design: (d.designs ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })),
      project: (p.projects ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })),
    }))
  }, [serverUrl])

  const set = (i: number, patch: Partial<Zone>) =>
    onChange(zones.map((z, n) => (n === i ? { ...z, ...patch } : z)))

  const num = (v: string, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback
  }

  return (
    <div>
      {/* live plan */}
      <div style={{
        position: 'relative', width: '100%', paddingTop: '42%', marginBottom: 12,
        background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        overflow: 'hidden',
      }}>
        {zones.map((z, i) => (
          <div key={i} title={z.name}
            style={{
              position: 'absolute',
              left: `${z.left}%`, top: `${z.top}%`, width: `${z.width}%`, height: `${z.height}%`,
              background: ZONE_TINTS[i % ZONE_TINTS.length],
              border: '1px solid rgba(0,0,0,.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: '#0b1220', overflow: 'hidden', padding: 2, textAlign: 'center',
            }}>
            {z.name}
          </div>
        ))}
      </div>

      {zones.map((z, i) => (
        <div key={i} style={{
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          padding: 10, marginBottom: 8, background: 'var(--bg-primary)',
        }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <span style={{
              width: 10, height: 10, borderRadius: 2, flexShrink: 0,
              background: ZONE_TINTS[i % ZONE_TINTS.length],
            }} />
            <input className="form-input" style={{ flex: 1 }} value={z.name} placeholder="Zone name"
              onChange={e => set(i, { name: e.target.value })} />
            <button className="btn-icon" title="Remove zone"
              onClick={() => onChange(zones.filter((_, n) => n !== i))}>🗑</button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            {(['top', 'left', 'width', 'height'] as const).map(k => (
              <div key={k} style={{ flex: 1, minWidth: 0 }}>
                <span style={CAPTION}>{k} %</span>
                <input className="form-input" type="number" min={0} max={100} step={0.1} value={z[k]}
                  onChange={e => set(i, { [k]: num(e.target.value, z[k]) } as Partial<Zone>)} />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <select className="form-select" style={{ flex: '0 0 34%' }} value={z.kind}
              onChange={e => set(i, { kind: e.target.value as Zone['kind'], refId: '' })}>
              <option value="empty">Nothing</option>
              <option value="app">App</option>
              <option value="design">Design</option>
              <option value="project">Playlist</option>
            </select>
            <select className="form-select" style={{ flex: 1 }} value={z.refId}
              disabled={z.kind === 'empty'}
              onChange={e => set(i, { refId: e.target.value })}>
              <option value="">
                {z.kind === 'empty' ? '—' : 'Choose…'}
              </option>
              {(choices[z.kind as 'app' | 'design' | 'project'] ?? []).map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm"
          onClick={() => onChange([...zones, {
            name: `Zone ${zones.length + 1}`, top: 0, left: 0, width: 50, height: 50, kind: 'empty', refId: '',
          }])}>+ Add zone</button>
        {ZONE_PRESETS.map(p => (
          <button key={p.label} className="btn btn-ghost btn-sm"
            onClick={() => onChange(p.zones.map(z => ({ ...z })))}>{p.label}</button>
        ))}
      </div>
    </div>
  )
}

function Control({ field, value, onChange, serverUrl, config }: {
  field: AppField
  value: unknown
  onChange: (v: unknown) => void
  serverUrl: string
  config: Config
}) {
  switch (field.type) {
    case 'note':
      return null

    case 'image':
      return <ImagePicker serverUrl={serverUrl} value={String(value ?? '')} onChange={onChange} />

    case 'zones':
      return <ZonesEditor serverUrl={serverUrl} value={value as Zone[]} onChange={onChange} />

    case 'project':
      return <ProjectPicker serverUrl={serverUrl} value={value as string} onChange={onChange} />

    case 'connection':
      return <ConnectionField serverUrl={serverUrl} field={field} config={config} />

    case 'checkbox':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <span className="toggle">
            <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
            <span className="toggle-slider" />
          </span>
          <span style={{ fontSize: 13 }}>{field.label}</span>
        </label>
      )

    case 'select': {
      const opts = field.options ?? []
      const active = opts.find(o => o.value === value)
      return (
        <>
          <select className="form-select" value={String(value ?? '')} onChange={e => onChange(e.target.value)}>
            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {active?.hint && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{active.hint}</div>
          )}
        </>
      )
    }

    case 'color':
      return (
        <div className="color-row">
          <input type="color" value={String(value ?? '#000000')} onChange={e => onChange(e.target.value)} />
          <input className="form-input" value={String(value ?? '')}
            onChange={e => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v) }} />
        </div>
      )

    case 'slider': {
      const min = field.min ?? 1, max = field.max ?? 20
      const marks = field.marks ?? []
      return (
        <div>
          <input type="range" style={{ width: '100%' }}
            min={min} max={max} step={field.step ?? 1}
            value={Number(value ?? field.default ?? min)}
            onChange={e => onChange(Number(e.target.value))} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)' }}>
            {marks.length
              ? marks.map(m => <span key={m}>{m}</span>)
              : <><span>{min}</span><span>{max}</span></>}
          </div>
        </div>
      )
    }

    case 'number':
      return (
        <input className="form-input" type="number"
          min={field.min} max={field.max} step={field.step ?? 1}
          value={Number(value ?? field.default ?? 0)}
          onChange={e => { if (e.target.value === '') return; const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n) }} />
      )

    case 'textarea':
      return (
        <textarea className="form-textarea" rows={3} value={String(value ?? '')}
          placeholder={field.placeholder} onChange={e => onChange(e.target.value)} />
      )

    default:
      return (
        <input className="form-input" value={String(value ?? '')}
          placeholder={field.placeholder} onChange={e => onChange(e.target.value)} />
      )
  }
}

function Row({ field, config, onChange, serverUrl }: {
  field: AppField
  config: Config
  onChange: (key: string, v: unknown) => void
  serverUrl: string
}) {
  if (field.type === 'note') {
    return (
      <div style={{
        background: 'rgba(59,130,246,.08)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 16,
        fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5,
      }}>
        <b style={{ color: 'var(--text-primary)' }}>{field.label}</b>
        {field.help && <div style={{ marginTop: 4 }}>{field.help}</div>}
      </div>
    )
  }

  // A checkbox draws its own label beside the switch, so it does not get one above.
  if (field.type === 'checkbox') {
    return (
      <div className="form-group">
        <Control field={field} value={config[field.key]} onChange={v => onChange(field.key, v)} serverUrl={serverUrl} config={config} />
        {field.help && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{field.help}</div>}
      </div>
    )
  }

  return (
    <div className="form-group">
      <label className="form-label">
        {field.label}{field.required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      <Control field={field} value={config[field.key]} onChange={v => onChange(field.key, v)} serverUrl={serverUrl} config={config} />
      {field.help && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{field.help}</div>}
    </div>
  )
}

export function AppConfigForm({ fields, config, onChange, serverUrl }: {
  fields: AppField[]
  config: Config
  onChange: (next: Config) => void
  serverUrl: string
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const set = (key: string, v: unknown) => onChange({ ...config, [key]: v })

  const { basic, advanced } = useMemo(() => ({
    basic: fields.filter(f => !f.advanced && visible(f, config)),
    advanced: fields.filter(f => f.advanced && visible(f, config)),
  }), [fields, config])

  return (
    <div>
      {basic.map(f => <Row key={f.key} field={f} config={config} onChange={set} serverUrl={serverUrl} />)}

      {advanced.length > 0 && (
        <>
          <button
            onClick={() => setShowAdvanced(v => !v)}
            style={{
              background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer',
              fontSize: 13, padding: '6px 0', margin: '4px 0 12px', display: 'block', width: '100%', textAlign: 'center',
            }}>
            Advanced {showAdvanced ? '▾' : '▸'}
          </button>
          {showAdvanced && (
            <div style={{
              background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '16px 16px 4px',
            }}>
              {advanced.map(f => <Row key={f.key} field={f} config={config} onChange={set} serverUrl={serverUrl} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
