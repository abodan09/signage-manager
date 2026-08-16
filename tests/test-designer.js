/* Designer parity: typed QR payload building, the shape library, and live
   widgets — validation, rendering, and the TV compatibility floor. */
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const DIST = `${ROOT}/dist/main/server`
const { sanitizeDesign, renderSceneHtml, SHAPE_POINTS } = require(`${DIST}/scenes.js`)
const { QR_KINDS, buildQrData, validateQr, getQrKind } = require(`${DIST}/qr-kinds.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const BASE = {
  name: 'Test', width: 1920, height: 1080,
  background: { color: '#101820' },
  elements: [],
}
const withEls = els => ({ ...BASE, elements: els })

console.log('\n=== QR codes: an operator picks what it does, not how it encodes ===')

check('every kind declares fields and a hint',
  QR_KINDS.every(k => k.kind && k.label && k.icon && Array.isArray(k.fields) && k.hint))
check('every kind is retrievable by name', QR_KINDS.every(k => !!getQrKind(k.kind)))

check('a website URL passes through', buildQrData('url', { url: 'https://example.com/menu' }) === 'https://example.com/menu')
check('a bare domain gains a scheme, or a camera treats it as plain text',
  buildQrData('url', { url: 'example.com' }) === 'https://example.com')
check('an existing scheme is left alone',
  buildQrData('url', { url: 'http://example.com' }) === 'http://example.com')

check('email builds a mailto with subject and body',
  buildQrData('email', { to: 'a@b.com', subject: 'Hi there', body: 'Hello!' })
    === 'mailto:a@b.com?subject=Hi%20there&body=Hello!')
check('email without extras is a bare mailto',
  buildQrData('email', { to: 'a@b.com' }) === 'mailto:a@b.com')

check('a phone number is stripped to digits and plus',
  buildQrData('phone', { phone: '+1 (555) 123-4567' }) === 'tel:+15551234567')
check('sms carries a prefilled body',
  buildQrData('sms', { phone: '+15551234567', message: 'JOIN' }) === 'sms:+15551234567?body=JOIN')

check('wifi builds the WIFI: grammar',
  buildQrData('wifi', { ssid: 'Guest', password: 'hunter2', security: 'WPA' })
    === 'WIFI:T:WPA;S:Guest;P:hunter2;;')
check('an open network omits the password',
  buildQrData('wifi', { ssid: 'Guest', password: 'x', security: 'nopass' }) === 'WIFI:T:nopass;S:Guest;;')
check('a hidden network is flagged',
  buildQrData('wifi', { ssid: 'G', password: 'p', security: 'WPA', hidden: 'true' }).includes(';H:true'))
// Separators inside a value silently truncate the code if they are not escaped.
check('semicolons and colons in a password are escaped',
  buildQrData('wifi', { ssid: 'Caf;e', password: 'a:b;c', security: 'WPA' })
    === 'WIFI:T:WPA;S:Caf\\;e;P:a\\:b\\;c;;')

check('whatsapp builds a wa.me link',
  buildQrData('whatsapp', { phone: '+1 555 123 4567', message: 'Hi' }) === 'https://wa.me/15551234567?text=Hi')
check('a social handle becomes a profile URL',
  buildQrData('instagram', { handle: 'yourhandle' }) === 'https://instagram.com/yourhandle')
check('a leading @ is dropped', buildQrData('instagram', { handle: '@yourhandle' }) === 'https://instagram.com/yourhandle')
check('a full social URL is respected',
  buildQrData('facebook', { handle: 'https://facebook.com/page' }) === 'https://facebook.com/page')
check('plain text is encoded verbatim', buildQrData('text', { text: 'Ask at the bar' }) === 'Ask at the bar')

console.log('\n--- and it refuses codes nobody could scan usefully ---')
check('a blank URL is caught', !!validateQr('url', {}))
check('a bad email is caught', !!validateQr('email', { to: 'nope' }))
check('a good email passes', validateQr('email', { to: 'a@b.com' }) === null)
check('a short phone number is caught', !!validateQr('phone', { phone: '12' }))
check('wifi without a password is caught', !!validateQr('wifi', { ssid: 'G', security: 'WPA' }))
check('an open wifi network needs no password', validateQr('wifi', { ssid: 'G', security: 'nopass' }) === null)

console.log('\n=== the design stores the kind, and re-derives the payload ===')

const qr = sanitizeDesign(withEls([{
  id: 'q1', type: 'qr', x: 0, y: 0, w: 300, h: 300,
  kind: 'wifi', fields: { ssid: 'Guest', password: 'hunter2', security: 'WPA' },
  data: 'https://stale-value-that-should-be-replaced.example',
  fg: '#000000', bg: '#ffffff',
}]))
check('a typed QR is accepted', qr.ok === true, qr.error)
check('the payload is rebuilt from the fields, never trusted from the client',
  qr.ok && qr.design.elements[0].data === 'WIFI:T:WPA;S:Guest;P:hunter2;;', qr.ok && qr.design.elements[0].data)
check('the kind and fields round-trip for editing',
  qr.ok && qr.design.elements[0].kind === 'wifi' && qr.design.elements[0].fields.ssid === 'Guest')
check('an unknown kind is refused',
  sanitizeDesign(withEls([{ id: 'q', type: 'qr', x: 0, y: 0, w: 10, h: 10, kind: 'telepathy', fg: '#000000' }])).ok === false)

const legacy = sanitizeDesign(withEls([{ id: 'q2', type: 'qr', x: 0, y: 0, w: 300, h: 300, data: 'https://old.example', fg: '#000000' }]))
check('a design saved before typed kinds still works',
  legacy.ok && legacy.design.elements[0].data === 'https://old.example' && !legacy.design.elements[0].kind)

console.log('\n=== the shape library ===')

const KINDS = ['rect', 'ellipse', 'triangle', 'line', 'triangle-down', 'diamond', 'pentagon',
  'hexagon', 'star', 'burst', 'arrow-right', 'arrow-left', 'chevron', 'banner', 'shield', 'badge']
const badShape = KINDS.filter(kind =>
  !sanitizeDesign(withEls([{ id: 's1', type: 'shape', kind, x: 0, y: 0, w: 100, h: 100, fill: '#3b82f6' }])).ok)
check('every shape kind validates', badShape.length === 0, badShape)

const notDrawn = KINDS.filter(kind => {
  const d = sanitizeDesign(withEls([{ id: 's1', type: 'shape', kind, x: 0, y: 0, w: 100, h: 100, fill: '#3b82f6' }]))
  const html = renderSceneHtml({ ...d.design, id: 'x' }, '')
  return !/<svg/.test(html) || !/(polygon|rect|ellipse|line)/.test(html)
})
check('every shape kind draws something', notDrawn.length === 0, notDrawn)
check('polygon points stay inside the unit box',
  Object.values(SHAPE_POINTS).every(pts => pts.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)))
check('an unknown shape kind is refused',
  sanitizeDesign(withEls([{ id: 's', type: 'shape', kind: 'dodecahedron', x: 0, y: 0, w: 10, h: 10 }])).ok === false)

console.log('\n=== live widgets ===')

const widgets = [
  { kind: 'clock', config: { format: '12h-ampm', showSeconds: true, timezoneOffset: 3600, label: 'Paris' } },
  { kind: 'date', config: { format: 'long', timezoneOffset: null } },
  { kind: 'weather', config: { appInstanceId: 'abc-123', show: 'full' } },
  { kind: 'scroll', config: { text: 'Welcome to the building', speed: 12, direction: 'left' } },
]
widgets.forEach(w => {
  const d = sanitizeDesign(withEls([{
    id: 'w1', type: 'widget', x: 0, y: 0, w: 600, h: 200,
    kind: w.kind, config: w.config, color: '#ffffff', fontSize: 90,
  }]))
  check(`a ${w.kind} widget validates`, d.ok === true, d.error)
})

check('an unknown widget kind is refused',
  sanitizeDesign(withEls([{ id: 'w', type: 'widget', kind: 'tarot', x: 0, y: 0, w: 10, h: 10 }])).ok === false)
check('a bad clock format is refused',
  sanitizeDesign(withEls([{ id: 'w', type: 'widget', kind: 'clock', config: { format: 'swatch-beats' }, x: 0, y: 0, w: 10, h: 10 }])).ok === false)
check('an out-of-range scroll speed is refused',
  sanitizeDesign(withEls([{ id: 'w', type: 'widget', kind: 'scroll', config: { text: 'x', speed: 500 }, x: 0, y: 0, w: 10, h: 10 }])).ok === false)
check('a hostile app reference is refused',
  sanitizeDesign(withEls([{ id: 'w', type: 'widget', kind: 'weather', config: { appInstanceId: '../../etc/passwd' }, x: 0, y: 0, w: 10, h: 10 }])).ok === false)

const live = sanitizeDesign(withEls(widgets.map((w, i) => ({
  id: 'w' + i, type: 'widget', x: 0, y: i * 200, w: 900, h: 180,
  kind: w.kind, config: w.config, color: '#ffffff', fontSize: 80,
}))))
check('a design of four widgets validates', live.ok === true, live.error)
const html = renderSceneHtml({ ...live.design, id: 'x' }, '')
check('widgets carry their kind and config into the page',
  (html.match(/data-widget=/g) || []).length === 4)
check('the runtime is included when widgets are present', html.includes('data-widget'))
check('the runtime updates on a timer', html.includes('setInterval'))

const still = renderSceneHtml({ ...sanitizeDesign(withEls([
  { id: 't', type: 'text', x: 0, y: 0, w: 100, h: 50, text: 'Hi', color: '#ffffff' },
])).design, id: 'y' }, '')
check('a design with no widgets ships no widget runtime', !still.includes('data-widget'))

console.log('\n--- widget config cannot become markup ---')
const nasty = sanitizeDesign(withEls([{
  id: 'w1', type: 'widget', kind: 'scroll', x: 0, y: 0, w: 600, h: 200,
  config: { text: '</script><script>alert(1)</script>', speed: 10 },
  color: '#ffffff', fontSize: 60,
}]))
check('hostile widget text survives as data', nasty.ok === true)
const nastyHtml = renderSceneHtml({ ...nasty.design, id: 'z' }, '')
check('it does not close the script block', !/<\/script><script>alert/.test(nastyHtml))
check('no live tag carries an event handler', !/<[a-z][^>]*\son[a-z]+\s*=/i.test(nastyHtml))
check('the config attribute is escaped', nastyHtml.includes('&lt;/script&gt;') || nastyHtml.includes('&lt;script&gt;'))

console.log('\n=== effects ===')

const fx = sanitizeDesign(withEls([
  { id: 't', type: 'text', x: 0, y: 0, w: 800, h: 200, text: 'Hi', color: '#ffffff', fontSize: 90,
    shadow: { color: '#000000', blur: 20, x: 4, y: 8, opacity: 60 },
    outline: { color: '#ff0000', width: 3 } },
  { id: 's', type: 'shape', kind: 'star', x: 0, y: 300, w: 300, h: 300,
    gradient: { from: '#3b82f6', to: '#8b5cf6', angle: 45 },
    shadow: { color: '#000000', blur: 10, x: 6, y: 6, opacity: 40 } },
  { id: 'i', type: 'image', x: 0, y: 700, w: 400, h: 300, src: '/uploads/a.jpg',
    shadow: { color: '#000000', blur: 24, x: 0, y: 12, opacity: 50 } },
]))
check('shadow, outline and gradient all validate', fx.ok === true, fx.error)
check('effects are stored on the elements',
  fx.ok && !!fx.design.elements[0].shadow && !!fx.design.elements[0].outline
    && !!fx.design.elements[1].gradient && !!fx.design.elements[2].shadow)

const fxHtml = renderSceneHtml({ ...fx.design, id: 'fx' }, '')
check('text shadow renders as text-shadow', /text-shadow:4px 8px 20px/.test(fxHtml))
// -webkit prefix, not the unprefixed property: every TV browser in the fleet
// is Blink or WebKit, and none of them implement the unprefixed one.
check('text outline renders as -webkit-text-stroke', fxHtml.includes('-webkit-text-stroke:3px #ff0000'))
check('a shape gradient becomes an svg linearGradient', fxHtml.includes('<linearGradient'))
check('the gradient is referenced by the fill', /fill="url\(#g\d+\)"/.test(fxHtml))
// box-shadow on a star would draw its bounding rectangle, so a polygon shadow
// has to be a second copy of the shape.
check('a polygon shadow is a second polygon, not a box-shadow',
  (fxHtml.match(/<polygon/g) || []).length >= 2)
check('an image shadow uses box-shadow', /box-shadow:0px 12px 24px/.test(fxHtml))
// drop-shadow() is Chrome 79+ for SVG and unsafe on the oldest panels.
check('no filter: drop-shadow anywhere', !/drop-shadow\(/.test(fxHtml))

check('a bad shadow colour is refused',
  sanitizeDesign(withEls([{ id: 't', type: 'text', x: 0, y: 0, w: 10, h: 10, color: '#ffffff', shadow: { color: 'black' } }])).ok === false)
check('an out-of-range blur is refused',
  sanitizeDesign(withEls([{ id: 't', type: 'text', x: 0, y: 0, w: 10, h: 10, color: '#ffffff', shadow: { color: '#000000', blur: 9999 } }])).ok === false)
check('a bad gradient colour is refused',
  sanitizeDesign(withEls([{ id: 's', type: 'shape', kind: 'rect', x: 0, y: 0, w: 10, h: 10, gradient: { from: 'red', to: '#000000' } }])).ok === false)

const noFx = sanitizeDesign(withEls([{ id: 't', type: 'text', x: 0, y: 0, w: 10, h: 10, text: 'x', color: '#ffffff' }]))
check('a design without effects carries no effect fields',
  noFx.ok && !('shadow' in noFx.design.elements[0]) && !('outline' in noFx.design.elements[0]))
check('and renders no shadow declarations',
  !/text-shadow|box-shadow/.test(renderSceneHtml({ ...noFx.design, id: 'n' }, '')))

// Two gradients on one page must not collide on an svg id.
const twoGrad = sanitizeDesign(withEls([
  { id: 'g1', type: 'shape', kind: 'rect', x: 0, y: 0, w: 100, h: 100, gradient: { from: '#111111', to: '#222222', angle: 0 } },
  { id: 'g2', type: 'shape', kind: 'rect', x: 0, y: 200, w: 100, h: 100, gradient: { from: '#333333', to: '#444444', angle: 0 } },
]))
const twoHtml = renderSceneHtml({ ...twoGrad.design, id: 'tg' }, '')
const ids = [...twoHtml.matchAll(/<linearGradient id="([^"]+)"/g)].map(m => m[1])
check('each gradient gets its own id', ids.length === 2 && ids[0] !== ids[1], ids)

console.log('\n=== quoted font stacks survive the style attribute ===')
// A font stack is "Inter", Arial — the quote closes style="…" early and every
// declaration after it is thrown away. The React canvas sets styles as
// properties so it never showed this; only a real screen did.
const fonted = sanitizeDesign(withEls([
  { id: 't1', type: 'text', x: 0, y: 0, w: 900, h: 200, text: 'WELCOME', font: 'bebas', fontSize: 96, color: '#ffffff' },
  { id: 'w1', type: 'widget', kind: 'clock', x: 0, y: 300, w: 600, h: 150, font: 'inter', fontSize: 88, color: '#ffffff', config: { format: '24h' } },
]))
check('a design using bundled fonts validates', fonted.ok === true, fonted.error)
const fontedHtml = renderSceneHtml({ ...fonted.design, id: 'f' }, '')
// The exact defect: a raw quote immediately after font-family: closes the
// attribute. If that never appears, nothing downstream of it can be lost.
check('no raw quote follows font-family', !/font-family:"/.test(fontedHtml))
check('the font family is escaped, not truncated', fontedHtml.includes('&quot;Bebas Neue&quot;'))
check('the text font size reaches the page', fontedHtml.includes('font-size:96px'))
check('the widget font size reaches the page', fontedHtml.includes('font-size:88px'))

console.log('\n=== the scene page still holds the TV floor ===')
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
let parses = true
try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
check('the page parses', parses)
check('no arrow functions', !/=>/.test(scripts))
check('no async/await', !/async function|await /.test(scripts))
check('no optional chaining or nullish coalescing', !/\?\.|\?\?/.test(scripts))
check('no String.padStart', !scripts.includes('.padStart('))
check('no Object.entries or values', !/Object\.(entries|values)\(/.test(scripts))
check('no fetch — XMLHttpRequest only', !/\bfetch\(/.test(scripts))
check('no CSS grid', !/display\s*:\s*grid/.test(css))
check('no flex gap', !/[^-]gap\s*:/.test(css))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
