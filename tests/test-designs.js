/* Designs, template packs and scene rendering: the sanitiser's whitelist, the
   escaping guarantee in the rendered page, pack install/uninstall, and the
   playlist plumbing that puts a design on a screen. */
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const express = require(`${ROOT}/node_modules/express`)
const DIST = `${ROOT}/dist/main/server`
const { JsonDB } = require(`${DIST}/database.js`)
const { sanitizeDesign, renderSceneHtml } = require(`${DIST}/scenes.js`)
const { PackStore, validatePack } = require(`${DIST}/packs.js`)
const { createDesignsRouter } = require(`${DIST}/routes/designs.js`)
const { createPacksRouter } = require(`${DIST}/routes/packs.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { createContentRouter } = require(`${DIST}/routes/content.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-design-'))
fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true })
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const packs = new PackStore(dir, assetsDir, db)
const tvClients = new Map()
const pushed = []
tvClients.set('tv1', { readyState: 1, send: m => pushed.push(JSON.parse(m)), close() {} })

const app = express()
app.use(express.json())
app.use('/api/designs', createDesignsRouter(db, packs, path.join(dir, 'uploads'), tvClients))
app.use('/api/packs', createPacksRouter(db, packs))
app.use('/api/content', createContentRouter(db, path.join(dir, 'uploads'), {}, tvClients))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts')))

const DESIGN = {
  name: 'Test design',
  width: 1920, height: 1080,
  background: { color: '#101820', gradient: { from: '#101820', to: '#203040', angle: 160 } },
  elements: [
    { id: 'a1', type: 'text', x: 100, y: 100, w: 800, h: 200, text: 'Hello', color: '#ffffff', fontSize: 96 },
    { id: 'a2', type: 'shape', kind: 'rect', x: 0, y: 900, w: 1920, h: 120, fill: '#f59e0b' },
    { id: 'a3', type: 'qr', x: 1500, y: 100, w: 300, h: 300, data: 'https://example.com', fg: '#000000', bg: '#ffffff' },
  ],
}

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (m, u, b) => {
    const res = await fetch(base + u, {
      method: m, headers: b ? { 'content-type': 'application/json' } : {},
      body: b ? JSON.stringify(b) : undefined,
    })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status, body: json }
  }
  const text = async u => (await fetch(base + u)).text()

  console.log('\n=== sanitizeDesign: the whitelist ===')

  const good = sanitizeDesign(DESIGN)
  check('a well-formed design is accepted', good.ok === true, good.error)
  check('defaults are filled in', good.ok && good.design.elements[0].align === 'left' && good.design.elements[0].opacity === 100)

  const noName = sanitizeDesign({ ...DESIGN, name: '   ' })
  check('a blank name is rejected', noName.ok === false)

  const badColor = sanitizeDesign({ ...DESIGN, elements: [{ ...DESIGN.elements[0], color: 'red' }] })
  check('a non-hex colour is rejected', badColor.ok === false)

  const badSize = sanitizeDesign({ ...DESIGN, width: 99999 })
  check('an absurd canvas size is rejected', badSize.ok === false)

  const dup = sanitizeDesign({ ...DESIGN, elements: [DESIGN.elements[0], DESIGN.elements[0]] })
  check('duplicate element ids are rejected', dup.ok === false)

  const remoteImg = sanitizeDesign({
    ...DESIGN,
    elements: [{ id: 'i1', type: 'image', x: 0, y: 0, w: 100, h: 100, src: 'https://evil.example/x.png' }],
  })
  check('an off-server image src is rejected', remoteImg.ok === false, remoteImg.error)

  const traversal = sanitizeDesign({
    ...DESIGN,
    elements: [{ id: 'i2', type: 'image', x: 0, y: 0, w: 100, h: 100, src: '/uploads/../../db.json' }],
  })
  check('a path-traversal image src is rejected', traversal.ok === false)

  const unknownField = sanitizeDesign({
    ...DESIGN,
    elements: [{ ...DESIGN.elements[0], onclick: 'alert(1)', __proto__polluted: true }],
  })
  check('unknown element fields are dropped', unknownField.ok && !('onclick' in unknownField.design.elements[0]))

  const tooMany = sanitizeDesign({
    ...DESIGN,
    elements: Array.from({ length: 200 }, (_, i) => ({ ...DESIGN.elements[0], id: `e${i}` })),
  })
  check('an over-full canvas is rejected', tooMany.ok === false)

  console.log('\n=== renderSceneHtml: nothing a design holds becomes markup ===')

  const hostile = sanitizeDesign({
    ...DESIGN,
    name: '</title><script>alert(1)</script>',
    elements: [{
      ...DESIGN.elements[0],
      text: '</div><script>alert("xss")</script><img src=x onerror=alert(1)>',
    }],
  })
  check('hostile strings survive sanitising as data', hostile.ok === true, hostile.error)
  const html = renderSceneHtml({ ...hostile.design, id: 'x' }, '')
  check('no <script> from element text', !/<script>alert/.test(html))
  // The escaped text still *contains* the characters "onerror=", as visible
  // words — what must not exist is a real tag carrying it as an attribute.
  check('no live tag carries an event handler', !/<[a-z][^>]*\son[a-z]+\s*=/i.test(html))
  check('the img tag arrives escaped, as text', html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  check('the text is escaped instead', html.includes('&lt;script&gt;'))
  check('the title is escaped', !/<title><\/title>/.test(html) && html.includes('&lt;/title&gt;'))

  const rendered = renderSceneHtml({ ...good.design, id: 'y' }, '')
  check('the QR renders as an inline svg path', rendered.includes('<svg') && rendered.includes('shape-rendering="crispEdges"'))
  check('the stage carries the design size', rendered.includes('width:1920px') && rendered.includes('height:1080px'))

  console.log('\n=== scene pages hold the TV compatibility line ===')
  // Scene pages run on the same webOS 4 / Chrome 53 floor as the player. They
  // do use transform (to scale the stage), which is safe only because a scene
  // never contains <video> — the rule exists to protect the TV video plane.
  const scriptOf = s => [...s.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const cssOf = s => (s.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  const js = scriptOf(rendered)
  const css = cssOf(rendered).replace(/\/\*[\s\S]*?\*\//g, '')
  let parses = true
  try { new Function(js) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the scene script parses', parses)
  check('no ES2017+ in the scene script', !/\.padStart\(|Object\.entries\(|async function|=>|\?\.|\?\?/.test(js))
  check('no CSS inset shorthand', !/[^-]inset\s*:/.test(css))
  check('no flex gap', !/[^-]gap\s*:/.test(css))
  check('no CSS grid', !/display\s*:\s*grid/.test(css))
  check('no video element in a scene', !/<video/.test(rendered))

  console.log('\n=== packs: catalog, install, uninstall ===')

  const cat = await call('GET', '/api/packs')
  check('the catalog lists the bundled categories', cat.status === 200 && cat.body.categories.length >= 11, cat.body && cat.body.categories && cat.body.categories.length)
  check('categories start uninstalled', cat.body.categories.every(c => !c.installed))
  check('bundled packs are flagged available offline', cat.body.categories.every(c => c.availableOffline))

  const before = await call('GET', '/api/packs/templates?category=restaurants')
  check('templates of an uninstalled category are refused', before.status === 409)

  const inst = await call('POST', '/api/packs/restaurants/install')
  check('installing a category succeeds', inst.status === 200 && inst.body.templateCount >= 20, inst.body)

  const tpls = await call('GET', '/api/packs/templates?category=restaurants')
  check('its templates are then listed', tpls.status === 200 && tpls.body.templates.length >= 20)
  check('every template carries a full design', tpls.body.templates.every(t => t.design && Array.isArray(t.design.elements)))
  check('every template is stamped with its category', tpls.body.templates.every(t => t.category === 'restaurants'))

  const cat2 = await call('GET', '/api/packs')
  const rest = cat2.body.categories.find(c => c.category === 'restaurants')
  check('the catalog reflects the install', rest.installed === true && !rest.updateAvailable)

  console.log('\n=== designs: create from template, edit, publish ===')

  const t0 = tpls.body.templates[0]
  const created = await call('POST', '/api/designs', { fromTemplate: { category: 'restaurants', key: t0.key } })
  check('a design opens from a pack template', created.status === 201 && created.body.design.id, created.body)
  check('it keeps its template provenance', created.body.design.category === 'restaurants' && created.body.design.templateKey === t0.key)
  const did = created.body.design.id

  const missing = await call('POST', '/api/designs', { fromTemplate: { category: 'restaurants', key: 'no-such-key' } })
  check('an unknown template key 404s', missing.status === 404)

  const notInstalled = await call('POST', '/api/designs', { fromTemplate: { category: 'gym', key: 'anything' } })
  check('a template from an uninstalled category 404s', notInstalled.status === 404)

  const edited = await call('PUT', `/api/designs/${did}`, {
    ...DESIGN, name: 'Edited menu',
  })
  check('a design saves', edited.status === 200 && edited.body.design.name === 'Edited menu', edited.body)
  check('provenance survives an edit', edited.body.design.category === 'restaurants')

  const badEdit = await call('PUT', `/api/designs/${did}`, { ...DESIGN, elements: [{ id: 'z', type: 'text', x: 0, y: 0, w: 10, h: 10, color: 'notacolour' }] })
  check('an invalid edit is refused with a reason', badEdit.status === 400 && typeof badEdit.body.error === 'string')

  const stillGood = await call('GET', `/api/designs/${did}`)
  check('the rejected edit did not land', stillGood.body.design.name === 'Edited menu')

  const scene = await text(`/tv/scene/${did}`)
  check('the design renders as a scene page', scene.includes('<div id="stage">') && scene.includes('Hello'))

  const missingScene = await fetch(`${base}/tv/scene/does-not-exist`)
  check('an unknown scene 404s without leaking a stack', missingScene.status === 404)

  const tplScene = await text(`/tv/template/restaurants/${t0.key}`)
  check('a pack template previews without being saved first', tplScene.includes('<div id="stage">'))

  pushed.length = 0
  const published = await call('POST', `/api/designs/${did}/publish`, { durationSeconds: 20 })
  check('publishing creates a playlist item', published.status === 201 && published.body.item.type === 'design')
  check('the item points at the design', published.body.item.designId === did)
  check('the duration is honoured', published.body.item.durationSeconds === 20)
  check('screens are told to refresh', pushed.some(m => m.type === 'playlist_update'))

  const republished = await call('POST', `/api/designs/${did}/publish`, { durationSeconds: 30 })
  check('publishing twice updates rather than duplicating', republished.status === 200)
  const items = await call('GET', '/api/content')
  check('there is exactly one item for the design', items.body.items.filter(i => i.designId === did).length === 1)
  check('the update took effect', items.body.items.find(i => i.designId === did).durationSeconds === 30)

  const active = await call('GET', '/api/content/active')
  const activeDesign = active.body.items.find(i => i.designId === did)
  check('the design reaches the TV playlist', !!activeDesign && activeDesign.type === 'design')

  console.log('\n=== content guards ===')

  const orphan = await call('POST', '/api/content', { type: 'design', designId: 'nope', name: 'x' })
  check('a content item pointing at no design is refused', orphan.status === 400)

  pushed.length = 0
  const del = await call('DELETE', `/api/designs/${did}`)
  check('deleting a design succeeds', del.status === 200 && del.body.removedFromPlaylist === 1)
  const after = await call('GET', '/api/content')
  check('its playlist item goes with it', after.body.items.filter(i => i.designId === did).length === 0)
  check('screens are told about the removal', pushed.some(m => m.type === 'playlist_update'))

  console.log('\n=== the team\'s own template library ===')

  const src = await call('POST', '/api/designs', { ...DESIGN, name: 'House style' })
  const srcId = src.body.design.id
  const asTpl = await call('POST', `/api/designs/${srcId}/save-as-template`, {})
  check('a design can be saved as a template', asTpl.status === 201 && asTpl.body.template.isTemplate === true, asTpl.body)
  check('the template is a copy, not the same record', asTpl.body.template.id !== srcId)

  const designsOnly = await call('GET', '/api/designs')
  check('templates do not clutter the designs list',
    designsOnly.body.designs.every(d => !d.isTemplate))
  const templatesOnly = await call('GET', '/api/designs?templates=1')
  check('and are listed on their own', templatesOnly.body.designs.length === 1
    && templatesOnly.body.designs[0].name === 'House style')

  // Editing the design must not retroactively change the saved template.
  await call('PUT', `/api/designs/${srcId}`, { ...DESIGN, name: 'House style', elements: [] })
  const afterEdit = await call('GET', '/api/designs?templates=1')
  check('editing the design leaves the template alone',
    afterEdit.body.designs[0].elements.length === DESIGN.elements.length,
    afterEdit.body.designs[0].elements.length)

  const again = await call('POST', `/api/designs/${srcId}/save-as-template`, { name: 'House style' })
  check('saving the same name updates rather than duplicating', again.status === 200 && again.body.replaced === true)
  const stillOne = await call('GET', '/api/designs?templates=1')
  check('there is still one template', stillOne.body.designs.length === 1)
  check('and it now matches the edited design', stillOne.body.designs[0].elements.length === 0)

  console.log('\n=== uninstall keeps the operator\'s own work ===')

  const kept = await call('POST', '/api/designs', { fromTemplate: { category: 'restaurants', key: t0.key }, name: 'Mine' })
  const keptId = kept.body.design.id
  const uninst = await call('DELETE', '/api/packs/restaurants')
  check('a category uninstalls', uninst.status === 200)
  const gone = await call('GET', '/api/packs/templates?category=restaurants')
  check('its templates disappear from the library', gone.status === 409)
  const mine = await call('GET', `/api/designs/${keptId}`)
  check('a design made from it survives', mine.status === 200 && mine.body.design.name === 'Mine')

  const reinst = await call('POST', '/api/packs/restaurants/install')
  check('re-installing works offline from the cache', reinst.status === 200 && reinst.body.templateCount >= 20)

  console.log('\n=== validatePack rejects junk from any source ===')
  check('a pack with a bad format version is refused', validatePack({ formatVersion: 9, category: 'x', templates: [] }).ok === false)
  check('a pack with no templates is refused', validatePack({ formatVersion: 1, category: 'x', name: 'X', version: '1', templates: [] }).ok === false)
  check('a category mismatch is refused',
    validatePack({ formatVersion: 1, category: 'a', name: 'A', version: '1', templates: [{ key: 'k', design: DESIGN }] }, 'b').ok === false)
  const poisoned = validatePack({
    formatVersion: 1, category: 'x', name: 'X', version: '1',
    templates: [{ key: 'k', name: 'K', design: { ...DESIGN, elements: [{ id: 'p', type: 'image', x: 0, y: 0, w: 1, h: 1, src: 'https://evil.example/x.png' }] } }],
  })
  check('a pack carrying an off-server image is refused', poisoned.ok === false, poisoned.error)

  console.log('\n=== every shipped pack is loadable and complete ===')
  const registry = JSON.parse(fs.readFileSync(path.join(assetsDir, 'packs', 'registry.json'), 'utf-8'))
  check('the registry declares 11 categories', registry.packs.length === 11, registry.packs.length)
  let packProblems = []
  let templateTotal = 0
  for (const entry of registry.packs) {
    const raw = JSON.parse(fs.readFileSync(path.join(assetsDir, 'packs', entry.file), 'utf-8'))
    const v = validatePack(raw, entry.category)
    if (!v.ok) { packProblems.push(`${entry.category}: ${v.error}`); continue }
    if (v.pack.templates.length < 20) packProblems.push(`${entry.category}: only ${v.pack.templates.length}`)
    templateTotal += v.pack.templates.length
    // A template nobody can read is worse than no template: check each one
    // actually renders rather than merely validating.
    for (const t of v.pack.templates) {
      const out = renderSceneHtml({ ...t.design, id: t.key }, '')
      if (!out.includes('<div id="stage">')) packProblems.push(`${entry.category}/${t.key}: did not render`)
    }
  }
  check('every pack validates and every template renders', packProblems.length === 0, packProblems.slice(0, 5))
  check('the library ships 220+ templates', templateTotal >= 220, templateTotal)

  console.log(`\n${pass} passed, ${fail} failed`)
  server.close()
  process.exit(fail ? 1 : 0)
})
