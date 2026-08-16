import type {
  ImageElement, QrElement, SceneAlign, SceneElement, SceneFit, SceneFontId,
  SceneVAlign, ShapeElement, ShapeKind, TextElement, WidgetElement,
} from '../types'
import { FONT_OPTIONS } from '../scene/fonts'
import { QrBuilder } from './Panels'
import { buildQrData, validateQr } from '../../main/server/qr-kinds'

/** The right-hand properties panel. Every control writes a partial patch back
 *  through onPatch, so the page keeps a single history entry per gesture. */

const label: React.CSSProperties = {
  fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)',
  textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4, display: 'block',
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>{children}</div>
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ flex: 1, minWidth: 0 }}><span style={label}>{title}</span>{children}</div>
}

function NumberInput({ value, onChange, min, max, step = 1 }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number
}) {
  return (
    <input className="form-input" type="number" value={Math.round(value * 100) / 100}
      min={min} max={max} step={step}
      onChange={e => {
        // A number input reports '' while the text is mid-edit or invalid for
        // the locale (a comma decimal separator, say). Number('') is 0, which
        // would silently snap the value to the field's minimum as you type.
        if (e.target.value === '') return
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(n)
      }} />
  )
}

function ColorInput({ value, onChange, allowNone }: {
  value: string | null; onChange: (v: string | null) => void; allowNone?: boolean
}) {
  return (
    <div className="color-row">
      <input type="color" value={value ?? '#000000'} onChange={e => onChange(e.target.value)} />
      <input className="form-input" value={value ?? ''} placeholder={allowNone ? 'None' : '#000000'}
        onChange={e => {
          const v = e.target.value.trim()
          if (!v && allowNone) { onChange(null); return }
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v)
        }} />
      {allowNone && value && (
        <button className="btn-icon" title="Clear" onClick={() => onChange(null)}>✕</button>
      )}
    </div>
  )
}

function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: Array<{ v: T; label: string }>; onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {options.map(o => (
        <button key={o.v}
          className={`type-tab ${value === o.v ? 'active' : ''}`}
          style={{ padding: '6px 4px', fontSize: 12 }}
          onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Inspector({
  el, base, onPatch, onDelete, onDuplicate, onOrder, onAlign, assets, onPickImage, weatherApps = [],
}: {
  el: SceneElement
  base: string
  onPatch: (patch: Partial<SceneElement>) => void
  onDelete: () => void
  onDuplicate: () => void
  onOrder: (dir: 'front' | 'forward' | 'backward' | 'back') => void
  onAlign: (how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => void
  assets: Array<{ path: string; name: string }>
  onPickImage: () => void
  weatherApps?: Array<{ id: string; name: string }>
}) {
  const patch = onPatch as (p: Record<string, unknown>) => void

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{el.type}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn-icon" title="Duplicate (Ctrl+D)" onClick={onDuplicate}>⧉</button>
          <button className="btn-icon" title={el.locked ? 'Unlock' : 'Lock'}
            onClick={() => patch({ locked: !el.locked })}>{el.locked ? '🔒' : '🔓'}</button>
          <button className="btn-icon" title="Delete (Del)" onClick={onDelete}>🗑</button>
        </div>
      </div>

      {/* ── arrange ── */}
      <span style={label}>Arrange</span>
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} title="Bring to front" onClick={() => onOrder('front')}>⤒</button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} title="Bring forward" onClick={() => onOrder('forward')}>↑</button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} title="Send backward" onClick={() => onOrder('backward')}>↓</button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} title="Send to back" onClick={() => onOrder('back')}>⤓</button>
      </div>
      <span style={label}>Align to canvas</span>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} title="Left" onClick={() => onAlign('left')}>⇤</button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} title="Centre" onClick={() => onAlign('hcenter')}>↔</button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} title="Right" onClick={() => onAlign('right')}>⇥</button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} title="Top" onClick={() => onAlign('top')}>⤒</button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} title="Middle" onClick={() => onAlign('vcenter')}>↕</button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} title="Bottom" onClick={() => onAlign('bottom')}>⤓</button>
      </div>

      {/* ── geometry ── */}
      <Row>
        <Field title="X"><NumberInput value={el.x} onChange={n => patch({ x: n })} /></Field>
        <Field title="Y"><NumberInput value={el.y} onChange={n => patch({ y: n })} /></Field>
      </Row>
      <Row>
        <Field title="Width"><NumberInput value={el.w} onChange={n => patch({ w: Math.max(1, n) })} min={1} /></Field>
        <Field title="Height"><NumberInput value={el.h} onChange={n => patch({ h: Math.max(1, n) })} min={1} /></Field>
      </Row>
      <Row>
        <Field title="Rotation"><NumberInput value={el.rotation} onChange={n => patch({ rotation: n })} min={-360} max={360} /></Field>
        <Field title="Opacity %"><NumberInput value={el.opacity} onChange={n => patch({ opacity: Math.max(0, Math.min(100, n)) })} min={0} max={100} /></Field>
      </Row>

      <div style={{ height: 1, background: 'var(--border)', margin: '6px 0 16px' }} />

      {el.type === 'text' && <TextProps el={el as TextElement} patch={patch} />}
      {el.type === 'shape' && <ShapeProps el={el as ShapeElement} patch={patch} />}
      {el.type === 'image' && <ImageProps el={el as ImageElement} patch={patch} base={base} assets={assets} onPickImage={onPickImage} />}
      {el.type === 'qr' && <QrProps el={el as QrElement} patch={patch} />}
      {el.type === 'widget' && <WidgetProps el={el as WidgetElement} patch={patch} weatherApps={weatherApps} />}
    </div>
  )
}

function WidgetProps({ el, patch, weatherApps }: {
  el: WidgetElement
  patch: (p: Record<string, unknown>) => void
  weatherApps: Array<{ id: string; name: string }>
}) {
  const cfg = (el.config ?? {}) as Record<string, unknown>
  const setCfg = (p: Record<string, unknown>) => patch({ config: { ...cfg, ...p } })

  return (
    <>
      {el.kind === 'clock' && (
        <>
          <div className="form-group">
            <label className="form-label">Format</label>
            <select className="form-select" value={String(cfg.format ?? '24h')}
              onChange={e => setCfg({ format: e.target.value })}>
              <option value="24h">24 hour (15:30)</option>
              <option value="12h">12 hour (3:30)</option>
              <option value="12h-ampm">12 hour with AM/PM (3:30 PM)</option>
            </select>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <span className="toggle">
                <input type="checkbox" checked={cfg.showSeconds === true}
                  onChange={e => setCfg({ showSeconds: e.target.checked })} />
                <span className="toggle-slider" />
              </span>
              <span style={{ fontSize: 13 }}>Show seconds</span>
            </label>
          </div>
          <div className="form-group">
            <label className="form-label">Label</label>
            <input className="form-input" value={String(cfg.label ?? '')} placeholder="e.g. London"
              onChange={e => setCfg({ label: e.target.value })} />
          </div>
          <TimezoneField cfg={cfg} setCfg={setCfg} />
        </>
      )}

      {el.kind === 'date' && (
        <>
          <div className="form-group">
            <label className="form-label">Format</label>
            <select className="form-select" value={String(cfg.format ?? 'long')}
              onChange={e => setCfg({ format: e.target.value })}>
              <option value="long">Monday, January 5</option>
              <option value="short">Jan 5, 2026</option>
              <option value="numeric">05/01/2026</option>
              <option value="weekday">Monday</option>
            </select>
          </div>
          <TimezoneField cfg={cfg} setCfg={setCfg} />
        </>
      )}

      {el.kind === 'weather' && (
        <>
          <div className="form-group">
            <label className="form-label">Weather app</label>
            <select className="form-select" value={String(cfg.appInstanceId ?? '')}
              onChange={e => setCfg({ appInstanceId: e.target.value })}>
              <option value="">Choose a Weather app…</option>
              {weatherApps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {weatherApps.length
                ? 'The location and units come from that app, so they are set in one place.'
                : 'Set up a Weather app first, under Apps.'}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Show</label>
            <select className="form-select" value={String(cfg.show ?? 'temp-icon')}
              onChange={e => setCfg({ show: e.target.value })}>
              <option value="temp">Temperature only</option>
              <option value="temp-icon">Temperature and conditions</option>
              <option value="full">Place, temperature and conditions</option>
            </select>
          </div>
        </>
      )}

      {el.kind === 'scroll' && (
        <>
          <div className="form-group">
            <label className="form-label">Message</label>
            <textarea className="form-textarea" rows={3} value={String(cfg.text ?? '')}
              onChange={e => setCfg({ text: e.target.value })} />
          </div>
          <Row>
            <Field title="Speed">
              <NumberInput value={Number(cfg.speed ?? 10)} min={1} max={20}
                onChange={n => setCfg({ speed: Math.max(1, Math.min(20, n)) })} />
            </Field>
            <Field title="Direction">
              <select className="form-select" value={String(cfg.direction ?? 'left')}
                onChange={e => setCfg({ direction: e.target.value })}>
                <option value="left">Right to left</option>
                <option value="right">Left to right</option>
              </select>
            </Field>
          </Row>
        </>
      )}

      <div style={{ height: 1, background: 'var(--border)', margin: '6px 0 16px' }} />

      <Row>
        <Field title="Font">
          <select className="form-select" value={el.font} onChange={e => patch({ font: e.target.value as SceneFontId })}>
            {FONT_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Field>
        <div style={{ width: 90 }}>
          <span style={label}>Size</span>
          <NumberInput value={el.fontSize} min={6} max={800} onChange={n => patch({ fontSize: Math.max(6, n) })} />
        </div>
      </Row>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button className={`type-tab ${el.bold ? 'active' : ''}`} style={{ fontWeight: 700 }}
          onClick={() => patch({ bold: !el.bold })}>B</button>
      </div>
      <div style={{ marginBottom: 12 }}>
        <span style={label}>Align</span>
        <Seg<SceneAlign> value={el.align} onChange={v => patch({ align: v })}
          options={[{ v: 'left', label: '⇤' }, { v: 'center', label: '↔' }, { v: 'right', label: '⇥' }]} />
      </div>
      <div className="form-group">
        <label className="form-label">Colour</label>
        <ColorInput value={el.color} onChange={v => patch({ color: v ?? '#ffffff' })} />
      </div>
      <div className="form-group">
        <label className="form-label">Band behind it</label>
        <ColorInput value={el.bgColor} allowNone onChange={v => patch({ bgColor: v })} />
      </div>
      {el.bgColor && (
        <Row>
          <Field title="Band opacity"><NumberInput value={el.bgOpacity} min={0} max={100}
            onChange={n => patch({ bgOpacity: Math.max(0, Math.min(100, n)) })} /></Field>
          <Field title="Corner radius"><NumberInput value={el.radius} min={0} max={400}
            onChange={n => patch({ radius: Math.max(0, n) })} /></Field>
        </Row>
      )}
    </>
  )
}

/** A widget can show another place's time. Offsets rather than zone names: the
 *  scene page runs on TV browsers with no timezone database to consult. */
function TimezoneField({ cfg, setCfg }: {
  cfg: Record<string, unknown>
  setCfg: (p: Record<string, unknown>) => void
}) {
  const ZONES = [
    { v: '', label: 'This screen’s own time' },
    { v: '-28800', label: 'Los Angeles (UTC−8)' },
    { v: '-18000', label: 'New York (UTC−5)' },
    { v: '0', label: 'London (UTC)' },
    { v: '3600', label: 'Paris / Berlin (UTC+1)' },
    { v: '7200', label: 'Cairo / Athens (UTC+2)' },
    { v: '14400', label: 'Dubai (UTC+4)' },
    { v: '19800', label: 'Mumbai (UTC+5:30)' },
    { v: '28800', label: 'Singapore (UTC+8)' },
    { v: '32400', label: 'Tokyo (UTC+9)' },
    { v: '39600', label: 'Sydney (UTC+11)' },
  ]
  const current = cfg.timezoneOffset === null || cfg.timezoneOffset === undefined ? '' : String(cfg.timezoneOffset)
  return (
    <div className="form-group">
      <label className="form-label">Time zone</label>
      <select className="form-select" value={current}
        onChange={e => setCfg({ timezoneOffset: e.target.value === '' ? null : Number(e.target.value) })}>
        {ZONES.map(z => <option key={z.v} value={z.v}>{z.label}</option>)}
      </select>
    </div>
  )
}

function TextProps({ el, patch }: { el: TextElement; patch: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <div className="form-group">
        <label className="form-label">Text</label>
        <textarea className="form-textarea" value={el.text} rows={3}
          onChange={e => patch({ text: e.target.value })} />
      </div>
      <Row>
        <Field title="Font">
          <select className="form-select" value={el.font} onChange={e => patch({ font: e.target.value as SceneFontId })}>
            {FONT_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Field>
        <div style={{ width: 90 }}>
          <span style={label}>Size</span>
          <NumberInput value={el.fontSize} onChange={n => patch({ fontSize: Math.max(6, n) })} min={6} max={800} />
        </div>
      </Row>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button className={`type-tab ${el.bold ? 'active' : ''}`} style={{ fontWeight: 700 }}
          onClick={() => patch({ bold: !el.bold })}>B</button>
        <button className={`type-tab ${el.italic ? 'active' : ''}`} style={{ fontStyle: 'italic' }}
          onClick={() => patch({ italic: !el.italic })}>I</button>
        <button className={`type-tab ${el.underline ? 'active' : ''}`} style={{ textDecoration: 'underline' }}
          onClick={() => patch({ underline: !el.underline })}>U</button>
      </div>
      <div style={{ marginBottom: 12 }}>
        <span style={label}>Align</span>
        <Seg<SceneAlign> value={el.align} onChange={v => patch({ align: v })}
          options={[{ v: 'left', label: '⇤' }, { v: 'center', label: '↔' }, { v: 'right', label: '⇥' }]} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <span style={label}>Vertical</span>
        <Seg<SceneVAlign> value={el.valign} onChange={v => patch({ valign: v })}
          options={[{ v: 'top', label: '⤒' }, { v: 'middle', label: '↕' }, { v: 'bottom', label: '⤓' }]} />
      </div>
      <div className="form-group">
        <label className="form-label">Colour</label>
        <ColorInput value={el.color} onChange={v => patch({ color: v ?? '#ffffff' })} />
      </div>
      <Row>
        <Field title="Line height"><NumberInput value={el.lineHeight} step={0.05} min={0.6} max={3}
          onChange={n => patch({ lineHeight: Math.max(0.6, Math.min(3, n)) })} /></Field>
        <Field title="Letter sp."><NumberInput value={el.letterSpacing} min={-10} max={60}
          onChange={n => patch({ letterSpacing: n })} /></Field>
      </Row>
      <div className="form-group">
        <label className="form-label">Band behind text</label>
        <ColorInput value={el.bgColor} allowNone onChange={v => patch({ bgColor: v })} />
      </div>
      {el.bgColor && (
        <Row>
          <Field title="Band opacity"><NumberInput value={el.bgOpacity} min={0} max={100}
            onChange={n => patch({ bgOpacity: Math.max(0, Math.min(100, n)) })} /></Field>
          <Field title="Corner radius"><NumberInput value={el.radius} min={0} max={400}
            onChange={n => patch({ radius: Math.max(0, n) })} /></Field>
        </Row>
      )}
    </>
  )
}

function ShapeProps({ el, patch }: { el: ShapeElement; patch: (p: Record<string, unknown>) => void }) {
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <span style={label}>Shape</span>
        <Seg<ShapeKind> value={el.kind} onChange={v => patch({ kind: v })}
          options={[{ v: 'rect', label: '▭' }, { v: 'ellipse', label: '◯' }, { v: 'triangle', label: '△' }, { v: 'line', label: '─' }]} />
      </div>
      <div className="form-group">
        <label className="form-label">Fill</label>
        <ColorInput value={el.fill} allowNone onChange={v => patch({ fill: v })} />
      </div>
      {el.fill && (
        <div className="form-group">
          <label className="form-label">Fill opacity</label>
          <NumberInput value={el.fillOpacity} min={0} max={100}
            onChange={n => patch({ fillOpacity: Math.max(0, Math.min(100, n)) })} />
        </div>
      )}
      <div className="form-group">
        <label className="form-label">Outline</label>
        <ColorInput value={el.stroke} allowNone onChange={v => patch({ stroke: v })} />
      </div>
      <Row>
        <Field title="Outline width"><NumberInput value={el.strokeWidth} min={0} max={120}
          onChange={n => patch({ strokeWidth: Math.max(0, n) })} /></Field>
        {el.kind === 'rect' && (
          <Field title="Corner radius"><NumberInput value={el.radius} min={0} max={400}
            onChange={n => patch({ radius: Math.max(0, n) })} /></Field>
        )}
      </Row>
    </>
  )
}

function ImageProps({ el, patch, base, assets, onPickImage }: {
  el: ImageElement; patch: (p: Record<string, unknown>) => void; base: string
  assets: Array<{ path: string; name: string }>; onPickImage: () => void
}) {
  return (
    <>
      <div className="form-group">
        <label className="form-label">Picture</label>
        {el.src ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <img src={base + el.src} alt="" style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
            <button className="btn btn-ghost btn-sm" onClick={onPickImage}>Replace</button>
            <button className="btn btn-ghost btn-sm" onClick={() => patch({ src: null })}>Clear</button>
          </div>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={onPickImage}>Choose a picture</button>
        )}
      </div>
      {assets.length > 0 && (
        <div className="form-group">
          <label className="form-label">Recent</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {assets.slice(0, 8).map(a => (
              <img key={a.path} src={base + a.path} alt={a.name} title={a.name}
                onClick={() => patch({ src: a.path })}
                style={{
                  width: 46, height: 34, objectFit: 'cover', borderRadius: 4, cursor: 'pointer',
                  border: el.src === a.path ? '2px solid var(--accent)' : '1px solid var(--border)',
                }} />
            ))}
          </div>
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <span style={label}>Fit</span>
        <Seg<SceneFit> value={el.fit} onChange={v => patch({ fit: v })}
          options={[{ v: 'cover', label: 'Fill box' }, { v: 'contain', label: 'Fit inside' }, { v: 'fill', label: 'Stretch' }]} />
      </div>
      <div className="form-group">
        <label className="form-label">Corner radius</label>
        <NumberInput value={el.radius} min={0} max={400} onChange={n => patch({ radius: Math.max(0, n) })} />
      </div>
    </>
  )
}

function QrProps({ el, patch }: { el: QrElement; patch: (p: Record<string, unknown>) => void }) {
  // Codes made before typed kinds existed keep their raw payload and get the
  // plain box; anything made since edits through the same builder that created it.
  const typed = !!el.kind
  return (
    <>
      {typed ? (
        <div style={{ marginBottom: 12 }}>
          <QrBuilder
            kind={el.kind!}
            fields={el.fields ?? {}}
            onChange={(kind, fields) => patch({ kind, fields, data: buildQrData(kind, fields) })} />
          {validateQr(el.kind!, el.fields ?? {}) && (
            <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>
              {validateQr(el.kind!, el.fields ?? {})}
            </div>
          )}
        </div>
      ) : (
        <div className="form-group">
          <label className="form-label">Content</label>
          <textarea className="form-textarea" value={el.data} rows={3} placeholder="https://your-site.com"
            onChange={e => patch({ data: e.target.value })} />
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }}
            onClick={() => patch({ kind: 'url', fields: { url: el.data }, data: el.data })}>
            Use the guided builder
          </button>
        </div>
      )}
      <div className="form-group">
        <label className="form-label">Code colour</label>
        <ColorInput value={el.fg} onChange={v => patch({ fg: v ?? '#000000' })} />
      </div>
      <div className="form-group">
        <label className="form-label">Background</label>
        <ColorInput value={el.bg} allowNone onChange={v => patch({ bg: v })} />
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Keep a light background behind a dark code — phones need the contrast to scan it.
        </div>
      </div>
    </>
  )
}
