/* Downloads the display faces the Designer offers.
 *
 *   node scripts/fetch-fonts.mjs
 *
 * TVs ship almost no fonts — webOS and Tizen typically expose one system sans
 * and silently substitute anything else — so a design that picks a display face
 * only looks right if the manager serves the face itself. These are all
 * SIL Open Font License or Apache 2.0, which permit redistribution; the licence
 * text is written next to the files.
 *
 * The app degrades gracefully when a file is missing: fontFaceCss() skips it
 * and the CSS falls back to the next stack, so running this is an upgrade, not
 * a prerequisite.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'assets', 'fonts')

// Weight 700 where the face has one: signage leans on bold, and a synthesised
// bold of a condensed display face looks smeared on a big panel.
const FONTS = [
  { file: 'inter.woff2',       family: 'Inter',            axis: 'wght@400;700', licence: 'SIL OFL 1.1' },
  { file: 'oswald.woff2',      family: 'Oswald',           axis: 'wght@400;700', licence: 'SIL OFL 1.1' },
  { file: 'bebas.woff2',       family: 'Bebas+Neue',       axis: '',             licence: 'SIL OFL 1.1' },
  { file: 'playfair.woff2',    family: 'Playfair+Display', axis: 'wght@400;700', licence: 'SIL OFL 1.1' },
  { file: 'pacifico.woff2',    family: 'Pacifico',         axis: '',             licence: 'SIL OFL 1.1' },
  { file: 'roboto-slab.woff2', family: 'Roboto+Slab',      axis: 'wght@400;700', licence: 'Apache 2.0' },
]

// A modern UA is what makes Google Fonts answer with woff2 rather than ttf.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

async function grab(font) {
  const url = `https://fonts.googleapis.com/css2?family=${font.family}${font.axis ? ':' + font.axis : ''}&display=swap`
  const cssRes = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!cssRes.ok) throw new Error(`css HTTP ${cssRes.status}`)
  const css = await cssRes.text()

  // Latin only. The full set would multiply the payload for glyphs signage in
  // these languages does not use, and the fallback stack covers the rest.
  const blocks = css.split('@font-face').filter(b => /unicode-range:[^;]*U\+0000-00FF/.test(b))
  const pick = blocks.length ? blocks : css.split('@font-face').slice(1)
  const urls = pick.map(b => (b.match(/url\((https:\/\/[^)]+\.woff2)\)/) || [])[1]).filter(Boolean)
  if (!urls.length) throw new Error('no woff2 url in the stylesheet')

  const buf = Buffer.from(await (await fetch(urls[0], { headers: { 'User-Agent': UA } })).arrayBuffer())
  fs.writeFileSync(path.join(OUT, font.file), buf)
  return buf.length
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  let ok = 0
  for (const font of FONTS) {
    try {
      const bytes = await grab(font)
      ok++
      console.log(`  ${font.file.padEnd(20)} ${(bytes / 1024).toFixed(0).padStart(4)} KB  ${font.licence}`)
    } catch (e) {
      console.warn(`  ${font.file.padEnd(20)} SKIPPED — ${e.message}`)
    }
  }
  fs.writeFileSync(path.join(OUT, 'LICENCES.txt'),
    'Fonts bundled with Signage Manager\n' +
    '=================================\n\n' +
    FONTS.map(f => `${f.family.replace(/\+/g, ' ')} — ${f.licence}`).join('\n') +
    '\n\nAll faces are redistributable under their respective licences.\n' +
    'SIL Open Font License 1.1: https://scripts.sil.org/OFL\n' +
    'Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0\n' +
    '\nRe-download with: node scripts/fetch-fonts.mjs\n', 'utf-8')
  console.log(`\n${ok}/${FONTS.length} fonts in assets/fonts`)
}

main().catch(e => { console.error(e); process.exit(1) })
