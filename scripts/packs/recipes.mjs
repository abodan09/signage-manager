/* Layout recipes for the template packs.
 *
 * A recipe turns a compact content spec into a Design document. Templates are
 * therefore content (a catalog entry) plus a chosen layout, not 220 hand-drawn
 * JSON files â€” a fix to a recipe improves every template that uses it, and the
 * catalog stays readable.
 *
 * Everything is computed from the canvas size, so the same recipe emits a
 * landscape (1920x1080) or portrait (1080x1920) design without a second path.
 * Emitted objects are deliberately sparse: sanitizeDesign() on the server fills
 * every default, and it is the only thing that decides what a valid design is.
 */

export const LANDSCAPE = { width: 1920, height: 1080 }
export const PORTRAIT = { width: 1080, height: 1920 }

// â”€â”€ element factories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let seq = 0
const nid = (p) => `${p}${++seq}`
export const resetIds = () => { seq = 0 }

export function text(o) {
  return {
    id: o.id || nid('t'), type: 'text',
    x: r(o.x), y: r(o.y), w: r(o.w), h: r(o.h),
    text: o.text ?? '',
    font: o.font || 'inter',
    fontSize: r(o.size ?? 48),
    bold: !!o.bold, italic: !!o.italic,
    align: o.align || 'left',
    valign: o.valign || 'middle',
    color: o.color || '#ffffff',
    lineHeight: o.lineHeight ?? 1.15,
    letterSpacing: o.tracking ?? 0,
    ...(o.bg ? { bgColor: o.bg, bgOpacity: o.bgOpacity ?? 100, radius: r(o.radius ?? 0) } : {}),
    ...(o.rotation ? { rotation: o.rotation } : {}),
    ...(o.opacity !== undefined ? { opacity: o.opacity } : {}),
  }
}

export function rect(o) {
  return {
    id: o.id || nid('s'), type: 'shape', kind: o.kind || 'rect',
    x: r(o.x), y: r(o.y), w: r(o.w), h: r(o.h),
    fill: o.fill ?? null,
    fillOpacity: o.fillOpacity ?? 100,
    ...(o.stroke ? { stroke: o.stroke, strokeWidth: r(o.strokeWidth ?? 3) } : {}),
    ...(o.radius ? { radius: r(o.radius) } : {}),
    ...(o.rotation ? { rotation: o.rotation } : {}),
    ...(o.opacity !== undefined ? { opacity: o.opacity } : {}),
  }
}

/** Image placeholders ship with src:null â€” the operator drops their own photo
 *  in. On a screen a placeholder renders as nothing, never as a broken frame. */
export function img(o) {
  return {
    id: o.id || nid('i'), type: 'image',
    x: r(o.x), y: r(o.y), w: r(o.w), h: r(o.h),
    src: null, fit: o.fit || 'cover',
    ...(o.radius ? { radius: r(o.radius) } : {}),
    ...(o.opacity !== undefined ? { opacity: o.opacity } : {}),
  }
}

export function qr(o) {
  return {
    id: o.id || nid('q'), type: 'qr',
    x: r(o.x), y: r(o.y), w: r(o.w), h: r(o.h),
    data: o.data || 'https://example.com',
    fg: o.fg || '#0f172a', bg: o.bg === null ? null : (o.bg || '#ffffff'),
  }
}

const r = (n) => Math.round(n)

// â”€â”€ palettes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** bg/bg2 set the mood, accent carries calls to action, band is the scrim used
 *  over photography. Each category picks a few so its 20+ templates do not all
 *  look like the same poster. */
export const PALETTES = {
  charcoal:  { bg: '#111827', bg2: '#1f2937', accent: '#f59e0b', accent2: '#fbbf24', text: '#ffffff', dim: '#9ca3af', band: '#000000' },
  espresso:  { bg: '#1c1310', bg2: '#2d201a', accent: '#d97706', accent2: '#f59e0b', text: '#fdf6ec', dim: '#c8b6a6', band: '#120c09' },
  crimson:   { bg: '#1a0d0f', bg2: '#2b1216', accent: '#dc2626', accent2: '#f87171', text: '#ffffff', dim: '#d6b3b6', band: '#12080a' },
  forest:    { bg: '#0f1f16', bg2: '#16301f', accent: '#22c55e', accent2: '#4ade80', text: '#f0fdf4', dim: '#a7c4b2', band: '#08140d' },
  ocean:     { bg: '#0b1f33', bg2: '#123354', accent: '#38bdf8', accent2: '#7dd3fc', text: '#f0f9ff', dim: '#a3c2da', band: '#061525' },
  indigo:    { bg: '#141032', bg2: '#221b52', accent: '#818cf8', accent2: '#a5b4fc', text: '#f5f3ff', dim: '#b3aed6', band: '#0c0920' },
  slate:     { bg: '#0f172a', bg2: '#1e293b', accent: '#3b82f6', accent2: '#60a5fa', text: '#f8fafc', dim: '#94a3b8', band: '#020617' },
  clinical:  { bg: '#f8fafc', bg2: '#e2e8f0', accent: '#0891b2', accent2: '#06b6d4', text: '#0f172a', dim: '#475569', band: '#ffffff' },
  paper:     { bg: '#faf7f2', bg2: '#efe7db', accent: '#b45309', accent2: '#d97706', text: '#1c1917', dim: '#57534e', band: '#ffffff' },
  mono:      { bg: '#ffffff', bg2: '#f1f5f9', accent: '#111827', accent2: '#374151', text: '#111827', dim: '#6b7280', band: '#ffffff' },
  amber:     { bg: '#231a06', bg2: '#3a2b0a', accent: '#facc15', accent2: '#fde047', text: '#fffbeb', dim: '#d6c69a', band: '#171003' },
  violet:    { bg: '#1a0b2e', bg2: '#2b1247', accent: '#c084fc', accent2: '#d8b4fe', text: '#faf5ff', dim: '#c4b0d6', band: '#100619' },
  teal:      { bg: '#062b2b', bg2: '#0b4141', accent: '#2dd4bf', accent2: '#5eead4', text: '#f0fdfa', dim: '#9dc9c4', band: '#031c1c' },
  rose:      { bg: '#2a0f1b', bg2: '#3f1728', accent: '#fb7185', accent2: '#fda4af', text: '#fff1f2', dim: '#d9adb8', band: '#1a0810' },
  steel:     { bg: '#18202b', bg2: '#232e3d', accent: '#f97316', accent2: '#fb923c', text: '#f1f5f9', dim: '#94a3b8', band: '#0d131b' },
  sand:      { bg: '#2b2418', bg2: '#3f3625', accent: '#eab308', accent2: '#facc15', text: '#fefce8', dim: '#cbbe9a', band: '#1a1610' },
}

function bgOf(p, spec) {
  const bg = { color: p.bg }
  if (spec.gradient !== false) bg.gradient = { from: p.bg, to: p.bg2, angle: spec.angle ?? 160 }
  return bg
}

/** The type unit.
 *
 *  Sizes used to be fractions of canvas HEIGHT, which reads correctly at
 *  1920x1080 and then blows up at 1080x1920: height grows by 1.78x while the
 *  width available to hold the words shrinks, so portrait headlines wrapped
 *  three deep and ran off the bottom. min(W,H) is 1080 in both orientations,
 *  so one fraction now means the same physical size either way round.
 *
 *  Rule: U for anything with a size (type, box heights, QR blocks, bars);
 *  H and W stay for POSITIONS, which genuinely do differ per orientation. */
const unit = (W, H) => Math.min(W, H)

/** Vertical rhythm for the list recipes. Rows are fitted to the space actually
 *  available so a nine-row portrait board and a five-row landscape one both
 *  fill their canvas, and the type is then derived from the row â€” which is what
 *  makes overflow structurally impossible rather than merely unlikely. */
function fitRows(count, available, { min, max, gapFactor = 1 }) {
  const pitch = Math.max(min, Math.min(max, available / Math.max(1, count * gapFactor)))
  return pitch
}

/** Clamp a box so it cannot start or end outside the canvas. */
function within(x, size, limit, margin = 0) {
  return Math.max(margin, Math.min(limit - size - margin, x))
}

/** Mean advance width per character, as a fraction of font size. Close enough
 *  to choose a size that fits; the browser still does the real line breaking. */
const ADVANCE = {
  bebas: 0.42, oswald: 0.45, 'sans-narrow': 0.44,
  inter: 0.52, sans: 0.52, mono: 0.6,
  playfair: 0.5, 'roboto-slab': 0.53, serif: 0.5, pacifico: 0.46,
}

function linesAt(str, size, w, font, tracking = 0) {
  const adv = (ADVANCE[font] ?? 0.52) * size + tracking
  const perLine = Math.max(1, Math.floor(w / Math.max(1, adv)))
  return String(str ?? '').split('\n')
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0)
}

/** The largest size at or below `size` whose wrapped text fits in h.
 *  Copy varies far more than layout does, so a template with a long sentence
 *  tightens its own type instead of spilling out of the box. */
function fitSize(str, w, h, { font = 'inter', size, lineHeight = 1.3, min }) {
  const floor = min ?? size * 0.6
  let s = size
  while (s > floor && linesAt(str, s, w, font) * s * lineHeight > h) s -= 1
  return Math.max(floor, Math.round(s))
}

// â”€â”€ shared parts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** The accent rule under a headline â€” the single most reused piece of furniture
 *  in the catalog, so it lives in one place. */
function rule(p, { x, y, w, h = 8, color }) {
  return rect({ x, y, w, h, fill: color || p.accent, radius: h / 2 })
}

function footerBar(p, W, H, spec) {
  if (!spec.footer) return []
  const h = Math.round(unit(W, H) * 0.085)
  return [
    rect({ x: 0, y: H - h, w: W, h, fill: p.accent }),
    text({
      x: W * 0.06, y: H - h, w: W * 0.88, h,
      text: spec.footer, size: h * 0.3, font: 'inter', bold: true,
      color: contrastOn(p.accent), align: 'center', tracking: 2,
    }),
  ]
}

/** Height the footer occupies, so flowing recipes stop above it. */
const footerH = (W, H, spec) => (spec.footer ? Math.round(unit(W, H) * 0.085) : 0)

/** Black or white text on an accent block, by luminance â€” a yellow band with
 *  white text is unreadable at 4 m, which is the only distance that matters. */
export function contrastOn(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return '#ffffff'
  const [r_, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16) / 255)
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r_) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.45 ? '#111827' : '#ffffff'
}

function qrBlock(p, W, H, spec, { x, y, size }) {
  if (!spec.qr) return []
  const label = spec.qrLabel || 'Scan me'
  // A QR that hangs off the panel is a QR nobody can scan, so the block is
  // clamped into the canvas whatever the caller asked for.
  const pad = size * 0.08
  const boxW = size * 1.16, boxH = size * 1.16 + size * 0.26
  x = within(x, boxW - pad, W, pad)
  y = within(y, boxH - pad, H - footerH(W, H, spec), pad)
  return [
    rect({ x: x - size * 0.08, y: y - size * 0.08, w: size * 1.16, h: size * 1.16 + size * 0.26, fill: '#ffffff', radius: 16 }),
    qr({ x, y, w: size, h: size, data: spec.qr, fg: '#0f172a', bg: '#ffffff' }),
    text({
      x: x - size * 0.08, y: y + size + size * 0.02, w: size * 1.16, h: size * 0.22,
      text: label, size: size * 0.12, font: 'inter', bold: true, color: '#0f172a', align: 'center',
    }),
  ]
}

// ── recipes ──────────────────────────────────────────────────────────────────
// Every recipe takes (spec, canvas) and returns { background, elements }.
// U (= min(W,H)) sizes everything; W/H position it. See unit() above.

/** Big centred statement. The workhorse for notices, welcomes and closures. */
export function announcement(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const els = []
  const cx = W * 0.08, cw = W * 0.84
  const fh = footerH(W, H, spec)
  let y = H * (spec.eyebrow ? 0.24 : 0.28)

  if (spec.eyebrow) {
    els.push(text({
      x: cx, y: y - U * 0.11, w: cw, h: U * 0.07, text: spec.eyebrow,
      size: U * 0.032, font: 'inter', bold: true, color: p.accent, align: 'center', tracking: 8,
    }))
  }
  const titleSize = U * (spec.titleSize ?? 0.13)
  const titleH = U * 0.3
  els.push(text({
    x: cx, y, w: cw, h: titleH, text: spec.title,
    size: titleSize, font: spec.display || 'bebas', bold: true,
    color: p.text, align: 'center', valign: 'top', lineHeight: 1.05, tracking: 1,
  }))
  els.push(rule(p, { x: W * 0.5 - U * 0.06, y: y + titleH + U * 0.02, w: U * 0.12 }))

  if (spec.body) {
    els.push(text({
      x: W * 0.12, y: y + titleH + U * 0.08, w: W * 0.76, h: U * 0.22, text: spec.body,
      size: U * 0.04, font: 'inter', color: p.dim, align: 'center', valign: 'top', lineHeight: 1.4,
    }))
  }
  if (spec.qr) {
    const size = U * 0.18
    els.push(...qrBlock(p, W, H, spec, { x: W * 0.5 - size / 2, y: H - fh - size * 1.6, size }))
  }
  els.push(...footerBar(p, W, H, spec))
  return { background: bgOf(p, spec), elements: els }
}

/** Photo on one side, message on the other. */
export function heroSplit(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const portrait = H > W
  const flip = !!spec.flip
  const els = []
  const imgBox = portrait
    ? { x: 0, y: 0, w: W, h: H * 0.42 }
    : { x: flip ? W * 0.5 : 0, y: 0, w: W * 0.5, h: H }
  const txt = portrait
    ? { x: W * 0.08, y: H * 0.48, w: W * 0.84, h: H * 0.44 }
    : { x: flip ? W * 0.06 : W * 0.56, y: H * 0.14, w: W * 0.38, h: H * 0.72 }

  els.push(img(imgBox))
  let y = txt.y
  if (spec.eyebrow) {
    els.push(text({
      x: txt.x, y, w: txt.w, h: U * 0.06, text: spec.eyebrow,
      size: U * 0.028, font: 'inter', bold: true, color: p.accent, align: 'left', tracking: 6,
    }))
    y += U * 0.08
  }
  const titleH = U * 0.26
  els.push(text({
    x: txt.x, y, w: txt.w, h: titleH, text: spec.title,
    size: U * (spec.titleSize ?? 0.095), font: spec.display || 'bebas', bold: true,
    color: p.text, align: 'left', valign: 'top', lineHeight: 1.05,
  }))
  y += titleH + U * 0.01
  els.push(rule(p, { x: txt.x, y, w: U * 0.09 }))
  y += U * 0.05

  // The furniture at the foot of the column is placed first, so the body gets
  // the space that is genuinely left rather than running underneath a QR.
  const bottom = txt.y + txt.h
  const qrSize = spec.qr ? U * 0.15 : 0
  const qrBoxH = spec.qr ? qrSize * 1.45 : 0
  const ctaH = spec.cta ? U * 0.08 : 0
  const footRow = Math.max(qrBoxH, ctaH)
  const footTop = bottom - footRow

  if (spec.body) {
    const bodyH = Math.max(U * 0.08, footTop - y - U * 0.03)
    els.push(text({
      x: txt.x, y, w: txt.w, h: bodyH, text: spec.body,
      size: fitSize(spec.body, txt.w, bodyH, { size: U * 0.032, lineHeight: 1.45, min: U * 0.021 }),
      font: 'inter', color: p.dim, valign: 'top', lineHeight: 1.45,
    }))
  }
  if (spec.cta) {
    // Sits beside the QR when both are present, so neither lands on the other.
    const ctaW = Math.min(spec.qr ? txt.w - qrSize * 1.35 : txt.w, U * 0.5)
    els.push(text({
      x: txt.x, y: footTop + (footRow - ctaH) / 2, w: ctaW, h: ctaH,
      text: spec.cta, size: U * 0.03, font: 'inter', bold: true,
      color: contrastOn(p.accent), align: 'center', bg: p.accent, radius: U * 0.04, tracking: 2,
    }))
  }
  if (spec.qr) {
    els.push(...qrBlock(p, W, H, spec, {
      x: txt.x + txt.w - qrSize * 1.1,
      y: footTop,
      size: qrSize,
    }))
  }
  return { background: bgOf(p, spec), elements: els }
}

/** Full-bleed photo, dark scrim, message over the top. */
export function heroOverlay(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const els = [img({ x: 0, y: 0, w: W, h: H })]
  els.push(rect({ x: 0, y: 0, w: W, h: H, fill: p.band, fillOpacity: spec.scrim ?? 62 }))

  // The block is measured before it is placed: anchoring to the bottom and
  // then stacking a title, a body and a button used to walk straight off the
  // panel. The start is pulled up until the whole stack fits.
  const bodyBlock = spec.body ? U * 0.19 : 0
  const ctaBlock = spec.cta ? U * 0.105 : 0
  const stackH = U * 0.28 + bodyBlock + ctaBlock
  const wanted = spec.anchor === 'bottom' ? H * 0.55 : H * 0.28
  const ty = Math.max(U * 0.12, Math.min(wanted, H - stackH - U * 0.06))

  if (spec.eyebrow) {
    els.push(text({
      x: W * 0.08, y: ty - U * 0.1, w: W * 0.84, h: U * 0.06, text: spec.eyebrow,
      size: U * 0.03, font: 'inter', bold: true, color: p.accent2, align: 'center', valign: 'middle', tracking: 8,
    }))
  }
  const titleH = U * 0.28
  els.push(text({
    x: W * 0.07, y: ty, w: W * 0.86, h: titleH, text: spec.title,
    size: U * (spec.titleSize ?? 0.12), font: spec.display || 'bebas', bold: true,
    color: '#ffffff', align: 'center', valign: 'top', lineHeight: 1.05,
  }))
  let y = ty + titleH + U * 0.01
  if (spec.body) {
    els.push(text({
      x: W * 0.12, y, w: W * 0.76, h: U * 0.16, text: spec.body,
      size: U * 0.036, font: 'inter', color: '#e5e7eb', align: 'center', valign: 'top', lineHeight: 1.4,
    }))
    y += U * 0.19
  }
  if (spec.cta) {
    const cw = Math.min(W * 0.5, U * 0.44)
    els.push(text({
      x: W * 0.5 - cw / 2, y, w: cw, h: U * 0.085,
      text: spec.cta, size: U * 0.032, font: 'inter', bold: true,
      color: contrastOn(p.accent), align: 'center', bg: p.accent, radius: U * 0.045, tracking: 2,
    }))
  }
  if (spec.qr) {
    const size = U * 0.15
    els.push(...qrBlock(p, W, H, spec, { x: W - size * 1.5, y: H - size * 1.8, size }))
  }
  return { background: { color: p.bg }, elements: els }
}

/** Header + priced list. One or two columns of sections. */
export function menuBoard(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const els = []
  const headH = U * 0.16
  els.push(rect({ x: 0, y: 0, w: W, h: headH, fill: p.bg2 }))
  els.push(text({
    x: W * 0.05, y: 0, w: W * 0.58, h: headH, text: spec.title,
    size: headH * 0.42, font: spec.display || 'bebas', bold: true, color: p.text, valign: 'middle',
  }))
  if (spec.subtitle) {
    els.push(text({
      x: W * 0.64, y: 0, w: W * 0.31, h: headH, text: spec.subtitle,
      size: headH * 0.16, font: 'inter', color: p.accent, align: 'right', valign: 'middle', tracking: 4,
    }))
  }
  els.push(rect({ x: 0, y: headH, w: W, h: 6, fill: p.accent }))

  const cols = spec.columns || (W > H ? 2 : 1)
  const secs = spec.sections || []
  const gutter = W * 0.05
  const colW = (W - gutter * (cols + 1)) / cols
  const top = headH + U * 0.06
  const fh = footerH(W, H, spec)
  const qrRoom = spec.qr ? U * 0.24 : 0

  // Rows are fitted to the space that exists, then the type is derived from the
  // row — so a long menu tightens up instead of running off the board.
  const perCol = Math.ceil(secs.length / cols)
  // Counted in the same pitch units the flow below actually consumes, trailing
  // section gap included — an approximation here is what used to push the last
  // item under the footer bar.
  const unitsFor = list => list.reduce((n, s) => {
    let acc = s.name ? 1.35 : 0
    ;(s.items || []).forEach(it => { acc += 1 + (Array.isArray(it) && it[2] ? 0.6 : 0) + 0.15 })
    return n + acc + 0.2
  }, 0)
  let rowsInTallest = 0
  for (let c = 0; c < cols; c++) {
    rowsInTallest = Math.max(rowsInTallest, unitsFor(secs.slice(c * perCol, (c + 1) * perCol)))
  }
  const available = H - top - fh - qrRoom - U * 0.04
  const pitch = fitRows(rowsInTallest, available, { min: U * 0.03, max: U * 0.062 })
  const nameSize = pitch * 0.62
  const descSize = pitch * 0.42

  let col = 0, y = top
  secs.forEach((sec, si) => {
    if (si > 0 && si % perCol === 0) { col++; y = top }
    const x = gutter + col * (colW + gutter)
    if (sec.name) {
      els.push(text({
        x, y, w: colW, h: pitch, text: sec.name,
        size: pitch * 0.66, font: 'inter', bold: true, color: p.accent, valign: 'middle', tracking: 3,
      }))
      y += pitch * 1.35
    }
    ;(sec.items || []).forEach(it => {
      const [nm, price, desc] = Array.isArray(it) ? it : [it, '', '']
      els.push(text({ x, y, w: colW * 0.72, h: pitch, text: nm, size: nameSize, font: 'inter', bold: true, color: p.text, valign: 'middle' }))
      if (price) {
        els.push(text({ x: x + colW * 0.74, y, w: colW * 0.26, h: pitch, text: price, size: nameSize, font: 'inter', bold: true, color: p.accent2, align: 'right', valign: 'middle' }))
      }
      y += pitch
      if (desc) {
        els.push(text({ x, y, w: colW * 0.92, h: pitch * 0.6, text: desc, size: descSize, font: 'inter', color: p.dim, valign: 'top' }))
        y += pitch * 0.6
      }
      y += pitch * 0.15
    })
    y += pitch * 0.2
  })

  els.push(...footerBar(p, W, H, spec))
  if (spec.qr) {
    const size = U * 0.14
    els.push(...qrBlock(p, W, H, spec, { x: W - size * 1.5, y: H - fh - size * 1.6, size }))
  }
  return { background: bgOf(p, spec), elements: els }
}

/** Two to four offer cards side by side. */
export function priceCards(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const cards = spec.cards || []
  const n = Math.max(1, cards.length)
  const portrait = H > W
  const els = []
  els.push(text({
    x: W * 0.06, y: H * 0.06, w: W * 0.88, h: U * 0.14, text: spec.title,
    size: U * 0.08, font: spec.display || 'bebas', bold: true, color: p.text, align: 'center', valign: 'top',
  }))
  if (spec.subtitle) {
    els.push(text({
      x: W * 0.1, y: H * 0.06 + U * 0.15, w: W * 0.8, h: U * 0.06, text: spec.subtitle,
      size: U * 0.03, font: 'inter', color: p.dim, align: 'center', valign: 'top',
    }))
  }
  const fh = footerH(W, H, spec)
  const top = H * 0.06 + U * (spec.subtitle ? 0.23 : 0.17)
  const qrRoom = spec.qr ? U * 0.24 : 0
  const bottom = H - fh - qrRoom - U * 0.04

  // Portrait stacks the cards; side by side they would be slivers.
  const stack = portrait && n > 2
  const gut = U * 0.03
  const cardW = stack ? W * 0.88 : (W * 0.88 - gut * (n - 1)) / n
  const cardH = stack ? Math.min(U * 0.34, (bottom - top - gut * (n - 1)) / n) : Math.min(U * 0.55, bottom - top)

  cards.forEach((c, i) => {
    const x = stack ? W * 0.06 : W * 0.06 + i * (cardW + gut)
    const y = stack ? top + i * (cardH + gut) : top
    const featured = !!c.featured
    els.push(rect({ x, y, w: cardW, h: cardH, fill: featured ? p.accent : p.bg2, radius: 24 }))
    const fg = featured ? contrastOn(p.accent) : p.text
    const dim = featured ? contrastOn(p.accent) : p.dim
    els.push(text({ x: x + cardW * 0.06, y: y + cardH * 0.08, w: cardW * 0.88, h: cardH * 0.16, text: c.name, size: Math.min(U * 0.034, cardH * 0.15), font: 'inter', bold: true, color: fg, align: 'center', tracking: 2 }))
    els.push(text({ x: x + cardW * 0.05, y: y + cardH * 0.27, w: cardW * 0.9, h: cardH * 0.3, text: c.price, size: Math.min(U * 0.1, cardH * 0.3), font: spec.display || 'bebas', bold: true, color: featured ? fg : p.accent2, align: 'center' }))
    if (c.desc) {
      els.push(text({ x: x + cardW * 0.07, y: y + cardH * 0.6, w: cardW * 0.86, h: cardH * 0.34, text: c.desc, size: Math.min(U * 0.024, cardH * 0.1), font: 'inter', color: dim, align: 'center', valign: 'top', lineHeight: 1.4, opacity: featured ? 85 : 100 }))
    }
  })
  if (spec.qr) {
    const size = U * 0.15
    els.push(...qrBlock(p, W, H, spec, { x: W * 0.5 - size / 2, y: H - fh - size * 1.55, size }))
  }
  els.push(...footerBar(p, W, H, spec))
  return { background: bgOf(p, spec), elements: els }
}

/** Big-number tiles — KPIs, safety counters, live stats. */
export function statTiles(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const tiles = spec.tiles || []
  const n = Math.max(1, tiles.length)
  const portrait = H > W
  const els = []
  els.push(text({
    x: W * 0.06, y: H * 0.07, w: W * 0.56, h: U * 0.1, text: spec.title,
    size: U * 0.07, font: spec.display || 'bebas', bold: true, color: p.text, valign: 'middle',
  }))
  if (spec.subtitle) {
    els.push(text({
      x: W * 0.62, y: H * 0.07, w: W * 0.32, h: U * 0.1, text: spec.subtitle,
      size: U * 0.028, font: 'inter', color: p.accent, align: 'right', valign: 'middle', tracking: 3,
    }))
  }
  const cols = portrait ? (n <= 3 ? 1 : 2) : (n <= 2 ? n : n <= 4 ? 2 : 3)
  const rows = Math.ceil(n / cols)
  const gut = U * 0.03
  const fh = footerH(W, H, spec)
  const areaY = H * 0.07 + U * 0.14
  const areaH = H - areaY - fh - U * 0.05
  const tw = (W * 0.88 - gut * (cols - 1)) / cols
  const th = Math.min(U * 0.4, (areaH - gut * (rows - 1)) / rows)
  tiles.forEach((t, i) => {
    const cx = i % cols, cy = Math.floor(i / cols)
    const x = W * 0.06 + cx * (tw + gut), y = areaY + cy * (th + gut)
    els.push(rect({ x, y, w: tw, h: th, fill: p.bg2, radius: 20 }))
    els.push(rect({ x, y, w: tw, h: 6, fill: t.accent || p.accent, radius: 3 }))
    els.push(text({ x: x + tw * 0.06, y: y + th * 0.12, w: tw * 0.88, h: th * 0.18, text: t.label, size: Math.min(U * 0.026, th * 0.16), font: 'inter', bold: true, color: p.dim, tracking: 3 }))
    els.push(text({ x: x + tw * 0.06, y: y + th * 0.32, w: tw * 0.88, h: th * 0.4, text: t.value, size: Math.min(U * 0.12, th * 0.42, tw * 0.34), font: spec.display || 'bebas', bold: true, color: p.text }))
    if (t.sub) els.push(text({ x: x + tw * 0.06, y: y + th * 0.76, w: tw * 0.88, h: th * 0.16, text: t.sub, size: Math.min(U * 0.022, th * 0.12), font: 'inter', color: t.accent || p.accent2 }))
  })
  els.push(...footerBar(p, W, H, spec))
  return { background: bgOf(p, spec), elements: els }
}

/** Time | title | detail rows. Schedules, departures, services, classes. */
export function scheduleRows(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const rows = spec.rows || []
  const els = []
  const headH = U * 0.14
  els.push(rect({ x: 0, y: 0, w: W, h: headH, fill: p.bg2 }))
  els.push(text({ x: W * 0.05, y: 0, w: W * 0.55, h: headH, text: spec.title, size: headH * 0.42, font: spec.display || 'bebas', bold: true, color: p.text, valign: 'middle' }))
  if (spec.subtitle) {
    els.push(text({ x: W * 0.6, y: 0, w: W * 0.35, h: headH, text: spec.subtitle, size: headH * 0.18, font: 'inter', color: p.accent, align: 'right', valign: 'middle', tracking: 3 }))
  }

  const fh = footerH(W, H, spec)
  const top = headH + U * 0.08
  const available = H - top - fh - U * 0.03
  const rh = fitRows(rows.length, available, { min: U * 0.05, max: U * 0.1 })
  const cTime = W * 0.05, wTime = W * 0.17
  const cName = W * 0.24, wName = W * 0.47
  const cMeta = W * 0.72, wMeta = W * 0.23

  const headSize = Math.min(U * 0.021, rh * 0.3)
  els.push(text({ x: cTime, y: top - U * 0.045, w: wTime, h: U * 0.035, text: spec.colTime ?? 'TIME', size: headSize, font: 'inter', bold: true, color: p.dim, tracking: 3 }))
  els.push(text({ x: cName, y: top - U * 0.045, w: wName, h: U * 0.035, text: spec.colName ?? 'WHAT', size: headSize, font: 'inter', bold: true, color: p.dim, tracking: 3 }))
  els.push(text({ x: cMeta, y: top - U * 0.045, w: wMeta, h: U * 0.035, text: spec.colMeta ?? 'WHERE', size: headSize, font: 'inter', bold: true, color: p.dim, align: 'right', tracking: 3 }))

  rows.forEach((row, i) => {
    const [time, name, meta] = row
    const y = top + i * rh
    if (i % 2 === 0) els.push(rect({ x: W * 0.035, y, w: W * 0.93, h: rh * 0.92, fill: p.bg2, fillOpacity: 55, radius: 10 }))
    els.push(text({ x: cTime, y, w: wTime, h: rh * 0.92, text: time, size: rh * 0.34, font: spec.display || 'oswald', bold: true, color: p.accent2, valign: 'middle' }))
    els.push(text({ x: cName, y, w: wName, h: rh * 0.92, text: name, size: rh * 0.3, font: 'inter', bold: true, color: p.text, valign: 'middle' }))
    if (meta) els.push(text({ x: cMeta, y, w: wMeta, h: rh * 0.92, text: meta, size: rh * 0.24, font: 'inter', color: p.dim, align: 'right', valign: 'middle' }))
  })

  els.push(...footerBar(p, W, H, spec))
  return { background: bgOf(p, spec), elements: els }
}

/** One enormous number. Days-since-incident, countdowns, scores, capacity. */
export function bigNumber(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const els = []
  const fh = footerH(W, H, spec)
  if (spec.eyebrow) {
    els.push(text({ x: W * 0.08, y: H * 0.14, w: W * 0.84, h: U * 0.08, text: spec.eyebrow, size: U * 0.038, font: 'inter', bold: true, color: p.accent, align: 'center', valign: 'middle', tracking: 10 }))
  }
  // Long values have to be narrowed or they run past the panel edges.
  const chars = String(spec.value ?? '').length
  const byWidth = (W * 0.9) / Math.max(1, chars * 0.46)
  const size = Math.min(U * (spec.valueSize ?? 0.36), byWidth)
  els.push(text({
    x: W * 0.05, y: H * 0.26, w: W * 0.9, h: size * 1.15, text: spec.value,
    size, font: spec.display || 'bebas', bold: true,
    color: p.text, align: 'center', valign: 'middle', lineHeight: 1.0,
  }))
  const labelY = H * 0.26 + size * 1.2
  els.push(text({
    x: W * 0.08, y: labelY, w: W * 0.84, h: U * 0.1, text: spec.label,
    size: U * 0.052, font: 'inter', bold: true, color: p.accent2, align: 'center', valign: 'middle', tracking: 6,
  }))
  if (spec.body) {
    els.push(text({ x: W * 0.12, y: labelY + U * 0.12, w: W * 0.76, h: U * 0.14, text: spec.body, size: U * 0.03, font: 'inter', color: p.dim, align: 'center', valign: 'top', lineHeight: 1.4 }))
  }
  els.push(...footerBar(p, W, H, spec))
  return { background: bgOf(p, spec), elements: els }
}

/** Pull quote with attribution. */
export function quoteCard(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const els = []
  const markSize = U * 0.26
  // The opening mark is a graphic, so its box is sized to the glyph rather than
  // to a text block — otherwise it reports as an overflowing paragraph.
  els.push(text({
    x: W * 0.07, y: H * 0.14, w: markSize, h: markSize * 1.2, text: '“',
    size: markSize, font: 'playfair', bold: true, color: p.accent, opacity: 45, valign: 'top',
  }))
  const qSize = U * (spec.quoteSize ?? 0.062)
  els.push(text({
    x: W * 0.1, y: H * 0.28, w: W * 0.8, h: U * 0.4, text: spec.quote,
    size: qSize, font: spec.display || 'playfair', italic: true,
    color: p.text, align: 'center', valign: 'middle', lineHeight: 1.35,
  }))
  els.push(rule(p, { x: W * 0.5 - U * 0.05, y: H * 0.72, w: U * 0.1, h: 5 }))
  if (spec.author) {
    els.push(text({ x: W * 0.12, y: H * 0.75, w: W * 0.76, h: U * 0.08, text: spec.author, size: U * 0.032, font: 'inter', bold: true, color: p.accent2, align: 'center', valign: 'middle', tracking: 4 }))
  }
  els.push(...footerBar(p, W, H, spec))
  return { background: bgOf(p, spec), elements: els }
}

/** Name/location directory in two columns. */
export function directory(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const entries = spec.entries || []
  const els = []
  const headH = U * 0.15
  els.push(rect({ x: 0, y: 0, w: W, h: headH, fill: p.accent }))
  els.push(text({ x: W * 0.05, y: 0, w: W * 0.9, h: headH, text: spec.title, size: headH * 0.4, font: spec.display || 'bebas', bold: true, color: contrastOn(p.accent), valign: 'middle' }))

  const cols = W > H ? 2 : 1
  const perCol = Math.ceil(entries.length / cols)
  const gut = W * 0.05
  const colW = (W - gut * (cols + 1)) / cols
  const fh = footerH(W, H, spec)
  const top = headH + U * 0.06
  const rh = fitRows(perCol, H - top - fh - U * 0.03, { min: U * 0.045, max: U * 0.085 })

  entries.forEach((e, i) => {
    const col = Math.floor(i / perCol), row = i % perCol
    const x = gut + col * (colW + gut), y = top + row * rh
    const [name, where] = Array.isArray(e) ? e : [e, '']
    els.push(text({ x, y, w: colW * 0.66, h: rh * 0.88, text: name, size: rh * 0.32, font: 'inter', bold: true, color: p.text, valign: 'middle' }))
    if (where) els.push(text({ x: x + colW * 0.68, y, w: colW * 0.32, h: rh * 0.88, text: where, size: rh * 0.3, font: spec.display || 'oswald', bold: true, color: p.accent2, align: 'right', valign: 'middle' }))
    els.push(rect({ x, y: y + rh * 0.9, w: colW, h: 2, fill: p.dim, fillOpacity: 25 }))
  })
  els.push(...footerBar(p, W, H, spec))
  return { background: bgOf(p, spec), elements: els }
}

/** A card of labelled values, optionally with a QR beside them. */
export function infoCard(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const portrait = H > W
  const els = []
  const cardX = W * 0.07, cardW = W * 0.86
  const cardY = H * 0.12, cardH = H * 0.76
  els.push(rect({ x: cardX, y: cardY, w: cardW, h: cardH, fill: p.bg2, radius: 28 }))
  els.push(rect({ x: cardX, y: cardY, w: cardW, h: U * 0.018, fill: p.accent, radius: 8 }))
  els.push(text({ x: cardX + cardW * 0.06, y: cardY + U * 0.05, w: cardW * 0.88, h: U * 0.12, text: spec.title, size: U * 0.07, font: spec.display || 'bebas', bold: true, color: p.text, align: 'center', valign: 'top' }))

  const fields = spec.fields || []
  const hasQr = !!spec.qr
  // Portrait puts the QR under the fields; side by side it would squeeze both.
  const sideBySide = hasQr && !portrait
  const listX = cardX + cardW * (sideBySide ? 0.07 : 0.1)
  const listW = cardW * (sideBySide ? 0.48 : 0.8)
  const fieldsTop = cardY + U * 0.2
  const fieldsBottom = hasQr && !sideBySide ? cardY + cardH * 0.52 : cardY + cardH * 0.94
  const pitch = fitRows(fields.length, fieldsBottom - fieldsTop, { min: U * 0.09, max: U * 0.15 })

  fields.forEach((f, i) => {
    const y = fieldsTop + i * pitch
    els.push(text({ x: listX, y, w: listW, h: pitch * 0.3, text: f.label, size: Math.min(U * 0.024, pitch * 0.26), font: 'inter', bold: true, color: p.dim, tracking: 4, valign: 'middle' }))
    // Credentials are read letter by letter off a wall, so they get as much
    // size as the box allows and never wrap.
    const vSize = Math.min(U * 0.05, pitch * 0.46, (listW / Math.max(1, String(f.value).length * 0.56)))
    els.push(text({ x: listX, y: y + pitch * 0.32, w: listW, h: pitch * 0.5, text: f.value, size: vSize, font: f.mono ? 'mono' : 'inter', bold: true, color: p.accent2, valign: 'middle' }))
  })

  if (hasQr) {
    const size = sideBySide ? Math.min(cardH * 0.42, U * 0.3) : Math.min(cardH * 0.3, U * 0.26)
    const x = sideBySide ? cardX + cardW * 0.62 : cardX + cardW * 0.5 - size / 2
    const y = sideBySide ? cardY + cardH * 0.3 : cardY + cardH * 0.58
    els.push(...qrBlock(p, W, H, spec, { x, y, size }))
  }
  if (spec.body) {
    els.push(text({ x: cardX + cardW * 0.06, y: cardY + cardH - U * 0.07, w: cardW * 0.88, h: U * 0.06, text: spec.body, size: U * 0.024, font: 'inter', color: p.dim, align: 'center', valign: 'middle' }))
  }
  return { background: bgOf(p, spec), elements: els }
}

/** Angled accent block behind a hard offer — the loudest recipe in the set. */
export function promoBurst(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const portrait = H > W
  const els = []
  els.push(rect({ x: -W * 0.15, y: -H * 0.2, w: W * 1.1, h: H * (portrait ? 0.72 : 0.9), fill: p.accent, rotation: -12, opacity: 92 }))
  els.push(rect({ x: W * 0.5, y: H * 0.55, w: W * 0.8, h: H * 0.6, fill: p.accent2, rotation: 20, opacity: 28 }))

  const textW = portrait ? W * 0.86 : W * 0.58
  els.push(text({ x: W * 0.07, y: H * 0.08, w: textW, h: U * 0.08, text: spec.eyebrow || 'LIMITED TIME', size: U * 0.034, font: 'inter', bold: true, color: contrastOn(p.accent), valign: 'middle', tracking: 8 }))

  const titleSize = U * (spec.titleSize ?? 0.17)
  els.push(text({
    x: W * 0.06, y: H * 0.16, w: textW, h: U * 0.42, text: spec.title,
    size: titleSize, font: spec.display || 'bebas', bold: true,
    color: contrastOn(p.accent), lineHeight: 1.0, valign: 'top',
  }))
  let y = H * (portrait ? 0.48 : 0.52)
  if (spec.body) {
    els.push(text({ x: W * 0.07, y, w: textW * 0.92, h: U * 0.14, text: spec.body, size: U * 0.034, font: 'inter', color: p.text, valign: 'top', lineHeight: 1.35 }))
    y += U * 0.17
  }
  const fh = footerH(W, H, spec)
  if (spec.code) {
    els.push(text({
      x: W * 0.07, y, w: Math.min(textW * 0.7, U * 0.42), h: U * 0.09,
      text: spec.code, size: U * 0.04, font: 'mono', bold: true, color: p.text,
      align: 'center', valign: 'middle', bg: p.bg2, radius: 12, tracking: 3,
    }))
  }
  if (spec.qr) {
    const size = U * 0.22
    els.push(...qrBlock(p, W, H, spec, {
      x: portrait ? W - size * 1.45 : W * 0.68,
      y: H - fh - size * 1.6,
      size,
    }))
  }
  els.push(...footerBar(p, W, H, spec))
  return { background: bgOf(p, spec), elements: els }
}

/** Photo strip with a caption band — galleries, team boards, new arrivals. */
export function photoStrip(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const n = spec.frames || 3
  const portrait = H > W
  const els = []
  els.push(text({ x: W * 0.06, y: H * 0.06, w: W * 0.88, h: U * 0.1, text: spec.title, size: U * 0.07, font: spec.display || 'bebas', bold: true, color: p.text, align: 'center', valign: 'middle' }))
  if (spec.subtitle) {
    els.push(text({ x: W * 0.1, y: H * 0.06 + U * 0.11, w: W * 0.8, h: U * 0.05, text: spec.subtitle, size: U * 0.028, font: 'inter', color: p.dim, align: 'center', valign: 'middle' }))
  }
  const fh = footerH(W, H, spec)
  const qrRoom = spec.qr ? U * 0.22 : 0
  const top = H * 0.06 + U * (spec.subtitle ? 0.19 : 0.13)
  const bottom = H - fh - qrRoom - U * 0.03
  const gut = U * 0.025
  const caps = spec.captions || []

  // Portrait stacks the frames rather than slicing the width into slivers.
  const cols = portrait ? 1 : n
  const rows = Math.ceil(n / cols)
  const fw = (W * 0.9 - gut * (cols - 1)) / cols
  const fh2 = Math.min((bottom - top - gut * (rows - 1)) / rows, portrait ? U * 0.42 : U * 0.55)

  for (let i = 0; i < n; i++) {
    const cx = i % cols, cy = Math.floor(i / cols)
    const x = W * 0.05 + cx * (fw + gut)
    const y = top + cy * (fh2 + gut)
    const capH = caps[i] ? Math.min(U * 0.07, fh2 * 0.2) : 0
    els.push(rect({ x, y, w: fw, h: fh2, fill: p.bg2, radius: 18 }))
    els.push(img({ x: x + 6, y: y + 6, w: fw - 12, h: fh2 - capH - 12, radius: 14 }))
    if (caps[i]) {
      els.push(text({ x, y: y + fh2 - capH, w: fw, h: capH, text: caps[i], size: capH * 0.4, font: 'inter', bold: true, color: p.text, align: 'center', valign: 'middle' }))
    }
  }
  if (spec.qr) {
    const size = U * 0.14
    els.push(...qrBlock(p, W, H, spec, { x: W - size * 1.5, y: H - fh - size * 1.55, size }))
  }
  els.push(...footerBar(p, W, H, spec))
  return { background: bgOf(p, spec), elements: els }
}

/** Numbered steps — safety rules, how-it-works, checklists. */
export function stepList(spec, { width: W, height: H }) {
  const p = spec.palette
  const U = unit(W, H)
  const steps = spec.steps || []
  const els = []
  const headH = U * 0.15
  els.push(rect({ x: 0, y: 0, w: W, h: headH, fill: p.accent }))
  els.push(text({ x: W * 0.05, y: 0, w: W * 0.9, h: headH, text: spec.title, size: headH * 0.42, font: spec.display || 'bebas', bold: true, color: contrastOn(p.accent), valign: 'middle' }))

  const fh = footerH(W, H, spec)
  const top = headH + U * 0.06
  const rh = fitRows(steps.length, H - top - fh - U * 0.03, { min: U * 0.1, max: U * 0.17 })
  const dia = rh * 0.5
  const textX = W * 0.05 + dia * 1.35
  const textW = W * 0.95 - textX

  steps.forEach((s, i) => {
    const y = top + i * rh
    const [head, detail] = Array.isArray(s) ? s : [s, '']
    els.push(rect({ x: W * 0.05, y: y + rh * 0.06, w: dia, h: dia, fill: p.accent, radius: dia / 2 }))
    els.push(text({ x: W * 0.05, y: y + rh * 0.06, w: dia, h: dia, text: String(i + 1), size: dia * 0.52, font: spec.display || 'bebas', bold: true, color: contrastOn(p.accent), align: 'center', valign: 'middle' }))
    els.push(text({ x: textX, y: y + rh * 0.04, w: textW, h: rh * 0.34, text: head, size: rh * 0.26, font: 'inter', bold: true, color: p.text, valign: 'middle' }))
    if (detail) {
      els.push(text({ x: textX, y: y + rh * 0.42, w: textW * 0.96, h: rh * 0.4, text: detail, size: rh * 0.185, font: 'inter', color: p.dim, valign: 'top', lineHeight: 1.35 }))
    }
  })
  els.push(...footerBar(p, W, H, spec))
  return { background: bgOf(p, spec), elements: els }
}

export const RECIPES = {
  announcement, heroSplit, heroOverlay, menuBoard, priceCards, statTiles,
  scheduleRows, bigNumber, quoteCard, directory, infoCard, promoBurst,
  photoStrip, stepList,
}
