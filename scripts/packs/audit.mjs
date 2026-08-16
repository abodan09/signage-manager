/* Layout audit for generated designs.
 *
 * Recipes compute geometry from content, so a long dish name or an extra menu
 * section is enough to push type out of its box — and nobody proofreads 311
 * templates by eye. The build runs this over every one and refuses to ship a
 * pack that fails, which is what keeps the recipes honest as the catalog grows.
 *
 * The measurements are estimates (real line breaking belongs to the browser),
 * so the thresholds are deliberately slack: this catches a layout that is
 * plainly broken, not one that is a few pixels tight.
 */

const ADVANCE = {
  bebas: 0.42, oswald: 0.45, 'sans-narrow': 0.44,
  inter: 0.52, sans: 0.52, mono: 0.6,
  playfair: 0.5, 'roboto-slab': 0.53, serif: 0.5, pacifico: 0.46,
}

function textHeight(el) {
  const adv = (ADVANCE[el.font] ?? 0.52) * el.fontSize + (el.letterSpacing || 0)
  const perLine = Math.max(1, Math.floor(el.w / Math.max(1, adv)))
  const lines = String(el.text ?? '').split('\n')
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0)
  return lines * el.fontSize * (el.lineHeight || 1.15)
}

/** Returns a list of human-readable problems; empty means the design is sound. */
export function auditDesign(design, label = 'design') {
  const problems = []
  const W = design.width, H = design.height

  for (const el of design.elements) {
    const { x = 0, y = 0, w = 0, h = 0 } = el
    // Shapes and photos bleed off the canvas on purpose (angled promo blocks,
    // full-bleed imagery); only text reads as a mistake when it does.
    if (el.type === 'text') {
      if (x < -4 || y < -4 || x + w > W + 4 || y + h > H + 4) {
        problems.push(`${label}: text ${el.id} out of bounds (${Math.round(x)},${Math.round(y)} ${Math.round(w)}x${Math.round(h)} on ${W}x${H})`)
      }
      if (el.text) {
        const need = textHeight(el)
        if (need > h * 1.45) {
          problems.push(`${label}: text ${el.id} overflows its box — needs ~${Math.round(need)}px in ${Math.round(h)}px ("${String(el.text).slice(0, 32)}")`)
        }
        if (y + need > H + 8) {
          problems.push(`${label}: text ${el.id} runs off the bottom (ends ~${Math.round(y + need)} of ${H})`)
        }
      }
    }
  }

  // Text stacked on text is the collision a viewer actually sees.
  const texts = design.elements.filter(e => e.type === 'text' && String(e.text || '').trim())
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j]
      const ah = Math.min(a.h, textHeight(a)), bh = Math.min(b.h, textHeight(b))
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + ah, b.y + bh) - Math.max(a.y, b.y)
      if (ox > 12 && oy > 12 && ox * oy > Math.min(a.w * ah, b.w * bh) * 0.5) {
        problems.push(`${label}: text ${a.id} and ${b.id} overlap (${Math.round(ox)}x${Math.round(oy)}px)`)
      }
    }
  }

  return problems
}
