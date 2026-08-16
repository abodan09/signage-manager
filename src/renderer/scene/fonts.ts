import type { SceneFontId } from '../types'

/** Mirror of src/main/server/fonts.ts. The two must agree or a design would
 *  look different in the Designer than it does on the wall — which is the one
 *  thing a WYSIWYG editor may never do. */
export const SCENE_FONTS: Record<SceneFontId, { label: string; css: string; file?: string }> = {
  'sans':        { label: 'Sans',             css: 'Arial, Helvetica, sans-serif' },
  'sans-narrow': { label: 'Sans Narrow',      css: '"Arial Narrow", Arial, Helvetica, sans-serif' },
  'serif':       { label: 'Serif',            css: 'Georgia, "Times New Roman", serif' },
  'mono':        { label: 'Mono',             css: '"Courier New", Courier, monospace' },
  'inter':       { label: 'Inter',            css: '"Inter", Arial, Helvetica, sans-serif',           file: 'inter.woff2' },
  'oswald':      { label: 'Oswald',           css: '"Oswald", "Arial Narrow", Arial, sans-serif',     file: 'oswald.woff2' },
  'bebas':       { label: 'Bebas Neue',       css: '"Bebas Neue", "Arial Narrow", Arial, sans-serif', file: 'bebas.woff2' },
  'playfair':    { label: 'Playfair Display', css: '"Playfair Display", Georgia, serif',              file: 'playfair.woff2' },
  'pacifico':    { label: 'Pacifico',         css: '"Pacifico", "Comic Sans MS", cursive',            file: 'pacifico.woff2' },
  'roboto-slab': { label: 'Roboto Slab',      css: '"Roboto Slab", Georgia, serif',                   file: 'roboto-slab.woff2' },
}

export const FONT_OPTIONS = (Object.keys(SCENE_FONTS) as SceneFontId[]).map(id => ({ id, ...SCENE_FONTS[id] }))

let injected = ''

/** Installs the bundled faces once per server URL. The renderer runs from
 *  file:// in a packaged build, so the URLs must be absolute against the
 *  embedded server rather than root-relative like the TV scene pages. */
export function useSceneFonts(serverUrl: string) {
  if (!serverUrl || injected === serverUrl) return
  injected = serverUrl
  const rules = FONT_OPTIONS
    .filter(f => f.file)
    .map(f => {
      const family = f.css.split(',')[0].trim().replace(/^"|"$/g, '')
      return `@font-face{font-family:"${family}";src:url("${serverUrl}/fonts/${f.file}") format("woff2");font-display:swap}`
    })
    .join('\n')
  const el = document.createElement('style')
  el.setAttribute('data-scene-fonts', '1')
  el.textContent = rules
  document.head.appendChild(el)
}
