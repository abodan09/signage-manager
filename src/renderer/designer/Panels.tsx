import { useEffect, useRef, useState } from 'react'
import type {
  Design, PackTemplate, QrKind, SceneBackground, SceneElement, SceneFit, ShapeKind, WidgetKind,
} from '../types'
import { SceneThumb, SHAPE_POINTS } from '../scene/SceneView'
import { FONT_OPTIONS } from '../scene/fonts'
// One definition of what a QR code means, shared with the server that encodes
// it — a second copy here would drift and produce codes that scan wrong.
import { QR_KINDS, buildQrData, validateQr } from '../../main/server/qr-kinds'

/** The left side-menu panels. Each one is a way to put something new on the
 *  canvas or to restyle the canvas itself; the properties of whatever is
 *  already selected live in the Inspector on the right. */

export type PanelId = 'templates' | 'widgets' | 'elements' | 'text' | 'photos' | 'qr' | 'background' | 'layers'

export const PANELS: Array<{ id: PanelId; icon: string; label: string }> = [
  { id: 'templates',  icon: '🗂️', label: 'Templates' },
  { id: 'widgets',    icon: '🧩', label: 'Widgets' },
  { id: 'text',       icon: '🔠', label: 'Text' },
  { id: 'elements',   icon: '⬛', label: 'Elements' },
  { id: 'photos',     icon: '🖼️', label: 'Photos' },
  { id: 'qr',         icon: '📱', label: 'QR Code' },
  { id: 'background', icon: '🎨', label: 'Background' },
  { id: 'layers',     icon: '📚', label: 'Layers' },
]

const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: '.5px', margin: '4px 0 10px',
}

// ── Templates ────────────────────────────────────────────────────────────────

/** The template rail. It opens on the category the current design came from —
 *  someone editing a restaurant menu almost always wants another restaurant
 *  template — but every installed category stays one click away. */
export function TemplatesPanel({
  serverUrl, design, onApply, reloadKey,
}: {
  serverUrl: string
  design: Design
  onApply: (t: PackTemplate) => void
  /** Bumped after saving a template, so the rail picks it up immediately. */
  reloadKey?: number
}) {
  const [templates, setTemplates] = useState<PackTemplate[]>([])
  const [mine, setMine] = useState<PackTemplate[]>([])
  const [cats, setCats] = useState<Array<{ category: string; name: string; icon: string }>>([])
  const [active, setActive] = useState<string>(design.category ?? 'all')
  const [search, setSearch] = useState('')
  const [orientation, setOrientation] = useState<'all' | 'landscape' | 'portrait'>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!serverUrl) return
    Promise.all([
      fetch(`${serverUrl}/api/packs/templates`).then(r => r.json()),
      fetch(`${serverUrl}/api/packs`).then(r => r.json()),
      fetch(`${serverUrl}/api/designs?templates=1`).then(r => r.json()),
    ]).then(([t, c, own]) => {
      setTemplates(t.templates ?? [])
      setCats((c.categories ?? []).filter((x: { installed: boolean }) => x.installed))
      // The operator's own saved designs, shaped like pack templates so the
      // rail draws and applies them through one code path.
      setMine((own.designs ?? []).map((d: Design) => ({
        key: d.id, category: 'yours', name: d.name, tags: [], design: d,
      })))
    }).catch(() => { /* the panel simply stays empty */ })
      .finally(() => setLoading(false))
  }, [serverUrl, reloadKey])

  const q = search.trim().toLowerCase()
  const pool = active === 'yours' ? mine : templates
  const shown = pool.filter(t => {
    if (active !== 'all' && active !== 'yours' && t.category !== active) return false
    if (orientation === 'landscape' && t.design.width < t.design.height) return false
    if (orientation === 'portrait' && t.design.width >= t.design.height) return false
    if (!q) return true
    return t.name.toLowerCase().includes(q) || (t.tags ?? []).some(g => g.includes(q))
  })

  return (
    <div>
      <div style={sectionTitle}>Start from a template</div>
      <input className="form-input" placeholder="Search…" value={search}
        onChange={e => setSearch(e.target.value)} style={{ marginBottom: 10 }} />

      <div className="days-row" style={{ marginBottom: 8 }}>
        <button className={`day-chip ${active === 'all' ? 'selected' : ''}`} onClick={() => setActive('all')}>All</button>
        {mine.length > 0 && (
          <button className={`day-chip ${active === 'yours' ? 'selected' : ''}`}
            onClick={() => setActive('yours')} title="Templates your team saved">⭐</button>
        )}
        {cats.map(c => (
          <button key={c.category} className={`day-chip ${active === c.category ? 'selected' : ''}`}
            onClick={() => setActive(c.category)} title={c.name}>{c.icon}</button>
        ))}
      </div>

      <div className="days-row" style={{ marginBottom: 12 }}>
        {(['all', 'landscape', 'portrait'] as const).map(o => (
          <button key={o} className={`day-chip ${orientation === o ? 'selected' : ''}`}
            onClick={() => setOrientation(o)} style={{ fontSize: 11 }}>
            {o === 'all' ? 'Any shape' : o === 'landscape' ? 'Landscape' : 'Portrait'}
          </button>
        ))}
      </div>

      {loading && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loading…</div>}
      {!loading && !templates.length && !mine.length && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          No categories installed. Add one from Templates → Manage categories.
        </div>
      )}
      {!loading && !shown.length && (templates.length > 0 || mine.length > 0) && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Nothing matches that.</div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {shown.map(t => (
          <button key={`${t.category}/${t.key}`} onClick={() => onApply(t)}
            style={{
              background: 'var(--bg-primary)', border: '1px solid var(--border)',
              borderRadius: 8, padding: 0, cursor: 'pointer', overflow: 'hidden', textAlign: 'left',
            }}>
            <SceneThumb design={t.design} base={serverUrl} width={224} height={126} />
            <div style={{ padding: '7px 9px', fontSize: 12, color: 'var(--text-primary)' }}>{t.name}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Text ─────────────────────────────────────────────────────────────────────

const TEXT_PRESETS = [
  { label: 'Headline', size: 120, bold: true, font: 'bebas' as const, text: 'Your headline' },
  { label: 'Subheading', size: 64, bold: true, font: 'inter' as const, text: 'A supporting line' },
  { label: 'Body text', size: 40, bold: false, font: 'inter' as const, text: 'Add your message here.' },
  { label: 'Caption', size: 26, bold: false, font: 'inter' as const, text: 'Small print' },
]

export function TextPanel({ onAdd }: { onAdd: (partial: Partial<SceneElement>) => void }) {
  return (
    <div>
      <div style={sectionTitle}>Add text</div>
      {TEXT_PRESETS.map(p => (
        <button key={p.label} className="btn btn-ghost"
          style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 8, height: 'auto', padding: '12px 14px' }}
          onClick={() => onAdd({
            type: 'text', text: p.text, fontSize: p.size, bold: p.bold, font: p.font,
            w: 900, h: Math.round(p.size * 1.6),
          } as Partial<SceneElement>)}>
          <span style={{ fontSize: Math.min(22, p.size / 4), fontWeight: p.bold ? 700 : 400 }}>{p.label}</span>
        </button>
      ))}
      <div style={{ ...sectionTitle, marginTop: 18 }}>Fonts available</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        {FONT_OPTIONS.map(f => f.label).join(' · ')}
      </div>
    </div>
  )
}

// ── Elements ─────────────────────────────────────────────────────────────────

const SHAPE_KINDS: ShapeKind[] = [
  'rect', 'ellipse', 'triangle', 'triangle-down', 'diamond', 'pentagon',
  'hexagon', 'star', 'burst', 'arrow-right', 'arrow-left', 'chevron',
  'banner', 'shield', 'badge', 'line',
]

/** Each shape previews as the real thing, drawn by the same code the canvas
 *  uses — a picker of approximate glyphs would misrepresent what you get. */
function ShapeButton({ kind, onAdd }: { kind: ShapeKind; onAdd: (p: Partial<SceneElement>) => void }) {
  const pts = SHAPE_POINTS[kind]
  return (
    <button className="btn btn-ghost" title={kind}
      style={{ height: 52, padding: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => onAdd({
        type: 'shape', kind, fillOpacity: 100,
        w: kind === 'line' ? 600 : 360, h: kind === 'line' ? 16 : 300,
        ...(kind === 'line'
          ? { fill: null, stroke: '#3b82f6', strokeWidth: 8 }
          : { fill: '#3b82f6' }),
      } as Partial<SceneElement>)}>
      <svg viewBox="0 0 32 32" width={26} height={26} preserveAspectRatio="none">
        {kind === 'rect' && <rect x={2} y={6} width={28} height={20} rx={3} fill="currentColor" />}
        {kind === 'ellipse' && <ellipse cx={16} cy={16} rx={14} ry={12} fill="currentColor" />}
        {kind === 'line' && <rect x={1} y={14} width={30} height={4} rx={2} fill="currentColor" />}
        {pts && <polygon points={pts.map(([x, y]) => `${2 + x * 28},${2 + y * 28}`).join(' ')} fill="currentColor" />}
      </svg>
    </button>
  )
}

export function ElementsPanel({ onAdd }: { onAdd: (partial: Partial<SceneElement>) => void }) {
  return (
    <div>
      <div style={sectionTitle}>Shapes</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 18 }}>
        {SHAPE_KINDS.map(k => <ShapeButton key={k} kind={k} onAdd={onAdd} />)}
      </div>

      <div style={sectionTitle}>Bands and rules</div>
      <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 8 }}
        onClick={() => onAdd({ type: 'shape', kind: 'rect', fill: '#000000', fillOpacity: 55, w: 1920, h: 220, x: 0 } as Partial<SceneElement>)}>
        Full-width band
      </button>
      <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 8 }}
        onClick={() => onAdd({ type: 'shape', kind: 'rect', fill: '#f59e0b', fillOpacity: 100, w: 260, h: 10, radius: 5 } as Partial<SceneElement>)}>
        Accent rule
      </button>
      <button className="btn btn-ghost" style={{ width: '100%' }}
        onClick={() => onAdd({ type: 'shape', kind: 'rect', fill: null, stroke: '#ffffff', strokeWidth: 6, w: 1720, h: 880, radius: 24 } as Partial<SceneElement>)}>
        Outline frame
      </button>
    </div>
  )
}

// ── Widgets ──────────────────────────────────────────────────────────────────

const WIDGETS: Array<{
  kind: WidgetKind; label: string; icon: string; hint: string; defaults: Partial<SceneElement>
}> = [
  {
    kind: 'clock', label: 'Time', icon: '🕐', hint: 'A live clock that ticks on the screen.',
    defaults: { w: 620, h: 190, fontSize: 140, bold: true, config: { format: '24h', showSeconds: false, timezoneOffset: null, label: '' } } as Partial<SceneElement>,
  },
  {
    kind: 'date', label: 'Date', icon: '📅', hint: 'Today’s date, always current.',
    defaults: { w: 820, h: 110, fontSize: 60, config: { format: 'long', timezoneOffset: null } } as Partial<SceneElement>,
  },
  {
    kind: 'weather', label: 'Weather', icon: '⛅', hint: 'Reads a Weather app you have already set up.',
    defaults: { w: 700, h: 130, fontSize: 72, config: { appInstanceId: '', show: 'temp-icon' } } as Partial<SceneElement>,
  },
  {
    kind: 'scroll', label: 'Scrolling Text', icon: '🎞️', hint: 'A message that travels across the design.',
    defaults: { w: 1600, h: 110, fontSize: 56, config: { text: 'Your scrolling message', speed: 10, direction: 'left' } } as Partial<SceneElement>,
  },
]

/** Widgets are the live half of a design. Everything else is fixed the moment
 *  it is saved; these keep changing on the wall. */
export function WidgetsPanel({ serverUrl, onAdd }: {
  serverUrl: string
  onAdd: (partial: Partial<SceneElement>) => void
}) {
  const [weatherApps, setWeatherApps] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/apps/instances`)
      .then(r => r.json())
      .then(d => setWeatherApps((d.instances ?? []).filter((i: { appId: string }) => i.appId === 'weather')))
      .catch(() => { /* the weather widget just prompts to set one up */ })
  }, [serverUrl])

  return (
    <div>
      <div style={sectionTitle}>Live widgets</div>
      {WIDGETS.map(w => (
        <button key={w.kind} className="btn btn-ghost"
          style={{ width: '100%', justifyContent: 'flex-start', height: 'auto', padding: '11px 12px', marginBottom: 8, textAlign: 'left' }}
          onClick={() => onAdd({
            type: 'widget', kind: w.kind, color: '#ffffff', align: 'center', font: 'inter',
            ...w.defaults,
            ...(w.kind === 'weather' && weatherApps.length
              ? { config: { appInstanceId: weatherApps[0].id, show: 'temp-icon' } }
              : {}),
          } as Partial<SceneElement>)}>
          <span style={{ fontSize: 20, marginRight: 10 }}>{w.icon}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{w.label}</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.35 }}>{w.hint}</span>
          </span>
        </button>
      ))}

      {!weatherApps.length && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 12, lineHeight: 1.5 }}>
          The Weather widget needs a Weather app first — set one up under Apps, then
          come back and it will appear here.
        </div>
      )}
    </div>
  )
}

// ── Photos ───────────────────────────────────────────────────────────────────

export function PhotosPanel({
  serverUrl, assets, onRefresh, onAdd, onSetSelectedSrc, hasImageSelected,
}: {
  serverUrl: string
  assets: Array<{ path: string; name: string }>
  onRefresh: () => void
  onAdd: (partial: Partial<SceneElement>) => void
  onSetSelectedSrc: (src: string) => void
  hasImageSelected: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function upload(file: File) {
    setBusy(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${serverUrl}/api/designs/upload`, { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      onRefresh()
      if (hasImageSelected) onSetSelectedSrc(data.path)
      else onAdd({ type: 'image', src: data.path, fit: 'cover', w: 800, h: 600 } as Partial<SceneElement>)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={sectionTitle}>Pictures</div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
      <button className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }}
        disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'Uploading…' : 'Upload a picture'}
      </button>
      <button className="btn btn-ghost" style={{ width: '100%', marginBottom: 14 }}
        onClick={() => onAdd({ type: 'image', src: null, fit: 'cover', w: 800, h: 600 } as Partial<SceneElement>)}>
        Add empty photo frame
      </button>
      {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>{error}</div>}

      <div style={sectionTitle}>On this computer</div>
      {assets.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {assets.map(a => (
            <img key={a.path} src={serverUrl + a.path} alt={a.name} title={a.name}
              onClick={() => hasImageSelected
                ? onSetSelectedSrc(a.path)
                : onAdd({ type: 'image', src: a.path, fit: 'cover', w: 800, h: 600 } as Partial<SceneElement>)}
              style={{
                width: '100%', height: 70, objectFit: 'cover', borderRadius: 6,
                border: '1px solid var(--border)', cursor: 'pointer', display: 'block',
              }} />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Nothing uploaded yet. Pictures you add to the Content Library show up here too.
        </div>
      )}
    </div>
  )
}

// ── QR ───────────────────────────────────────────────────────────────────────

/** The typed QR builder. The operator picks what the code should DO and fills
 *  in plain fields; the payload grammar (a Wi-Fi string is not a URL) is the
 *  app's problem, not theirs. Shared with the Inspector so editing an existing
 *  code offers the same form. */
export function QrBuilder({ kind, fields, onChange }: {
  kind: QrKind
  fields: Record<string, string>
  onChange: (kind: QrKind, fields: Record<string, string>) => void
}) {
  const spec = QR_KINDS.find(k => k.kind === kind) ?? QR_KINDS[0]
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
        {QR_KINDS.map(k => (
          <button key={k.kind}
            className={`type-tab ${k.kind === kind ? 'active' : ''}`}
            style={{ padding: '8px 6px', fontSize: 11, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => onChange(k.kind, {})}>
            <span>{k.icon}</span><span>{k.label}</span>
          </button>
        ))}
      </div>

      {spec.fields.map(f => (
        <div className="form-group" key={f.key}>
          <label className="form-label">
            {f.label}{!f.optional && <span style={{ color: 'var(--danger)' }}> *</span>}
          </label>
          {f.options
            ? (
              <select className="form-select" value={fields[f.key] ?? f.options[0].value}
                onChange={e => onChange(kind, { ...fields, [f.key]: e.target.value })}>
                {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )
            : (
              <input className="form-input" value={fields[f.key] ?? ''} placeholder={f.placeholder}
                onChange={e => onChange(kind, { ...fields, [f.key]: e.target.value })} />
            )}
        </div>
      ))}

      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{spec.hint}</div>
    </>
  )
}

export function QrPanel({ onAdd }: { onAdd: (partial: Partial<SceneElement>) => void }) {
  const [kind, setKind] = useState<QrKind>('url')
  const [fields, setFields] = useState<Record<string, string>>({})

  const problem = validateQr(kind, fields)
  const preview = buildQrData(kind, fields)

  return (
    <div>
      <div style={sectionTitle}>Add a QR code</div>
      <QrBuilder kind={kind} fields={fields} onChange={(k, f) => { setKind(k); setFields(f) }} />

      <button className="btn btn-primary" style={{ width: '100%', margin: '14px 0 10px' }}
        disabled={!!problem}
        onClick={() => onAdd({
          type: 'qr', kind, fields, data: preview,
          fg: '#000000', bg: '#ffffff', w: 320, h: 320,
        } as Partial<SceneElement>)}>
        Add QR code
      </button>

      {problem
        ? <div style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 10 }}>{problem}</div>
        : (
          <div style={{
            fontSize: 10, color: 'var(--text-secondary)', wordBreak: 'break-all',
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '6px 8px', marginBottom: 10, fontFamily: 'monospace',
          }}>{preview}</div>
        )}

      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Keep the code at least 300&nbsp;px on a 1080p screen, and leave a light
        margin around it — phones need the contrast to lock on from across a room.
      </div>
    </div>
  )
}

// ── Background ───────────────────────────────────────────────────────────────

const BG_PRESETS: Array<{ label: string; bg: SceneBackground }> = [
  { label: 'Midnight', bg: { color: '#0f172a', gradient: { from: '#0f172a', to: '#1e293b', angle: 160 } } },
  { label: 'Charcoal', bg: { color: '#111827', gradient: { from: '#111827', to: '#1f2937', angle: 160 } } },
  { label: 'Espresso', bg: { color: '#1c1310', gradient: { from: '#1c1310', to: '#2d201a', angle: 160 } } },
  { label: 'Forest', bg: { color: '#0f1f16', gradient: { from: '#0f1f16', to: '#16301f', angle: 160 } } },
  { label: 'Ocean', bg: { color: '#0b1f33', gradient: { from: '#0b1f33', to: '#123354', angle: 160 } } },
  { label: 'Crimson', bg: { color: '#1a0d0f', gradient: { from: '#1a0d0f', to: '#2b1216', angle: 160 } } },
  { label: 'Paper', bg: { color: '#faf7f2', gradient: { from: '#faf7f2', to: '#efe7db', angle: 160 } } },
  { label: 'White', bg: { color: '#ffffff' } },
]

export function BackgroundPanel({
  serverUrl, background, assets, onChange,
}: {
  serverUrl: string
  background: SceneBackground
  assets: Array<{ path: string; name: string }>
  onChange: (bg: SceneBackground) => void
}) {
  const g = background.gradient
  return (
    <div>
      <div style={sectionTitle}>Presets</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {BG_PRESETS.map(p => (
          <button key={p.label} onClick={() => onChange({ ...p.bg })}
            style={{
              height: 54, borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer',
              background: p.bg.gradient
                ? `linear-gradient(${p.bg.gradient.angle}deg, ${p.bg.gradient.from}, ${p.bg.gradient.to})`
                : p.bg.color,
              color: p.bg.color === '#ffffff' || p.bg.color === '#faf7f2' ? '#111827' : '#f8fafc',
              fontSize: 11,
            }}>{p.label}</button>
        ))}
      </div>

      <div className="form-group">
        <label className="form-label">Base colour</label>
        <div className="color-row">
          <input type="color" value={background.color}
            onChange={e => onChange({ ...background, color: e.target.value })} />
          <input className="form-input" value={background.color}
            onChange={e => { const v = e.target.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange({ ...background, color: v }) }} />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="toggle">
            <input type="checkbox" checked={!!g}
              onChange={e => onChange(e.target.checked
                ? { ...background, gradient: { from: background.color, to: '#1e293b', angle: 160 } }
                : { ...background, gradient: undefined })} />
            <span className="toggle-slider" />
          </label>
          Gradient
        </label>
      </div>
      {g && (
        <>
          <div className="form-group">
            <label className="form-label">From → To</label>
            <div className="color-row">
              <input type="color" value={g.from} onChange={e => onChange({ ...background, gradient: { ...g, from: e.target.value } })} />
              <input type="color" value={g.to} onChange={e => onChange({ ...background, gradient: { ...g, to: e.target.value } })} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Angle {g.angle}°</label>
            <input type="range" min={0} max={360} value={g.angle} style={{ width: '100%' }}
              onChange={e => onChange({ ...background, gradient: { ...g, angle: Number(e.target.value) } })} />
          </div>
        </>
      )}

      <div style={{ ...sectionTitle, marginTop: 12 }}>Background picture</div>
      {background.imagePath ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <img src={serverUrl + background.imagePath} alt=""
            style={{ width: 64, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
          <button className="btn btn-ghost btn-sm"
            onClick={() => onChange({ ...background, imagePath: undefined, imageFit: undefined })}>Remove</button>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
          Pick one of your pictures to sit behind everything.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {assets.slice(0, 10).map(a => (
          <img key={a.path} src={serverUrl + a.path} alt={a.name} title={a.name}
            onClick={() => onChange({ ...background, imagePath: a.path, imageFit: background.imageFit ?? 'cover' })}
            style={{
              width: '100%', height: 56, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', display: 'block',
              border: background.imagePath === a.path ? '2px solid var(--accent)' : '1px solid var(--border)',
            }} />
        ))}
      </div>
      {background.imagePath && (
        <div className="form-group" style={{ marginTop: 12 }}>
          <label className="form-label">Picture fit</label>
          <select className="form-select" value={background.imageFit ?? 'cover'}
            onChange={e => onChange({ ...background, imageFit: e.target.value as SceneFit })}>
            <option value="cover">Fill the screen</option>
            <option value="contain">Fit inside</option>
            <option value="fill">Stretch</option>
          </select>
        </div>
      )}
    </div>
  )
}

// ── Layers ───────────────────────────────────────────────────────────────────

const LAYER_ICON: Record<string, string> = { text: '🔠', shape: '⬛', image: '🖼️', qr: '📱' }

function layerName(el: SceneElement): string {
  if (el.name) return el.name
  if (el.type === 'text') return (el.text || 'Text').slice(0, 28).replace(/\n/g, ' ') || 'Text'
  if (el.type === 'shape') return el.kind[0].toUpperCase() + el.kind.slice(1)
  if (el.type === 'image') return el.src ? 'Picture' : 'Photo frame'
  return 'QR code'
}

/** Topmost first, matching what the operator sees — the array itself is stored
 *  bottom-first because that is paint order. */
export function LayersPanel({
  elements, selectedId, onSelect, onMove, onToggleLock, onDelete,
}: {
  elements: SceneElement[]
  selectedId: string | null
  onSelect: (id: string) => void
  onMove: (id: string, dir: 'up' | 'down') => void
  onToggleLock: (id: string) => void
  onDelete: (id: string) => void
}) {
  const ordered = [...elements].reverse()
  return (
    <div>
      <div style={sectionTitle}>Layers ({elements.length})</div>
      {!elements.length && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Nothing on the canvas yet.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ordered.map(el => (
          <div key={el.id}
            onClick={() => onSelect(el.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6,
              cursor: 'pointer', fontSize: 12,
              background: selectedId === el.id ? 'rgba(59,130,246,.15)' : 'transparent',
              border: `1px solid ${selectedId === el.id ? 'var(--accent)' : 'transparent'}`,
            }}>
            <span>{LAYER_ICON[el.type]}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {layerName(el)}
            </span>
            <button className="btn-icon" title="Bring forward" style={{ padding: 2 }}
              onClick={e => { e.stopPropagation(); onMove(el.id, 'up') }}>↑</button>
            <button className="btn-icon" title="Send backward" style={{ padding: 2 }}
              onClick={e => { e.stopPropagation(); onMove(el.id, 'down') }}>↓</button>
            <button className="btn-icon" title={el.locked ? 'Unlock' : 'Lock'} style={{ padding: 2 }}
              onClick={e => { e.stopPropagation(); onToggleLock(el.id) }}>{el.locked ? '🔒' : '🔓'}</button>
            <button className="btn-icon" title="Delete" style={{ padding: 2 }}
              onClick={e => { e.stopPropagation(); onDelete(el.id) }}>🗑</button>
          </div>
        ))}
      </div>
    </div>
  )
}
