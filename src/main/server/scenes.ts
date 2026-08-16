import qrFactory from 'qrcode-generator'
import type {
  Design, ImageElement, PackDesign, QrElement, SceneAlign, SceneBackground, SceneElement,
  SceneFit, SceneVAlign, ShapeElement, ShapeKind, TextElement,
} from './types'
import { SCENE_FONTS, isSceneFontId } from './fonts'

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
    const kind = oneOf<ShapeKind>(src.kind ?? 'rect', ['rect', 'ellipse', 'triangle', 'line'], 'kind'); if (!kind.ok) return err(at(kind.error))
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
    const data = typeof src.data === 'string' ? src.data.slice(0, SCENE_LIMITS.maxQrLen) : ''
    const fg = hex(src.fg ?? '#000000', 'fg'); if (!fg.ok) return err(at(fg.error))
    const bg = hexOrNull(src.bg ?? '#ffffff', 'bg'); if (!bg.ok) return err(at(bg.error))
    const el: QrElement = { ...base.value, type: 'qr', data, fg: fg.value, bg: bg.value }
    return { ok: true, value: el }
  }

  return err(at('unknown element type'))
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

function shapeSvg(el: ShapeElement): string {
  const w = Math.max(1, el.w), h = Math.max(1, el.h)
  const fill = el.fill ? rgba(el.fill, el.fillOpacity) : 'none'
  const stroke = el.stroke && el.strokeWidth > 0 ? ` stroke="${el.stroke}" stroke-width="${el.strokeWidth}"` : ''
  const inset = el.stroke && el.strokeWidth > 0 ? el.strokeWidth / 2 : 0
  let body = ''
  if (el.kind === 'rect') {
    body = `<rect x="${inset}" y="${inset}" width="${w - inset * 2}" height="${h - inset * 2}" rx="${el.radius}" fill="${fill}"${stroke}/>`
  } else if (el.kind === 'ellipse') {
    body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - inset}" ry="${h / 2 - inset}" fill="${fill}"${stroke}/>`
  } else if (el.kind === 'triangle') {
    body = `<polygon points="${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}" fill="${fill}"${stroke}/>`
  } else {
    // line: horizontal through the middle of the box; rotate the element to angle it
    const sw = Math.max(1, el.strokeWidth || 4)
    body = `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="${el.stroke ?? el.fill ?? '#ffffff'}" stroke-width="${sw}"/>`
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
    return `<div style="${style}display:flex;align-items:${vAlign};${band}"><div style="${inner}">${text}</div></div>`
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

  // qr
  return `<div style="${style}">${qrSvg(el)}</div>`
}

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
</script>
</body>
</html>`
}
