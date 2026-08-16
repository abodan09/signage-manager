import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Design, PackTemplate, SceneBackground, SceneElement } from '../types'
import { SceneElementView, backgroundStyle } from '../scene/SceneView'
import { useSceneFonts } from '../scene/fonts'
import { Inspector } from '../designer/Inspector'
import {
  BackgroundPanel, ElementsPanel, LayersPanel, PANELS, PhotosPanel, PanelId,
  QrPanel, TemplatesPanel, TextPanel, WidgetsPanel,
} from '../designer/Panels'
import { PushToScreens } from '../designer/PushToScreens'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

const RAIL_W = 74
const PANEL_W = 256
const INSPECTOR_W = 268
const SNAP = 10          // design-space px within which an edge sticks
const MAX_HISTORY = 60

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

interface Drag {
  mode: 'move' | 'resize'
  handle?: Handle
  startX: number
  startY: number
  origin: { x: number; y: number; w: number; h: number }
}

const CANVAS_PRESETS = [
  { label: 'Landscape 1920 × 1080', w: 1920, h: 1080 },
  { label: 'Portrait 1080 × 1920', w: 1080, h: 1920 },
  { label: 'Landscape 4K 3840 × 2160', w: 3840, h: 2160 },
  { label: 'Square 1080 × 1080', w: 1080, h: 1080 },
]

export default function DesignerPage() {
  const { id } = useParams<{ id: string }>()
  const serverUrl = useServerUrl()
  const navigate = useNavigate()
  useSceneFonts(serverUrl)

  const [design, setDesign] = useState<Design | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<PanelId>('templates')
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [assets, setAssets] = useState<Array<{ path: string; name: string }>>([])
  const [showPush, setShowPush] = useState(false)
  const [showResize, setShowResize] = useState(false)
  const [confirmTemplate, setConfirmTemplate] = useState<PackTemplate | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })

  const past = useRef<Design[]>([])
  const future = useRef<Design[]>([])
  const dragRef = useRef<Drag | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })

  // ── load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!serverUrl || !id) return
    fetch(`${serverUrl}/api/designs/${id}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Design not found')
        return d
      })
      .then(d => setDesign(d.design))
      .catch((e: Error) => setError(e.message))
  }, [serverUrl, id])

  const loadAssets = useCallback(() => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/designs/assets`)
      .then(r => r.json())
      .then(d => setAssets(d.assets ?? []))
      .catch(() => { /* the photo panel just shows nothing */ })
  }, [serverUrl])
  useEffect(() => { loadAssets() }, [loadAssets])

  // A weather widget points at a configured Weather app rather than carrying
  // its own location, so the inspector needs the list to choose from.
  const [weatherApps, setWeatherApps] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/apps/instances`)
      .then(r => r.json())
      .then(d => setWeatherApps((d.instances ?? []).filter((i: { appId: string }) => i.appId === 'weather')))
      .catch(() => { /* the widget then prompts to set one up */ })
  }, [serverUrl])

  // ── viewport measuring (drives "fit" zoom) ─────────────────────────────────

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setViewport({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [design !== null])

  const scale = useMemo(() => {
    if (!design) return 1
    if (zoom !== 'fit') return zoom
    if (!viewport.w || !viewport.h) return 0.3
    return Math.min((viewport.w - 64) / design.width, (viewport.h - 64) / design.height)
  }, [zoom, viewport, design])

  // ── history ────────────────────────────────────────────────────────────────

  /** Snapshot before a change. Call once per gesture, not per pointer move. */
  const snapshot = useCallback(() => {
    setDesign(d => {
      if (d) {
        past.current = [...past.current.slice(-(MAX_HISTORY - 1)), d]
        future.current = []
      }
      return d
    })
  }, [])

  const mutate = useCallback((fn: (d: Design) => Design) => {
    setDesign(d => (d ? fn(d) : d))
    setDirty(true)
  }, [])

  /** A discrete change: snapshot then apply, so one undo reverses it. */
  const commit = useCallback((fn: (d: Design) => Design) => {
    snapshot()
    mutate(fn)
  }, [snapshot, mutate])

  const undo = useCallback(() => {
    setDesign(cur => {
      const prev = past.current.pop()
      if (!prev || !cur) return cur
      future.current = [cur, ...future.current].slice(0, MAX_HISTORY)
      setDirty(true)
      return prev
    })
  }, [])

  const redo = useCallback(() => {
    setDesign(cur => {
      const next = future.current.shift()
      if (!next || !cur) return cur
      past.current = [...past.current, cur].slice(-MAX_HISTORY)
      setDirty(true)
      return next
    })
  }, [])

  // ── element helpers ────────────────────────────────────────────────────────

  const selected = useMemo(
    () => design?.elements.find(e => e.id === selectedId) ?? null,
    [design, selectedId],
  )

  const newId = useCallback(() => `el-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`, [])

  const addElement = useCallback((partial: Partial<SceneElement>) => {
    if (!design) return
    const w = (partial.w as number) ?? 600
    const h = (partial.h as number) ?? 200
    const base = {
      id: newId(),
      x: partial.x ?? Math.round((design.width - w) / 2),
      y: partial.y ?? Math.round((design.height - h) / 2),
      w, h, rotation: 0, opacity: 100,
    }
    const defaults: Record<string, object> = {
      text: { text: 'Text', font: 'inter', fontSize: 48, bold: false, italic: false, underline: false, align: 'left', valign: 'middle', color: '#ffffff', lineHeight: 1.15, letterSpacing: 0, bgColor: null, bgOpacity: 100, radius: 0 },
      shape: { kind: 'rect', fill: '#3b82f6', fillOpacity: 100, stroke: null, strokeWidth: 0, radius: 0 },
      image: { src: null, fit: 'cover', radius: 0 },
      qr: { data: 'https://example.com', fg: '#000000', bg: '#ffffff' },
      widget: { kind: 'clock', config: {}, font: 'inter', fontSize: 96, bold: false, color: '#ffffff', align: 'center', bgColor: null, bgOpacity: 100, radius: 0 },
    }
    const type = partial.type ?? 'text'
    const el = { ...base, ...defaults[type], ...partial, id: base.id } as SceneElement
    commit(d => ({ ...d, elements: [...d.elements, el] }))
    setSelectedId(el.id)
  }, [design, commit, newId])

  const patchElement = useCallback((elId: string, patch: Partial<SceneElement>, withHistory = true) => {
    const fn = (d: Design) => ({
      ...d,
      elements: d.elements.map(e => (e.id === elId ? { ...e, ...patch } as SceneElement : e)),
    })
    withHistory ? commit(fn) : mutate(fn)
  }, [commit, mutate])

  const deleteElement = useCallback((elId: string) => {
    commit(d => ({ ...d, elements: d.elements.filter(e => e.id !== elId) }))
    setSelectedId(cur => (cur === elId ? null : cur))
  }, [commit])

  const duplicateElement = useCallback((elId: string) => {
    if (!design) return
    const src = design.elements.find(e => e.id === elId)
    if (!src) return
    const copy = { ...src, id: newId(), x: src.x + 32, y: src.y + 32 } as SceneElement
    commit(d => ({ ...d, elements: [...d.elements, copy] }))
    setSelectedId(copy.id)
  }, [design, commit, newId])

  const reorder = useCallback((elId: string, dir: 'front' | 'forward' | 'backward' | 'back') => {
    commit(d => {
      const i = d.elements.findIndex(e => e.id === elId)
      if (i === -1) return d
      const els = [...d.elements]
      const [el] = els.splice(i, 1)
      const to = dir === 'front' ? els.length
        : dir === 'back' ? 0
        : dir === 'forward' ? Math.min(els.length, i + 1)
        : Math.max(0, i - 1)
      els.splice(to, 0, el)
      return { ...d, elements: els }
    })
  }, [commit])

  const alignToCanvas = useCallback((how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    if (!design || !selected) return
    const patch: Partial<SceneElement> = {}
    if (how === 'left') patch.x = 0
    if (how === 'hcenter') patch.x = Math.round((design.width - selected.w) / 2)
    if (how === 'right') patch.x = design.width - selected.w
    if (how === 'top') patch.y = 0
    if (how === 'vcenter') patch.y = Math.round((design.height - selected.h) / 2)
    if (how === 'bottom') patch.y = design.height - selected.h
    patchElement(selected.id, patch)
  }, [design, selected, patchElement])

  // ── pointer interactions ───────────────────────────────────────────────────

  const snapValue = useCallback((value: number, targets: number[], tol: number) => {
    for (const t of targets) if (Math.abs(value - t) <= tol) return t
    return null
  }, [])

  const onElementPointerDown = useCallback((e: React.PointerEvent, el: SceneElement) => {
    if (el.locked) return
    e.stopPropagation()
    setSelectedId(el.id)
    snapshot()
    dragRef.current = {
      mode: 'move',
      startX: e.clientX, startY: e.clientY,
      origin: { x: el.x, y: el.y, w: el.w, h: el.h },
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }, [snapshot])

  const onHandlePointerDown = useCallback((e: React.PointerEvent, el: SceneElement, handle: Handle) => {
    e.stopPropagation()
    snapshot()
    dragRef.current = {
      mode: 'resize', handle,
      startX: e.clientX, startY: e.clientY,
      origin: { x: el.x, y: el.y, w: el.w, h: el.h },
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }, [snapshot])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || !design || !selectedId) return
    const dx = (e.clientX - drag.startX) / scale
    const dy = (e.clientY - drag.startY) / scale
    const o = drag.origin

    if (drag.mode === 'move') {
      let x = Math.round(o.x + dx)
      let y = Math.round(o.y + dy)
      const vGuides: number[] = []
      const hGuides: number[] = []
      if (!e.altKey) {
        // Edges and centres of the canvas are the lines people actually align
        // to; holding Alt turns the magnet off for fine placement.
        const vTargets = [0, (design.width - o.w) / 2, design.width - o.w]
        const hTargets = [0, (design.height - o.h) / 2, design.height - o.h]
        const sx = snapValue(x, vTargets, SNAP / scale)
        const sy = snapValue(y, hTargets, SNAP / scale)
        if (sx !== null) { x = Math.round(sx); vGuides.push(x === 0 ? 0 : x + o.w / 2) }
        if (sy !== null) { y = Math.round(sy); hGuides.push(y === 0 ? 0 : y + o.h / 2) }
      }
      setGuides({ v: vGuides, h: hGuides })
      patchElement(selectedId, { x, y }, false)
      return
    }

    const h = drag.handle!
    let { x, y, w, hgt } = { x: o.x, y: o.y, w: o.w, hgt: o.h }
    if (h.includes('e')) w = o.w + dx
    if (h.includes('s')) hgt = o.h + dy
    if (h.includes('w')) { w = o.w - dx; x = o.x + dx }
    if (h.includes('n')) { hgt = o.h - dy; y = o.y + dy }
    // Corner drags keep the aspect ratio unless Shift is held — the reverse of
    // most apps, but it matches what people expect when scaling a photo.
    if (!e.shiftKey && h.length === 2) {
      const ratio = o.w / o.h
      if (Math.abs(w - o.w) > Math.abs(hgt - o.h)) hgt = w / ratio
      else w = hgt * ratio
      if (h.includes('w')) x = o.x + (o.w - w)
      if (h.includes('n')) y = o.y + (o.h - hgt)
    }
    patchElement(selectedId, {
      x: Math.round(x), y: Math.round(y),
      w: Math.max(8, Math.round(w)), h: Math.max(8, Math.round(hgt)),
    }, false)
  }, [design, selectedId, scale, patchElement, snapValue])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    setGuides({ v: [], h: [] })
  }, [])

  // ── keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
      if (typing) return
      if (mod && e.key.toLowerCase() === 'd' && selectedId) { e.preventDefault(); duplicateElement(selectedId); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteElement(selectedId); return }
      if (e.key === 'Escape') { setSelectedId(null); return }
      if (selectedId && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const el = design?.elements.find(x => x.id === selectedId)
        if (!el) return
        const patch = e.key === 'ArrowLeft' ? { x: el.x - step }
          : e.key === 'ArrowRight' ? { x: el.x + step }
          : e.key === 'ArrowUp' ? { y: el.y - step }
          : { y: el.y + step }
        patchElement(selectedId, patch)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, design, undo, redo, duplicateElement, deleteElement, patchElement])

  // ── save / publish ─────────────────────────────────────────────────────────

  const save = useCallback(async (): Promise<boolean> => {
    if (!design) return false
    setSaving(true); setError('')
    try {
      const res = await fetch(`${serverUrl}/api/designs/${design.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: design.name,
          width: design.width, height: design.height,
          background: design.background,
          elements: design.elements,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save this design')
      setDesign(data.design)
      setDirty(false)
      setStatus('Saved')
      setTimeout(() => setStatus(''), 2000)
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save this design')
      return false
    } finally {
      setSaving(false)
    }
  }, [design, serverUrl])

  function applyTemplate(t: PackTemplate) {
    commit(d => ({
      ...d,
      width: t.design.width,
      height: t.design.height,
      background: t.design.background,
      elements: t.design.elements,
      category: t.category,
      templateKey: t.key,
      // The document keeps its own name unless it was never renamed.
      name: /^untitled/i.test(d.name) ? t.name : d.name,
    }))
    setSelectedId(null)
    setConfirmTemplate(null)
  }

  async function closeDesigner() {
    if (dirty) { setConfirmClose(true); return }
    navigate('/templates')
  }

  // ── render ─────────────────────────────────────────────────────────────────

  if (error && !design) {
    return (
      <div className="empty">
        <div className="empty-icon">⚠️</div>
        <p>{error}</p>
        <button className="btn btn-ghost" onClick={() => navigate('/templates')}>Back to Templates</button>
      </div>
    )
  }
  if (!design) return <div className="empty"><p>Opening the Designer…</p></div>

  const stageW = design.width * scale
  const stageH = design.height * scale

  return (
    // The app shell pads its main area for ordinary pages; the Designer needs
    // the whole panel, so it pulls that padding back off.
    <div style={{
      margin: '-28px -32px', height: 'calc(100vh - 0px)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* ── top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button className="btn btn-ghost btn-sm" onClick={closeDesigner}>← Close</button>
        <input
          className="form-input"
          style={{ width: 240, fontWeight: 600 }}
          value={design.name}
          onChange={e => mutate(d => ({ ...d, name: e.target.value }))}
          onBlur={() => { if (!design.name.trim()) mutate(d => ({ ...d, name: 'Untitled design' })) }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {design.width} × {design.height}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowResize(true)}>Resize</button>

        <div style={{ width: 1, height: 24, background: 'var(--border)', margin: '0 4px' }} />

        <button className="btn-icon" title="Undo (Ctrl+Z)" disabled={!past.current.length} onClick={undo}>↶</button>
        <button className="btn-icon" title="Redo (Ctrl+Y)" disabled={!future.current.length} onClick={redo}>↷</button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {status && <span style={{ color: 'var(--success)', fontSize: 12 }}>{status}</span>}
          {error && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>}
          {dirty && !status && <span style={{ color: 'var(--warning)', fontSize: 12 }}>Unsaved changes</span>}
          <button className="btn btn-ghost btn-sm"
            onClick={async () => { if (dirty) await save(); window.open(`${serverUrl}/tv/scene/${design.id}`, '_blank') }}>
            Preview
          </button>
          <button className="btn btn-ghost btn-sm" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={async () => { if (dirty) { if (!await save()) return } setShowPush(true) }}>
            Push to Screens
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ── icon rail ── */}
        <div style={{
          width: RAIL_W, flexShrink: 0, background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border)', padding: '10px 0',
          display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto',
        }}>
          {PANELS.map(p => (
            <button key={p.id} onClick={() => setPanel(p.id)}
              style={{
                background: panel === p.id ? 'var(--bg-tertiary)' : 'transparent',
                border: 'none', cursor: 'pointer', padding: '10px 4px',
                color: panel === p.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              }}>
              <span style={{ fontSize: 19 }}>{p.icon}</span>
              <span style={{ fontSize: 10 }}>{p.label}</span>
            </button>
          ))}
        </div>

        {/* ── contextual panel ── */}
        <div style={{
          width: PANEL_W, flexShrink: 0, background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border)', padding: 14, overflowY: 'auto',
        }}>
          {panel === 'templates' && (
            <TemplatesPanel serverUrl={serverUrl} design={design}
              onApply={t => (design.elements.length ? setConfirmTemplate(t) : applyTemplate(t))} />
          )}
          {panel === 'widgets' && <WidgetsPanel serverUrl={serverUrl} onAdd={addElement} />}
          {panel === 'text' && <TextPanel onAdd={addElement} />}
          {panel === 'elements' && <ElementsPanel onAdd={addElement} />}
          {panel === 'photos' && (
            <PhotosPanel serverUrl={serverUrl} assets={assets} onRefresh={loadAssets} onAdd={addElement}
              hasImageSelected={selected?.type === 'image'}
              onSetSelectedSrc={src => selected && patchElement(selected.id, { src } as Partial<SceneElement>)} />
          )}
          {panel === 'qr' && <QrPanel onAdd={addElement} />}
          {panel === 'background' && (
            <BackgroundPanel serverUrl={serverUrl} background={design.background} assets={assets}
              onChange={(bg: SceneBackground) => commit(d => ({ ...d, background: bg }))} />
          )}
          {panel === 'layers' && (
            <LayersPanel elements={design.elements} selectedId={selectedId} onSelect={setSelectedId}
              onMove={(elId, dir) => reorder(elId, dir === 'up' ? 'forward' : 'backward')}
              onToggleLock={elId => {
                const el = design.elements.find(x => x.id === elId)
                if (el) patchElement(elId, { locked: !el.locked })
              }}
              onDelete={deleteElement} />
          )}
        </div>

        {/* ── canvas ── */}
        <div
          ref={viewportRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onPointerDown={() => setSelectedId(null)}
          style={{
            flex: 1, minWidth: 0, position: 'relative', overflow: 'auto',
            background: '#0a0f1a',
            backgroundImage: 'linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32,
          }}>
          <div style={{ width: stageW, height: stageH, position: 'relative', flexShrink: 0, boxShadow: '0 10px 40px rgba(0,0,0,.5)' }}>
            {/* the design itself, drawn at scale */}
            <div style={{
              position: 'absolute', left: 0, top: 0,
              width: design.width, height: design.height,
              transform: `scale(${scale})`, transformOrigin: '0 0',
              ...backgroundStyle(design, serverUrl),
            }}>
              {design.background.imagePath && (
                <img src={serverUrl + design.background.imagePath} alt=""
                  style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: design.background.imageFit || 'cover' }} />
              )}
              {design.elements.map(el => (
                <div key={el.id} onPointerDown={e => onElementPointerDown(e, el)}
                  style={{ cursor: el.locked ? 'default' : 'move' }}>
                  <SceneElementView el={el} base={serverUrl} />
                </div>
              ))}
              {/* snap guides live in design space so they line up with the art */}
              {guides.v.map((g, i) => (
                <div key={`v${i}`} style={{ position: 'absolute', left: g, top: 0, width: 2 / scale, height: design.height, background: '#f472b6' }} />
              ))}
              {guides.h.map((g, i) => (
                <div key={`h${i}`} style={{ position: 'absolute', top: g, left: 0, height: 2 / scale, width: design.width, background: '#f472b6' }} />
              ))}
            </div>

            {/* selection chrome sits above the artwork, in screen pixels so the
                handles stay grabbable however far the canvas is zoomed out */}
            {selected && (
              <div style={{
                position: 'absolute',
                left: selected.x * scale, top: selected.y * scale,
                width: selected.w * scale, height: selected.h * scale,
                border: `2px solid ${selected.locked ? '#94a3b8' : 'var(--accent)'}`,
                pointerEvents: 'none',
                transform: selected.rotation ? `rotate(${selected.rotation}deg)` : undefined,
              }}>
                {!selected.locked && HANDLES.map(h => {
                  const pos: React.CSSProperties = { position: 'absolute', width: 10, height: 10, background: '#fff', border: '1px solid var(--accent)', borderRadius: 2, pointerEvents: 'auto' }
                  if (h.includes('n')) pos.top = -6
                  if (h.includes('s')) pos.bottom = -6
                  if (h.includes('w')) pos.left = -6
                  if (h.includes('e')) pos.right = -6
                  if (h === 'n' || h === 's') { pos.left = '50%'; pos.marginLeft = -5 }
                  if (h === 'e' || h === 'w') { pos.top = '50%'; pos.marginTop = -5 }
                  const cursor = h === 'n' || h === 's' ? 'ns-resize'
                    : h === 'e' || h === 'w' ? 'ew-resize'
                    : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize'
                  return <div key={h} style={{ ...pos, cursor }}
                    onPointerDown={e => onHandlePointerDown(e, selected, h)} />
                })}
              </div>
            )}
          </div>

          {/* zoom controls */}
          <div style={{
            position: 'absolute', right: 16, bottom: 16, display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: 20, padding: '5px 10px',
          }} onPointerDown={e => e.stopPropagation()}>
            <button className="btn-icon" title="Zoom out"
              onClick={() => setZoom(Math.max(0.05, (scale) - 0.1))}>−</button>
            <span style={{ fontSize: 12, minWidth: 42, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
            <button className="btn-icon" title="Zoom in"
              onClick={() => setZoom(Math.min(3, (scale) + 0.1))}>+</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setZoom('fit')}>Fit</button>
          </div>
        </div>

        {/* ── inspector ── */}
        <div style={{
          width: INSPECTOR_W, flexShrink: 0, background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border)', overflow: 'hidden',
        }}>
          {selected ? (
            <Inspector
              el={selected}
              base={serverUrl}
              assets={assets}
              onPatch={p => patchElement(selected.id, p)}
              onDelete={() => deleteElement(selected.id)}
              onDuplicate={() => duplicateElement(selected.id)}
              onOrder={dir => reorder(selected.id, dir)}
              onAlign={alignToCanvas}
              onPickImage={() => setPanel('photos')}
              weatherApps={weatherApps}
            />
          ) : (
            <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
              <p style={{ marginBottom: 12 }}>Click anything on the canvas to edit it.</p>
              <p style={{ fontSize: 12 }}>
                Drag to move · corner handles keep the shape · hold Shift to stretch freely ·
                Alt turns off snapping · arrow keys nudge · Ctrl+D duplicates · Del removes.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── dialogs ── */}
      {showPush && (
        <PushToScreens serverUrl={serverUrl} design={design} onClose={() => setShowPush(false)} />
      )}

      {showResize && (
        <div className="modal-backdrop" onClick={() => setShowResize(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Canvas size</h2>
              <button className="btn-icon" onClick={() => setShowResize(false)}>✕</button>
            </div>
            <p className="subtitle">
              Match this to how the screen is mounted. Elements keep their position —
              check the layout after a big change.
            </p>
            {CANVAS_PRESETS.map(p => (
              <button key={p.label} className="btn btn-ghost"
                style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}
                onClick={() => { commit(d => ({ ...d, width: p.w, height: p.h })); setShowResize(false) }}>
                <span>{p.label}</span>
                {design.width === p.w && design.height === p.h && <span className="badge badge-blue">Current</span>}
              </button>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Width</label>
                <input className="form-input" type="number" value={design.width} min={240} max={4096}
                  onChange={e => mutate(d => ({ ...d, width: Math.max(240, Math.min(4096, Number(e.target.value) || d.width)) }))} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Height</label>
                <input className="form-input" type="number" value={design.height} min={240} max={4096}
                  onChange={e => mutate(d => ({ ...d, height: Math.max(240, Math.min(4096, Number(e.target.value) || d.height)) }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setShowResize(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {confirmTemplate && (
        <div className="modal-backdrop" onClick={() => setConfirmTemplate(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Use this template?</h2>
              <button className="btn-icon" onClick={() => setConfirmTemplate(null)}>✕</button>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.5 }}>
              Applying <b>{confirmTemplate.name}</b> replaces everything on the canvas.
              You can undo it with Ctrl+Z.
            </p>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setConfirmTemplate(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => applyTemplate(confirmTemplate)}>Use template</button>
            </div>
          </div>
        </div>
      )}

      {confirmClose && (
        <div className="modal-backdrop" onClick={() => setConfirmClose(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Unsaved changes</h2>
              <button className="btn-icon" onClick={() => setConfirmClose(false)}>✕</button>
            </div>
            <p style={{ fontSize: 14 }}>Save this design before closing?</p>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => navigate('/templates')}>Discard</button>
              <button className="btn btn-primary" onClick={async () => { if (await save()) navigate('/templates') }}>
                Save and close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
