import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import sharp from 'sharp'
import toIco from 'to-ico'

const root    = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'assets', 'icon.svg')

console.log('Generating icons from assets/icon.svg...')

// ── Windows ICO (16 → 256) ──────────────────────────────────────────────────
const icoSizes  = [16, 32, 48, 64, 128, 256]
const icoBuffers = await Promise.all(
  icoSizes.map(s => sharp(svgPath).resize(s, s).png().toBuffer())
)
const ico = await toIco(icoBuffers)
writeFileSync(join(root, 'assets', 'icon.ico'), ico)
console.log('  ✓ assets/icon.ico')

const png512 = await sharp(svgPath).resize(512, 512).png().toBuffer()
writeFileSync(join(root, 'assets', 'icon.png'), png512)
console.log('  ✓ assets/icon.png')

// ── webOS PNG icons ──────────────────────────────────────────────────────────
const webos80 = await sharp(svgPath).resize(80, 80).png().toBuffer()
writeFileSync(join(root, 'tv-app-webos', 'icon.png'), webos80)
console.log('  ✓ tv-app-webos/icon.png')

const webos130 = await sharp(svgPath).resize(130, 130).png().toBuffer()
writeFileSync(join(root, 'tv-app-webos', 'icon-large.png'), webos130)
console.log('  ✓ tv-app-webos/icon-large.png')

// ── Tizen PNG icon (117×117) ─────────────────────────────────────────────────
const tizen117 = await sharp(svgPath).resize(117, 117).png().toBuffer()
writeFileSync(join(root, 'tv-app-tizen', 'icon.png'), tizen117)
console.log('  ✓ tv-app-tizen/icon.png')
