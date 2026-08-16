/* Builds the shipped template packs from the catalog.
 *
 *   node scripts/build-packs.mjs
 *
 * Reads scripts/packs/catalog/<category>.mjs, renders every entry through its
 * layout recipe, and writes assets/packs/<category>.json plus registry.json.
 * When dist/ exists the output is validated with the very same validatePack()
 * the app uses at runtime, so a pack can never ship in a shape the manager
 * would reject on install.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { LANDSCAPE, PALETTES, PORTRAIT, RECIPES, resetIds } from './packs/recipes.mjs'
import { auditDesign } from './packs/audit.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const CATALOG_DIR = path.join(HERE, 'packs', 'catalog')
const OUT_DIR = path.join(ROOT, 'assets', 'packs')

const PACK_VERSION = process.env.PACK_VERSION || '1.0.0'

function buildTemplate(entry, category) {
  const recipe = RECIPES[entry.recipe]
  if (!recipe) throw new Error(`${category}/${entry.key}: unknown recipe "${entry.recipe}"`)
  const palette = PALETTES[entry.spec?.palette]
  if (!palette) throw new Error(`${category}/${entry.key}: unknown palette "${entry.spec?.palette}"`)

  const canvas = entry.orientation === 'portrait' ? PORTRAIT : LANDSCAPE
  // Element ids only have to be unique inside one design, and restarting the
  // counter per template keeps diffs between rebuilds readable.
  resetIds()
  const { background, elements } = recipe({ ...entry.spec, palette }, canvas)

  return {
    key: entry.key,
    name: entry.name,
    description: entry.description,
    tags: entry.tags,
    design: {
      name: entry.name,
      category,
      templateKey: entry.key,
      width: canvas.width,
      height: canvas.height,
      background,
      elements,
    },
  }
}

async function loadCatalogs() {
  const files = fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.mjs')).sort()
  const out = []
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(CATALOG_DIR, f)).href)
    out.push(mod.default)
  }
  return out
}

async function loadValidator() {
  const compiled = path.join(ROOT, 'dist', 'main', 'server', 'packs.js')
  if (!fs.existsSync(compiled)) return null
  try {
    const mod = await import(pathToFileURL(compiled).href)
    return mod.validatePack ?? null
  } catch {
    return null
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const catalogs = await loadCatalogs()
  const validate = await loadValidator()
  if (!validate) console.warn('! dist/ not built — writing packs without runtime validation')

  const registry = { formatVersion: 1, packs: [] }
  let grandTotal = 0
  const problems = []

  for (const cat of catalogs) {
    const templates = cat.templates.map(t => buildTemplate(t, cat.category))
    const pack = {
      formatVersion: 1,
      category: cat.category,
      name: cat.name,
      description: cat.description,
      icon: cat.icon,
      version: PACK_VERSION,
      templates,
    }

    if (validate) {
      const res = validate(pack, cat.category)
      if (!res.ok) { problems.push(`${cat.category}: ${res.error}`); continue }
    }
    if (templates.length < 20) problems.push(`${cat.category}: only ${templates.length} templates (20 required)`)

    // A template that validates can still look broken; the layout audit is what
    // stops a recipe change from quietly wrecking a hundred of them.
    templates.forEach(t => problems.push(...auditDesign(t.design, `${cat.category}/${t.key}`)))

    const file = `${cat.category}.json`
    fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(pack), 'utf-8')
    registry.packs.push({
      category: cat.category,
      name: cat.name,
      description: cat.description,
      icon: cat.icon,
      version: PACK_VERSION,
      templateCount: templates.length,
      file,
    })
    grandTotal += templates.length
    const kb = (fs.statSync(path.join(OUT_DIR, file)).size / 1024).toFixed(0)
    console.log(`  ${cat.icon}  ${cat.name.padEnd(16)} ${String(templates.length).padStart(3)} templates  ${kb.padStart(4)} KB`)
  }

  fs.writeFileSync(path.join(OUT_DIR, 'registry.json'), JSON.stringify(registry, null, 2), 'utf-8')

  if (problems.length) {
    console.error('\nFAILED:')
    problems.forEach(p => console.error('  - ' + p))
    process.exit(1)
  }
  console.log(`\n${registry.packs.length} packs, ${grandTotal} templates -> assets/packs`)
}

main().catch(e => { console.error(e); process.exit(1) })
