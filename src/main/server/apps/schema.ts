import type { AppDefinition, AppField } from './types'

// One validator for every app's settings.
//
// Config arrives from the renderer and ends up interpolated into a page a TV
// loads, so it gets the same treatment as a design: a strict whitelist, driven
// by the field declarations. Anything an app did not declare is dropped rather
// than stored — an app cannot forget to validate a field it never declared,
// which is the whole point of declaring them as data.

const HEX = /^#[0-9a-fA-F]{6}$/

type Ok = { ok: true; config: Record<string, unknown> }
type Err = { ok: false; error: string }

/** Fields hidden by their showIf condition are not required and not stored —
 *  a Custom-only colour must not block saving while Light theme is selected. */
function isVisible(field: AppField, config: Record<string, unknown>): boolean {
  if (!field.showIf) return true
  const actual = config[field.showIf.key]
  return field.showIf.equals.some(v => v === actual)
}

function coerce(field: AppField, raw: unknown): { ok: true; value: unknown } | Err {
  const label = field.label

  switch (field.type) {
    case 'note':
      return { ok: true, value: undefined }

    case 'checkbox':
      return { ok: true, value: raw === true || raw === 'true' }

    case 'number':
    case 'slider': {
      const n = Number(raw)
      if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number` }
      const min = field.min ?? -1e9
      const max = field.max ?? 1e9
      if (n < min || n > max) return { ok: false, error: `${label} must be between ${min} and ${max}` }
      return { ok: true, value: field.step && field.step < 1 ? Math.round(n * 100) / 100 : Math.round(n) }
    }

    case 'color':
      if (typeof raw !== 'string' || !HEX.test(raw)) {
        return { ok: false, error: `${label} must be a colour like #3b82f6` }
      }
      return { ok: true, value: raw }

    case 'select': {
      const allowed = (field.options ?? []).map(o => o.value)
      if (typeof raw !== 'string' || !allowed.includes(raw)) {
        return { ok: false, error: `${label} must be one of: ${allowed.join(', ')}` }
      }
      return { ok: true, value: raw }
    }

    case 'url': {
      const s = String(raw ?? '').trim()
      if (!s) return { ok: true, value: '' }
      // A rendered page turns this into an href or an iframe src, so only the
      // two schemes that make sense there are allowed — never javascript: or
      // data:, which would otherwise execute in the player's origin.
      if (!/^https?:\/\/[^\s<>"']+$/i.test(s)) {
        return { ok: false, error: `${label} must be a web address starting with http:// or https://` }
      }
      if (s.length > 2000) return { ok: false, error: `${label} is too long` }
      return { ok: true, value: s }
    }

    case 'connection':
      // The connection itself lives outside config; the field is a UI affordance.
      return { ok: true, value: undefined }

    case 'image': {
      const s = String(raw ?? '').trim()
      if (!s) return { ok: true, value: '' }
      // Only files this manager holds. A page renders these into an <img>, and
      // an off-server URL would break the moment the screen loses its WAN —
      // which is the one thing a picture on a wall must not do.
      if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(s)) {
        return { ok: false, error: `${label} must be a picture uploaded to this app` }
      }
      return { ok: true, value: s }
    }

    case 'text':
    case 'textarea':
    default: {
      const s = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw)
      const max = field.maxLength ?? (field.type === 'textarea' ? 2000 : 200)
      if (s.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer` }
      return { ok: true, value: s }
    }
  }
}

/** Validates raw config against an app's declared fields. */
export function sanitizeAppConfig(def: AppDefinition, input: unknown): Ok | Err {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const config: Record<string, unknown> = {}

  // Two passes: defaults first, so a showIf can read a value the operator did
  // not send. Otherwise a conditional field would evaluate against nothing.
  for (const field of def.fields) {
    if (field.type === 'note' || field.type === 'connection') continue
    config[field.key] = src[field.key] !== undefined ? src[field.key] : field.default
  }

  for (const field of def.fields) {
    if (field.type === 'note' || field.type === 'connection') { delete config[field.key]; continue }

    if (!isVisible(field, config)) { delete config[field.key]; continue }

    const raw = config[field.key]
    if (raw === undefined || raw === '') {
      if (field.required && field.type !== 'checkbox') {
        return { ok: false, error: `${field.label} is required` }
      }
      config[field.key] = field.default !== undefined ? field.default : (field.type === 'checkbox' ? false : '')
      // A default still has to be a legal value.
      if (config[field.key] === undefined || config[field.key] === '') continue
    }

    const out = coerce(field, config[field.key])
    if (!out.ok) return out
    if (out.value === undefined) delete config[field.key]
    else config[field.key] = out.value
  }

  const crossField = def.validate?.(config)
  if (crossField) return { ok: false, error: crossField }

  return { ok: true, config }
}

/** The fields the renderer needs to draw the form. Sent as-is over the API. */
export function publicDefinition(def: AppDefinition) {
  return {
    id: def.id,
    name: def.name,
    icon: def.icon,
    description: def.description,
    category: def.category,
    provider: def.provider,
    defaultDuration: def.defaultDuration,
    fields: def.fields,
  }
}
