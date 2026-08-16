import fs from 'fs'
import path from 'path'
import type { SceneFontId } from './types'

// TVs ship almost no fonts — webOS and Tizen typically expose one system sans
// and silently substitute everything else. Display faces therefore have to be
// served by the manager itself: ids with a `file` get an @font-face pointing
// at /fonts/<file>, so a design renders identically on every panel and in the
// Designer. Ids without a file are the web-safe stacks the zone templates
// already use. A missing woff2 on disk degrades to the fallback stack instead
// of breaking the scene.

export interface SceneFont {
  id: SceneFontId
  label: string
  /** Full CSS font-family value, fallbacks included. */
  css: string
  /** woff2 filename under <assets>/fonts, when the face is bundled. */
  file?: string
}

export const SCENE_FONTS: Record<SceneFontId, SceneFont> = {
  'sans':        { id: 'sans',        label: 'Sans',            css: 'Arial, Helvetica, sans-serif' },
  'sans-narrow': { id: 'sans-narrow', label: 'Sans Narrow',     css: '"Arial Narrow", Arial, Helvetica, sans-serif' },
  'serif':       { id: 'serif',       label: 'Serif',           css: 'Georgia, "Times New Roman", serif' },
  'mono':        { id: 'mono',        label: 'Mono',            css: '"Courier New", Courier, monospace' },
  'inter':       { id: 'inter',       label: 'Inter',           css: '"Inter", Arial, Helvetica, sans-serif',             file: 'inter.woff2' },
  'oswald':      { id: 'oswald',      label: 'Oswald',          css: '"Oswald", "Arial Narrow", Arial, sans-serif',       file: 'oswald.woff2' },
  'bebas':       { id: 'bebas',       label: 'Bebas Neue',      css: '"Bebas Neue", "Arial Narrow", Arial, sans-serif',   file: 'bebas.woff2' },
  'playfair':    { id: 'playfair',    label: 'Playfair Display', css: '"Playfair Display", Georgia, serif',               file: 'playfair.woff2' },
  'pacifico':    { id: 'pacifico',    label: 'Pacifico',        css: '"Pacifico", "Comic Sans MS", cursive',              file: 'pacifico.woff2' },
  'roboto-slab': { id: 'roboto-slab', label: 'Roboto Slab',     css: '"Roboto Slab", Georgia, serif',                     file: 'roboto-slab.woff2' },
}

export function isSceneFontId(v: unknown): v is SceneFontId {
  return typeof v === 'string' && v in SCENE_FONTS
}

/** @font-face rules for every bundled face actually present on disk. Fed into
 *  scene pages (which load /fonts/… from the manager, so offline LANs work)
 *  and exposed to the renderer for the Designer canvas. */
export function fontFaceCss(fontsDir: string): string {
  const rules: string[] = []
  for (const f of Object.values(SCENE_FONTS)) {
    if (!f.file) continue
    try {
      if (!fs.existsSync(path.join(fontsDir, f.file))) continue
    } catch { continue }
    const family = f.css.split(',')[0].trim().replace(/^"|"$/g, '')
    // No font-weight range descriptor: Chrome 53 predates variable-font syntax.
    // Bold is browser-synthesized, which every TV WebView supports.
    rules.push(
      `@font-face{font-family:"${family}";src:url(/fonts/${f.file}) format("woff2");font-display:swap}`,
    )
  }
  return rules.join('\n')
}
