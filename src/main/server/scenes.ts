import qrFactory from 'qrcode-generator'
import type {
  Design, ImageElement, PackDesign, QrElement, QrKind, SceneAlign, SceneBackground, SceneElement,
  SceneFit, SceneVAlign, ShapeElement, ShapeKind, TextElement, WidgetElement, WidgetKind,
} from './types'
import { SCENE_FONTS, isSceneFontId } from './fonts'
import { buildQrData, getQrKind } from './qr-kinds'

// Designs are the one place where layout IS user data (the Designer exists to
// edit it), so the compensating controls both live here:
//   1. sanitizeDesign() — a strict whitelist; unknown fields are dropped, bad
//      values are rejected with a message, never coerced silently into markup.
//   2. renderSceneHtml() — the only way a design becomes HTML; every string is
//      escaped, every image src is re-checked against the uploads pattern, and
//      the page targets the same webOS 4 / Chrome 53 floor as the player.
// transform IS used here (scale + rotate). That is safe in scene pages because
// they never contain <video> — the player's no-transform rule exists only to
// protect the TV's hardware video plane.

const HEX = /^#[0-9a-fA-F]{6}$/
const UPLOADS_RE = /^\/uploads\/[A-Za-z0-9._-]+$/
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/

/** Every shape a design may contain. Kept beside SHAPE_POINTS below so adding
 *  a shape means touching one place, not two that can disagree. */
export const SHAPE_KINDS: ShapeKind[] = [
  'rect', 'ellipse', 'line', 'triangle', 'triangle-down', 'diamond', 'pentagon',
  'hexagon', 'star', 'burst', 'arrow-right', 'arrow-left', 'chevron',
  'banner', 'shield', 'badge',
]

export const SCENE_LIMITS = {
  minSide: 240,
  maxSide: 4096,
  maxElements: 120,
  maxTextLen: 4000,
  maxQrLen: 1200,
  maxNameLen: 80,
  coordRange: 20000,
}

type Ok<T> = { ok: true; value: T }
type Err = { ok: false; error: string }

const err = (error: string): Err => ({ ok: false, error })

function num(v: unknown, lo: number, hi: number, label: string): Ok<number> | Err {
  const n = Number(v)
  if (!Number.isFinite(n) || n < lo || n > hi) return err(`${label} must be a number between ${lo} and ${hi}`)
  return { ok: true, value: Math.round(n * 100) / 100 }
}

function hex(v: unknown, label: string): Ok<string> | Err {
  if (typeof v !== 'string' || !HEX.test(v)) return err(`${label} must be a hex colour like #3b82f6`)
  return { ok: true, value: v }
}

function hexOrNull(v: unknown, label: string): Ok<string | null> | Err {
  if (v === null || v === undefined || v === '') return { ok: true, value: null }
  return hex(v, label)
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], label: string): Ok<T> | Err {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    return err(`${label} must be one of: ${allowed.join(', ')}`)
  }
  return { ok: true, value: v as T }
}

function sanitizeBase(src: Record<string, unknown>, canvasW: number, canvasH: number) {
  const R = SCENE_LIMITS.coordRange
  const id = typeof src.id === 'string' && ID_RE.test(src.id) ? src.id : null
  if (!id) return err('element id must be 1-40 chars of letters, digits, - or _')
  const x = num(src.x, -R, R, 'x'); if (!x.ok) return x
  const y = num(src.y, -R, R, 'y'); if (!y.ok) return y
  const w = num(src.w, 1, R, 'w'); if (!w.ok) return w
  const h = num(src.h, 1, R, 'h'); if (!h.ok) return h
  const rotation = num(src.rotation ?? 0, -360, 360, 'rotation'); if (!rotation.ok) return rotation
  const opacity = num(src.opacity ?? 100, 0, 100, 'opacity'); if (!opacity.ok) return opacity
  const name = typeof src.name === 'string' ? src.name.slice(0, SCENE_LIMITS.maxNameLen) : undefined
  void canvasW; void canvasH // elements may hang off-canvas by design; the range guard above is enough
  return {
    ok: true as const,
    value: {
      id, x: x.value, y: y.value, w: w.value, h: h.value,
      rotation: rotation.value, opacity: opacity.value,
      ...(src.locked === true ? { locked: true } : {}),
      ...(name ? { name } : {}),
    },
  }
}

function sanitizeElement(input: unknown, canvasW: number, canvasH: number, idx: number): Ok<SceneElement> | Err {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const at = (msg: string) => `element ${idx + 1}: ${msg}`
  const base = sanitizeBase(src, canvasW, canvasH)
  if (!base.ok) return err(at(base.error))

  if (src.type === 'text') {
    const text = typeof src.text === 'string' ? src.text.slice(0, SCENE_LIMITS.maxTextLen) : ''
    const font = isSceneFontId(src.font) ? src.font : 'sans'
    const fontSize = num(src.fontSize ?? 48, 6, 800, 'fontSize'); if (!fontSize.ok) return err(at(fontSize.error))
    const align = oneOf<SceneAlign>(src.align ?? 'left', ['left', 'center', 'right'], 'align'); if (!align.ok) return err(at(align.error))
    const valign = oneOf<SceneVAlign>(src.valign ?? 'top', ['top', 'middle', 'bottom'], 'valign'); if (!valign.ok) return err(at(valign.error))
    const color = hex(src.color ?? '#ffffff', 'color'); if (!color.ok) return err(at(color.error))
    const lineHeight = num(src.lineHeight ?? 1.2, 0.6, 3, 'lineHeight'); if (!lineHeight.ok) return err(at(lineHeight.error))
    const letterSpacing = num(src.letterSpacing ?? 0, -10, 60, 'letterSpacing'); if (!letterSpacing.ok) return err(at(letterSpacing.error))
    const bgColor = hexOrNull(src.bgColor, 'bgColor'); if (!bgColor.ok) return err(at(bgColor.error))
    const bgOpacity = num(src.bgOpacity ?? 100, 0, 100, 'bgOpacity'); if (!bgOpacity.ok) return err(at(bgOpacity.error))
    const radius = num(src.radius ?? 0, 0, 400, 'radius'); if (!radius.ok) return err(at(radius.error))
    const el: TextElement = {
      ...base.value, type: 'text', text, font, fontSize: fontSize.value,
      bold: src.bold === true, italic: src.italic === true, underline: src.underline === true,
      align: align.value, valign: valign.value, color: color.value,
      lineHeight: lineHeight.value, letterSpacing: letterSpacing.value,
      bgColor: bgColor.value, bgOpacity: bgOpacity.value, radius: radius.value,
    }
    return { ok: true, value: el }
  }

  if (src.type === 'shape') {
    const kind = oneOf<ShapeKind>(src.kind ?? 'rect', SHAPE_KINDS, 'kind'); if (!kind.ok) return err(at(kind.error))
    const fill = hexOrNull(src.fill, 'fill'); if (!fill.ok) return err(at(fill.error))
    const fillOpacity = num(src.fillOpacity ?? 100, 0, 100, 'fillOpacity'); if (!fillOpacity.ok) return err(at(fillOpacity.error))
    const stroke = hexOrNull(src.stroke, 'stroke'); if (!stroke.ok) return err(at(stroke.error))
    const strokeWidth = num(src.strokeWidth ?? 0, 0, 120, 'strokeWidth'); if (!strokeWidth.ok) return err(at(strokeWidth.error))
    const radius = num(src.radius ?? 0, 0, 400, 'radius'); if (!radius.ok) return err(at(radius.error))
    const el: ShapeElement = {
      ...base.value, type: 'shape', kind: kind.value,
      fill: fill.value, fillOpacity: fillOpacity.value,
      stroke: stroke.value, strokeWidth: strokeWidth.value, radius: radius.value,
    }
    return { ok: true, value: el }
  }

  if (src.type === 'image') {
    let srcPath: string | null = null
    if (src.src !== null && src.src !== undefined && src.src !== '') {
      if (typeof src.src !== 'string' || !UPLOADS_RE.test(src.src)) return err(at('image src must be an uploaded file'))
      srcPath = src.src
    }
    const fit = oneOf<SceneFit>(src.fit ?? 'cover', ['contain', 'cover', 'fill'], 'fit'); if (!fit.ok) return err(at(fit.error))
    const radius = num(src.radius ?? 0, 0, 400, 'radius'); if (!radius.ok) return err(at(radius.error))
    const el: ImageElement = { ...base.value, type: 'image', src: srcPath, fit: fit.value, radius: radius.value }
    return { ok: true, value: el }
  }

  if (src.type === 'qr') {
    const fg = hex(src.fg ?? '#000000', 'fg'); if (!fg.ok) return err(at(fg.error))
    const bg = hexOrNull(src.bg ?? '#ffffff', 'bg'); if (!bg.ok) return err(at(bg.error))

    // A kind plus its fields is the source of truth when present; `data` is
    // recomputed from them so a stored payload can never drift from what the
    // Designer showed. Designs saved before kinds existed keep their payload.
    let data = typeof src.data === 'string' ? src.data.slice(0, SCENE_LIMITS.maxQrLen) : ''
    let kind: QrKind | undefined
    let fields: Record<string, string> | undefined

    if (src.kind !== undefined && src.kind !== null && src.kind !== '') {
      if (!getQrKind(String(src.kind))) return err(at('unknown QR code type'))
      kind = String(src.kind) as QrKind
      const rawFields = (src.fields && typeof src.fields === 'object' ? src.fields : {}) as Record<string, unknown>
      fields = {}
      for (const spec of getQrKind(kind)!.fields) {
        const v = rawFields[spec.key]
        fields[spec.key] = typeof v === 'string' ? v.slice(0, 400) : ''
      }
      data = buildQrData(kind, fields).slice(0, SCENE_LIMITS.maxQrLen)
    }

    const el: QrElement = {
      ...base.value, type: 'qr', data, fg: fg.value, bg: bg.value,
      ...(kind ? { kind, fields } : {}),
    }
    return { ok: true, value: el }
  }

  if (src.type === 'widget') {
    const kind = oneOf<WidgetKind>(src.kind ?? 'clock', ['clock', 'date', 'weather', 'scroll'], 'widget kind')
    if (!kind.ok) return err(at(kind.error))
    const font = isSceneFontId(src.font) ? src.font : 'inter'
    const fontSize = num(src.fontSize ?? 64, 6, 800, 'fontSize'); if (!fontSize.ok) return err(at(fontSize.error))
    const color = hex(src.color ?? '#ffffff', 'color'); if (!color.ok) return err(at(color.error))
    const align = oneOf<SceneAlign>(src.align ?? 'center', ['left', 'center', 'right'], 'align'); if (!align.ok) return err(at(align.error))
    const bgColor = hexOrNull(src.bgColor, 'bgColor'); if (!bgColor.ok) return err(at(bgColor.error))
    const bgOpacity = num(src.bgOpacity ?? 100, 0, 100, 'bgOpacity'); if (!bgOpacity.ok) return err(at(bgOpacity.error))
    const radius = num(src.radius ?? 0, 0, 400, 'radius'); if (!radius.ok) return err(at(radius.error))

    const cfg = sanitizeWidgetConfig(kind.value, src.config)
    if (!cfg.ok) return err(at(cfg.error))

    const el: WidgetElement = {
      ...base.value, type: 'widget', kind: kind.value, config: cfg.value,
      font, fontSize: fontSize.value, bold: src.bold === true, color: color.value,
      align: align.value, bgColor: bgColor.value, bgOpacity: bgOpacity.value, radius: radius.value,
    }
    return { ok: true, value: el }
  }

  return err(at('unknown element type'))
}

/** Per-kind widget settings. Small enough to keep inline; if a fifth widget
 *  arrives this wants the app framework's declarative field treatment. */
function sanitizeWidgetConfig(kind: WidgetKind, input: unknown): Ok<Record<string, unknown>> | Err {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const str = (k: string, max = 120) => String(src[k] ?? '').slice(0, max)

  if (kind === 'clock') {
    const f = String(src.format ?? '24h')
    if (!['24h', '12h', '12h-ampm'].includes(f)) return err('clock format must be 24h, 12h or 12h-ampm')
    out.format = f
    out.showSeconds = src.showSeconds === true
    out.timezoneOffset = Number.isFinite(Number(src.timezoneOffset)) ? Number(src.timezoneOffset) : null
    out.label = str('label', 40)
  } else if (kind === 'date') {
    const f = String(src.format ?? 'long')
    if (!['long', 'short', 'numeric', 'weekday'].includes(f)) return err('date format must be long, short, numeric or weekday')
    out.format = f
    out.timezoneOffset = Number.isFinite(Number(src.timezoneOffset)) ? Number(src.timezoneOffset) : null
  } else if (kind === 'weather') {
    // Points at a configured Weather app rather than duplicating its settings:
    // one place to set the location, one fetch, one cache.
    const id = str('appInstanceId', 60)
    if (id && !/^[A-Za-z0-9-]{1,60}$/.test(id)) return err('weather widget has a bad app reference')
    out.appInstanceId = id
    const show = String(src.show ?? 'temp')
    if (!['temp', 'temp-icon', 'full'].includes(show)) return err('weather widget show must be temp, temp-icon or full')
    out.show = show
  } else {
    const text = String(src.text ?? '').slice(0, SCENE_LIMITS.maxTextLen)
    const speed = Number(src.speed ?? 10)
    if (!Number.isFinite(speed) || speed < 1 || speed > 20) return err('scroll speed must be 1–20')
    out.text = text
    out.speed = Math.round(speed)
    out.direction = src.direction === 'right' ? 'right' : 'left'
  }
  return { ok: true, value: out }
}

function sanitizeBackground(input: unknown): Ok<SceneBackground> | Err {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const color = hex(src.color ?? '#0f172a', 'background color'); if (!color.ok) return color
  const bg: SceneBackground = { color: color.value }
  if (src.gradient && typeof src.gradient === 'object') {
    const g = src.gradient as Record<string, unknown>
    const from = hex(g.from, 'gradient from'); if (!from.ok) return from
    const to = hex(g.to, 'gradient to'); if (!to.ok) return to
    const angle = num(g.angle ?? 180, 0, 360, 'gradient angle'); if (!angle.ok) return angle
    bg.gradient = { from: from.value, to: to.value, angle: Math.round(angle.value) }
  }
  if (src.imagePath !== undefined && src.imagePath !== null && src.imagePath !== '') {
    if (typeof src.imagePath !== 'string' || !UPLOADS_RE.test(src.imagePath)) {
      return err('background image must be an uploaded file')
    }
    bg.imagePath = src.imagePath
    const fit = oneOf<SceneFit>(src.imageFit ?? 'cover', ['contain', 'cover', 'fill'], 'background imageFit')
    if (!fit.ok) return fit
    bg.imageFit = fit.value
  }
  return { ok: true, value: bg }
}

/** Validates an operator-supplied (or pack-supplied) design body. Returns a
 *  clean PackDesign — identity and timestamps are the caller's business. */
export function sanitizeDesign(input: unknown): { ok: true; design: PackDesign } | Err {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

  const name = typeof src.name === 'string' ? src.name.trim().slice(0, SCENE_LIMITS.maxNameLen) : ''
  if (!name) return err('Design name is required')

  const width = num(src.width ?? 1920, SCENE_LIMITS.minSide, SCENE_LIMITS.maxSide, 'width'); if (!width.ok) return width
  const height = num(src.height ?? 1080, SCENE_LIMITS.minSide, SCENE_LIMITS.maxSide, 'height'); if (!height.ok) return height
  const w = Math.round(width.value), h = Math.round(height.value)

  const background = sanitizeBackground(src.background); if (!background.ok) return background

  const rawElements = Array.isArray(src.elements) ? src.elements : []
  if (rawElements.length > SCENE_LIMITS.maxElements) {
    return err(`A design can hold at most ${SCENE_LIMITS.maxElements} elements`)
  }
  const elements: SceneElement[] = []
  const seen = new Set<string>()
  for (let i = 0; i < rawElements.length; i++) {
    const clean = sanitizeElement(rawElements[i], w, h, i)
    if (!clean.ok) return clean
    if (seen.has(clean.value.id)) return err(`element ${i + 1}: duplicate id "${clean.value.id}"`)
    seen.add(clean.value.id)
    elements.push(clean.value)
  }

  const design: PackDesign = { name, width: w, height: h, background: background.value, elements }
  if (typeof src.category === 'string' && /^[a-z0-9-]{1,40}$/.test(src.category)) design.category = src.category
  if (typeof src.templateKey === 'string' && ID_RE.test(src.templateKey)) design.templateKey = src.templateKey
  return { ok: true, design }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** A CSS declaration block, safe inside style="…".
 *
 *  Font stacks contain double quotes — 'Inter', Arial becomes "Inter", Arial —
 *  and an unescaped one closes the attribute early, silently throwing away
 *  every declaration after it. That turned every bundled font into a default
 *  serif at default size on real screens, while the React canvas (which sets
 *  styles as properties, not markup) showed it correctly. */
function styleAttr(css: string): string {
  return css.replace(/"/g, '&quot;')
}

function rgba(hexColor: string, pct: number): string {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hexColor)
  if (!m) return 'transparent'
  if (pct >= 100) return hexColor
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${(pct / 100).toFixed(3)})`
}

/** A QR symbol as inline SVG. Shared with the apps subsystem — anything that
 *  puts a scannable code on a screen goes through here. Returns '' when the
 *  data is too long to encode, so a caller draws nothing rather than breaking. */
export function buildQrSvg(data: string, fg = '#000000', bg: string | null = '#ffffff'): string {
  let qr
  try {
    qr = qrFactory(0, 'M')
    qr.addData(data || ' ')
    qr.make()
  } catch {
    return ''
  }
  const n = qr.getModuleCount()
  const cells: string[] = []
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) cells.push(`M${c} ${r}h1v1h-1z`)
    }
  }
  const bgRect = bg ? `<rect width="${n}" height="${n}" fill="${bg}"/>` : ''
  // shape-rendering keeps module edges crisp when the TV scales the stage.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">${bgRect}<path d="${cells.join('')}" fill="${fg}"/></svg>`
}

function qrSvg(el: QrElement): string {
  return buildQrSvg(el.data, el.fg, el.bg)
}

/** The geometry of every shape, as points on a 0..1 grid so one definition
 *  stretches to any box. Shared with the Designer's canvas, which draws the
 *  same paths — a shape that previewed one way must not print another. */
export const SHAPE_POINTS: Record<string, number[][]> = {
  'triangle':      [[0.5, 0], [1, 1], [0, 1]],
  'triangle-down': [[0, 0], [1, 0], [0.5, 1]],
  'diamond':       [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  'pentagon':      [[0.5, 0], [1, 0.38], [0.81, 1], [0.19, 1], [0, 0.38]],
  'hexagon':       [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  'star':          [[0.5, 0], [0.61, 0.35], [0.98, 0.35], [0.68, 0.57], [0.79, 0.91],
                    [0.5, 0.7], [0.21, 0.91], [0.32, 0.57], [0.02, 0.35], [0.39, 0.35]],
  'burst':         [[0.5, 0], [0.6, 0.16], [0.78, 0.09], [0.79, 0.28], [0.97, 0.32],
                    [0.86, 0.47], [0.99, 0.61], [0.81, 0.68], [0.83, 0.87], [0.65, 0.83],
                    [0.56, 1], [0.42, 0.88], [0.26, 0.96], [0.23, 0.78], [0.05, 0.74],
                    [0.14, 0.58], [0.01, 0.45], [0.18, 0.36], [0.14, 0.18], [0.33, 0.2]],
  'arrow-right':   [[0, 0.28], [0.6, 0.28], [0.6, 0.05], [1, 0.5], [0.6, 0.95], [0.6, 0.72], [0, 0.72]],
  'arrow-left':    [[1, 0.28], [0.4, 0.28], [0.4, 0.05], [0, 0.5], [0.4, 0.95], [0.4, 0.72], [1, 0.72]],
  'chevron':       [[0, 0], [0.55, 0], [1, 0.5], [0.55, 1], [0, 1], [0.45, 0.5]],
  'banner':        [[0, 0], [1, 0], [1, 1], [0.5, 0.78], [0, 1]],
  'shield':        [[0.5, 0], [1, 0.16], [1, 0.6], [0.5, 1], [0, 0.6], [0, 0.16]],
  'badge':         [[0.5, 0], [0.66, 0.11], [0.86, 0.09], [0.92, 0.28], [1, 0.44],
                    [0.88, 0.6], [0.9, 0.8], [0.71, 0.86], [0.58, 1], [0.4, 0.94],
                    [0.2, 0.97], [0.13, 0.79], [0, 0.66], [0.1, 0.48], [0.05, 0.28], [0.24, 0.19], [0.34, 0.03]],
}

function shapeSvg(el: ShapeElement): string {
  const w = Math.max(1, el.w), h = Math.max(1, el.h)
  const fill = el.fill ? rgba(el.fill, el.fillOpacity) : 'none'
  const hasStroke = !!el.stroke && el.strokeWidth > 0
  const stroke = hasStroke ? ` stroke="${el.stroke}" stroke-width="${el.strokeWidth}" stroke-linejoin="round"` : ''
  const inset = hasStroke ? el.strokeWidth / 2 : 0
  let body = ''

  if (el.kind === 'rect') {
    body = `<rect x="${inset}" y="${inset}" width="${w - inset * 2}" height="${h - inset * 2}" rx="${el.radius}" fill="${fill}"${stroke}/>`
  } else if (el.kind === 'ellipse') {
    body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(0.5, w / 2 - inset)}" ry="${Math.max(0.5, h / 2 - inset)}" fill="${fill}"${stroke}/>`
  } else if (el.kind === 'line') {
    // Horizontal through the middle; rotate the element to angle it.
    const sw = Math.max(1, el.strokeWidth || 4)
    body = `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="${el.stroke ?? el.fill ?? '#ffffff'}" stroke-width="${sw}" stroke-linecap="round"/>`
  } else {
    const pts = SHAPE_POINTS[el.kind] ?? SHAPE_POINTS.triangle
    const iw = w - inset * 2, ih = h - inset * 2
    const points = pts.map(([px, py]) => `${(inset + px * iw).toFixed(2)},${(inset + py * ih).toFixed(2)}`).join(' ')
    body = `<polygon points="${points}" fill="${fill}"${stroke}/>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" preserveAspectRatio="none">${body}</svg>`
}

function elementHtml(el: SceneElement, zIndex: number): string {
  const rot = el.rotation ? `transform:rotate(${el.rotation}deg);` : ''
  const style =
    `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;` +
    `z-index:${zIndex};opacity:${(el.opacity / 100).toFixed(3)};${rot}`

  if (el.type === 'text') {
    const font = SCENE_FONTS[el.font] ?? SCENE_FONTS.sans
    const vAlign = el.valign === 'top' ? 'flex-start' : el.valign === 'bottom' ? 'flex-end' : 'center'
    const band = el.bgColor ? `background:${rgba(el.bgColor, el.bgOpacity)};border-radius:${el.radius}px;` : ''
    const deco = el.underline ? 'text-decoration:underline;' : ''
    const inner =
      `width:100%;text-align:${el.align};color:${el.color};` +
      `font-family:${font.css};font-size:${el.fontSize}px;` +
      `font-weight:${el.bold ? '700' : '400'};font-style:${el.italic ? 'italic' : 'normal'};${deco}` +
      `line-height:${el.lineHeight};letter-spacing:${el.letterSpacing}px;` +
      'white-space:pre-wrap;word-wrap:break-word;'
    const text = escapeHtml(el.text)
    return `<div style="${styleAttr(style)}display:flex;align-items:${vAlign};${band}"><div style="${styleAttr(inner)}">${text}</div></div>`
  }

  if (el.type === 'shape') {
    return `<div style="${style}">${shapeSvg(el)}</div>`
  }

  if (el.type === 'image') {
    // Placeholders (no src) are invisible on screens; re-check the src pattern
    // at render time so a hand-edited db.json still can't point elsewhere.
    if (!el.src || !UPLOADS_RE.test(el.src)) return ''
    const radius = el.radius ? `border-radius:${el.radius}px;` : ''
    return `<div style="${style}overflow:hidden;${radius}"><img src="${escapeHtml(el.src)}" alt="" style="width:100%;height:100%;object-fit:${el.fit};display:block"></div>`
  }

  if (el.type === 'widget') {
    const w = el as WidgetElement
    const font = SCENE_FONTS[w.font] ?? SCENE_FONTS.inter
    const band = w.bgColor ? `background:${rgba(w.bgColor, w.bgOpacity)};border-radius:${w.radius}px;` : ''
    const inner =
      `width:100%;text-align:${w.align};color:${w.color};font-family:${font.css};` +
      `font-size:${w.fontSize}px;font-weight:${w.bold ? '700' : '400'};line-height:1.15;` +
      'white-space:pre-wrap;word-wrap:break-word;overflow:hidden'
    // The element carries its own settings; one script below drives every
    // widget on the page, so a design with six clocks still ships one loop.
    return `<div style="${styleAttr(style)}display:flex;align-items:center;${band}overflow:hidden" ` +
      `data-widget="${escapeHtml(w.kind)}" data-config="${escapeHtml(JSON.stringify(w.config))}">` +
      `<div style="${styleAttr(inner)}"></div></div>`
  }

  // qr
  return `<div style="${style}">${qrSvg(el)}</div>`
}

/** Drives every live element on a scene page. ES5, and silent about failure:
 *  a widget that cannot reach the manager keeps whatever it last drew. */
const WIDGET_RUNTIME = `
(function(){
  var nodes = document.querySelectorAll('[data-widget]');
  if (!nodes.length) return;
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var items = [];

  function pad2(n){ return (n < 10 ? '0' : '') + n; }
  function esc(s){
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function nowIn(offset){
    var d = new Date();
    if (offset === null || offset === undefined) return d;
    return new Date(d.getTime() + d.getTimezoneOffset() * 60000 + offset * 1000);
  }

  for (var i = 0; i < nodes.length; i++) {
    var cfg = {};
    try { cfg = JSON.parse(nodes[i].getAttribute('data-config') || '{}'); } catch (e) {}
    items.push({ el: nodes[i], inner: nodes[i].firstChild, kind: nodes[i].getAttribute('data-widget'), cfg: cfg });
  }

  function drawClock(it){
    var d = nowIn(it.cfg.timezoneOffset);
    var h = d.getHours(), suffix = '';
    if (it.cfg.format === '12h' || it.cfg.format === '12h-ampm') {
      suffix = it.cfg.format === '12h-ampm' ? (h >= 12 ? ' PM' : ' AM') : '';
      h = h % 12; if (h === 0) h = 12;
    } else {
      h = pad2(h);
    }
    var t = h + ':' + pad2(d.getMinutes()) + (it.cfg.showSeconds ? ':' + pad2(d.getSeconds()) : '') + suffix;
    it.inner.innerHTML = (it.cfg.label ? esc(it.cfg.label) + ' ' : '') + esc(t);
  }

  function drawDate(it){
    var d = nowIn(it.cfg.timezoneOffset), out;
    if (it.cfg.format === 'short') out = MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    else if (it.cfg.format === 'numeric') out = pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
    else if (it.cfg.format === 'weekday') out = DAYS[d.getDay()];
    else out = DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
    it.inner.innerHTML = esc(out);
  }

  function drawScroll(it){
    if (it.started) return;
    it.started = true;
    var span = document.createElement('span');
    span.style.display = 'inline-block';
    span.style.whiteSpace = 'nowrap';
    span.innerHTML = esc(it.cfg.text || '');
    it.inner.innerHTML = '';
    it.inner.style.whiteSpace = 'nowrap';
    it.inner.appendChild(span);
    var w = it.el.offsetWidth;
    var x = it.cfg.direction === 'right' ? -span.offsetWidth : w;
    var step = (Number(it.cfg.speed) || 10) / 8;
    function tick(){
      x += it.cfg.direction === 'right' ? step : -step;
      if (it.cfg.direction === 'right' && x > w) x = -span.offsetWidth;
      if (it.cfg.direction !== 'right' && x < -span.offsetWidth) x = w;
      span.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* Weather reads a configured Weather app's cache rather than fetching for
     itself, so a design and a weather board on the same wall agree, and the
     manager still makes one request. */
  function drawWeather(it){
    if (!it.cfg.appInstanceId) { it.inner.innerHTML = 'Weather'; return; }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/tv/app/' + it.cfg.appInstanceId + '/data?t=' + Date.now(), true);
    xhr.timeout = 15000;
    xhr.onreadystatechange = function(){
      if (xhr.readyState !== 4 || xhr.status < 200 || xhr.status >= 300) return;
      try {
        var w = JSON.parse(xhr.responseText).data;
        if (!w) return;
        var t = w.temp + '\\u00b0';
        if (it.cfg.show === 'temp') it.inner.innerHTML = esc(t);
        else if (it.cfg.show === 'temp-icon') it.inner.innerHTML = esc(t + ' ' + w.condition);
        else it.inner.innerHTML = esc(w.place + '  ' + t + '  ' + w.condition);
      } catch (e) {}
    };
    xhr.send();
  }

  function tickAll(){
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.kind === 'clock') drawClock(it);
      else if (it.kind === 'date') drawDate(it);
      else if (it.kind === 'scroll') drawScroll(it);
    }
  }
  function weatherAll(){
    for (var i = 0; i < items.length; i++) if (items[i].kind === 'weather') drawWeather(items[i]);
  }

  tickAll(); weatherAll();
  setInterval(tickAll, 1000);
  setInterval(weatherAll, 300000);
})();
`

/** Renders a design as a self-contained TV-safe page. ES5 only, no CSS vars,
 *  no grid, no flex gap, no inset — the same Chrome 53 floor as the player. */
export function renderSceneHtml(design: Design | (PackDesign & { id?: string }), fontCss: string): string {
  const bg = design.background
  const gradient = bg.gradient
    ? `background-image:linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.from}, ${bg.gradient.to});`
    : ''
  const bgImage = bg.imagePath && UPLOADS_RE.test(bg.imagePath)
    ? `<img src="${escapeHtml(bg.imagePath)}" alt="" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:${bg.imageFit || 'cover'};display:block">`
    : ''

  const parts: string[] = []
  for (let i = 0; i < design.elements.length; i++) {
    parts.push(elementHtml(design.elements[i], i + 1))
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(design.name)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:${bg.color}}
/* The stage is the design's own pixel space; a single scale transform fits it
   to any panel. Safe here — scene pages never contain video, so the player's
   no-transform rule does not apply. */
#stage{position:absolute;left:0;top:0;width:${design.width}px;height:${design.height}px;background:${bg.color};${gradient}overflow:hidden}
${fontCss}
</style>
</head>
<body>
<div id="stage">
${bgImage}
${parts.join('\n')}
</div>
<script>
(function(){
  'use strict';
  var W = ${design.width}, H = ${design.height};
  var stage = document.getElementById('stage');
  function fit(){
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.min(vw / W, vh / H);
    stage.style.transform = 'scale(' + s + ')';
    stage.style.transformOrigin = '0 0';
    stage.style.left = Math.round((vw - W * s) / 2) + 'px';
    stage.style.top  = Math.round((vh - H * s) / 2) + 'px';
  }
  window.addEventListener('resize', fit);
  fit();
})();
${design.elements.some(e => e.type === 'widget') ? WIDGET_RUNTIME : ''}
</script>
</body>
</html>`
}
