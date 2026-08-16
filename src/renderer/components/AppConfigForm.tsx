import { useMemo, useState } from 'react'
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

function Control({ field, value, onChange }: {
  field: AppField
  value: unknown
  onChange: (v: unknown) => void
}) {
  switch (field.type) {
    case 'note':
      return null

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

function Row({ field, config, onChange }: {
  field: AppField
  config: Config
  onChange: (key: string, v: unknown) => void
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
        <Control field={field} value={config[field.key]} onChange={v => onChange(field.key, v)} />
        {field.help && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{field.help}</div>}
      </div>
    )
  }

  return (
    <div className="form-group">
      <label className="form-label">
        {field.label}{field.required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      <Control field={field} value={config[field.key]} onChange={v => onChange(field.key, v)} />
      {field.help && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{field.help}</div>}
    </div>
  )
}

export function AppConfigForm({ fields, config, onChange }: {
  fields: AppField[]
  config: Config
  onChange: (next: Config) => void
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const set = (key: string, v: unknown) => onChange({ ...config, [key]: v })

  const { basic, advanced } = useMemo(() => ({
    basic: fields.filter(f => !f.advanced && visible(f, config)),
    advanced: fields.filter(f => f.advanced && visible(f, config)),
  }), [fields, config])

  return (
    <div>
      {basic.map(f => <Row key={f.key} field={f} config={config} onChange={set} />)}

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
              {advanced.map(f => <Row key={f.key} field={f} config={config} onChange={set} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
