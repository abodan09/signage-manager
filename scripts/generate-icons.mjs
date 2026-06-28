import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import sharp from 'sharp'
import toIco from 'to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'assets', 'icon.svg')

console.log('Generating icons from assets/icon.svg...')

const sizes = [16, 32, 48, 64, 128, 256]
const pngBuffers = await Promise.all(
  sizes.map(s => sharp(svgPath).resize(s, s).png().toBuffer())
)

const ico = await toIco(pngBuffers)
writeFileSync(join(root, 'assets', 'icon.ico'), ico)
console.log('  ✓ assets/icon.ico')

const png512 = await sharp(svgPath).resize(512, 512).png().toBuffer()
writeFileSync(join(root, 'assets', 'icon.png'), png512)
console.log('  ✓ assets/icon.png')
