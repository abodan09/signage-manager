import { useEffect, useMemo, useState } from 'react'
import qrFactory from 'qrcode-generator'
import type {
  Design, ImageElement, QrElement, SceneElement, ShapeElement, TextElement, WidgetElement,
} from '../types'
import { SCENE_FONTS } from './fonts'

/** Renders a design exactly as src/main/server/scenes.ts renders it for TVs.
 *  Both the gallery thumbnails and the Designer canvas draw through this, so
 *  what the operator arranges is what the wall shows. Any visual change here
 *  has to be mirrored in the server renderer. */

export function rgba(hex: string, pct: number): string {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex)
  if (!m) return 'transparent'
  if (pct >= 100) return hex
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${(pct / 100).toFixed(3)})`
}

function QrSvg({ el }: { el: QrElement }) {
  const path = useMemo(() => {
    try {
      const qr = qrFactory(0, 'M')
      qr.addData(el.data || ' ')
      qr.make()
      const n = qr.getModuleCount()
      const cells: string[] = []
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push(`M${c} ${r}h1v1h-1z`)
      }
      return { n, d: cells.join('') }
    } catch {
      return null
    }
  }, [el.data])

  if (!path) return null
  return (
    <svg viewBox={`0 0 ${path.n} ${path.n}`} width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet" shapeRendering="crispEdges">
      {el.bg && <rect width={path.n} height={path.n} fill={el.bg} />}
      <path d={path.d} fill={el.fg} />
    </svg>
  )
}

/** Must stay identical to SHAPE_POINTS in src/main/server/scenes.ts — a shape
 *  that previews one way and prints another is the worst bug a WYSIWYG editor
 *  can have. */
export const SHAPE_POINTS: Record<string, number[][]> = {
  'triangle':      [[0.5, 0], [1, 1], [0, 1]],
  'triangle-down': [[0, 0], [1, 0], [0.5, 1]],
  'diamond':       [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  'pentagon':      [[0.5, 0], [1, 0.38], [0.81, 1], [0.19, 1], [0, 0.38]],
  'hexagon':       [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  'star':          [[0.5, 0], [0.61, 0.35], [0.98, 0.35], [0.68, 0.57], [0.79, 0.91],
                    [0.5, 0.7], [0.21, 0.91], [0.32, 0.57], [0.02, 0.35], [0.39, 0.35]],
  'burst':         [[0.5, 0], [0.6, 0.16], [0.78, 0.09], [0.79, 0.28], [0.97, 0.32],
                    [0.86, 0.47], [0.99, 0.61], [0.81, 0.68], [0.83, 0.87], [0.65, 0.83],
                    [0.56, 1], [0.42, 0.88], [0.26, 0.96], [0.23, 0.78], [0.05, 0.74],
                    [0.14, 0.58], [0.01, 0.45], [0.18, 0.36], [0.14, 0.18], [0.33, 0.2]],
  'arrow-right':   [[0, 0.28], [0.6, 0.28], [0.6, 0.05], [1, 0.5], [0.6, 0.95], [0.6, 0.72], [0, 0.72]],
  'arrow-left':    [[1, 0.28], [0.4, 0.28], [0.4, 0.05], [0, 0.5], [0.4, 0.95], [0.4, 0.72], [1, 0.72]],
  'chevron':       [[0, 0], [0.55, 0], [1, 0.5], [0.55, 1], [0, 1], [0.45, 0.5]],
  'banner':        [[0, 0], [1, 0], [1, 1], [0.5, 0.78], [0, 1]],
  'shield':        [[0.5, 0], [1, 0.16], [1, 0.6], [0.5, 1], [0, 0.6], [0, 0.16]],
  'badge':         [[0.5, 0], [0.66, 0.11], [0.86, 0.09], [0.92, 0.28], [1, 0.44],
                    [0.88, 0.6], [0.9, 0.8], [0.71, 0.86], [0.58, 1], [0.4, 0.94],
                    [0.2, 0.97], [0.13, 0.79], [0, 0.66], [0.1, 0.48], [0.05, 0.28], [0.24, 0.19], [0.34, 0.03]],
}

/** Matches shadowCss() in src/main/server/scenes.ts. */
export function shadowCss(s: { color: string; blur: number; x: number; y: number; opacity: number }): string {
  return `${s.x}px ${s.y}px ${s.blur}px ${rgba(s.color, s.opacity)}`
}

function ShapeSvg({ el }: { el: ShapeElement }) {
  const w = Math.max(1, el.w), h = Math.max(1, el.h)
  const gradId = `g-${el.id}`
  const fill = el.gradient ? `url(#${gradId})` : el.fill ? rgba(el.fill, el.fillOpacity) : 'none'
  const hasStroke = !!el.stroke && el.strokeWidth > 0
  const inset = hasStroke ? el.strokeWidth / 2 : 0
  const strokeProps = hasStroke
    ? { stroke: el.stroke!, strokeWidth: el.strokeWidth, strokeLinejoin: 'round' as const }
    : {}
  const pts = SHAPE_POINTS[el.kind]
  const shade = el.shadow ? rgba(el.shadow.color, el.shadow.opacity) : ''
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none">
      {el.gradient && (
        <defs>
          <linearGradient id={gradId} gradientTransform={`rotate(${el.gradient.angle} 0.5 0.5)`}>
            <stop offset="0%" stopColor={el.gradient.from} />
            <stop offset="100%" stopColor={el.gradient.to} />
          </linearGradient>
        </defs>
      )}
      {el.shadow && el.kind !== 'line' && (
        <g transform={`translate(${el.shadow.x},${el.shadow.y})`}>
          {el.kind === 'rect' && <rect x={inset} y={inset} width={w - inset * 2} height={h - inset * 2} rx={el.radius} fill={shade} />}
          {el.kind === 'ellipse' && <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0.5, w / 2 - inset)} ry={Math.max(0.5, h / 2 - inset)} fill={shade} />}
          {pts && <polygon points={pts.map(([px, py]) => `${(inset + px * (w - inset * 2)).toFixed(2)},${(inset + py * (h - inset * 2)).toFixed(2)}`).join(' ')} fill={shade} />}
        </g>
      )}
      {el.kind === 'rect' && (
        <rect x={inset} y={inset} width={w - inset * 2} height={h - inset * 2} rx={el.radius} fill={fill} {...strokeProps} />
      )}
      {el.kind === 'ellipse' && (
        <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0.5, w / 2 - inset)} ry={Math.max(0.5, h / 2 - inset)} fill={fill} {...strokeProps} />
      )}
      {el.kind === 'line' && (
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={el.stroke ?? el.fill ?? '#ffffff'}
          strokeWidth={Math.max(1, el.strokeWidth || 4)} strokeLinecap="round" />
      )}
      {pts && (
        <polygon
          points={pts.map(([px, py]) => `${(inset + px * (w - inset * 2)).toFixed(2)},${(inset + py * (h - inset * 2)).toFixed(2)}`).join(' ')}
          fill={fill} {...strokeProps} />
      )}
    </svg>
  )
}

/** Live elements draw their real value on the canvas — a clock in the Designer
 *  ticks. Seeing the actual time is what tells an operator the box is the
 *  right size for it. */
function WidgetBody({ el }: { el: WidgetElement }) {
  const [, force] = useState(0)
  useEffect(() => {
    if (el.kind !== 'clock' && el.kind !== 'date') return
    const t = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [el.kind])

  const font = SCENE_FONTS[el.font] ?? SCENE_FONTS.inter
  const cfg = el.config ?? {}
  const off = typeof cfg.timezoneOffset === 'number' ? cfg.timezoneOffset : null
  const now = off === null
    ? new Date()
    : new Date(Date.now() + new Date().getTimezoneOffset() * 60000 + off * 1000)
  const pad = (n: number) => (n < 10 ? '0' : '') + n

  let text = ''
  if (el.kind === 'clock') {
    let h = now.getHours()
    let suffix = ''
    if (cfg.format === '12h' || cfg.format === '12h-ampm') {
      suffix = cfg.format === '12h-ampm' ? (h >= 12 ? ' PM' : ' AM') : ''
      h = h % 12 || 12
    }
    const hh = cfg.format === '24h' ? pad(h) : String(h)
    text = `${cfg.label ? cfg.label + ' ' : ''}${hh}:${pad(now.getMinutes())}` +
      `${cfg.showSeconds ? ':' + pad(now.getSeconds()) : ''}${suffix}`
  } else if (el.kind === 'date') {
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    text = cfg.format === 'short' ? `${M[now.getMonth()].slice(0, 3)} ${now.getDate()}, ${now.getFullYear()}`
      : cfg.format === 'numeric' ? `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`
      : cfg.format === 'weekday' ? DAYS[now.getDay()]
      : `${DAYS[now.getDay()]}, ${M[now.getMonth()]} ${now.getDate()}`
  } else if (el.kind === 'weather') {
    text = cfg.appInstanceId ? '21°  Partly cloudy' : 'Pick a Weather app'
  } else {
    text = String(cfg.text ?? 'Scrolling message')
  }

  return (
    <div style={{
      width: '100%', textAlign: el.align, color: el.color, fontFamily: font.css,
      fontSize: el.fontSize, fontWeight: el.bold ? 700 : 400, lineHeight: 1.15,
      whiteSpace: 'nowrap', overflow: 'hidden',
    }}>{text}</div>
  )
}

function TextBody({ el }: { el: TextElement }) {
  const font = SCENE_FONTS[el.font] ?? SCENE_FONTS.sans
  return (
    <div style={{
      width: '100%',
      textAlign: el.align,
      color: el.color,
      fontFamily: font.css,
      fontSize: el.fontSize,
      fontWeight: el.bold ? 700 : 400,
      fontStyle: el.italic ? 'italic' : 'normal',
      textDecoration: el.underline ? 'underline' : 'none',
      lineHeight: el.lineHeight,
      letterSpacing: el.letterSpacing,
      whiteSpace: 'pre-wrap',
      wordWrap: 'break-word',
      ...(el.outline && el.outline.width > 0
        ? { WebkitTextStroke: `${el.outline.width}px ${el.outline.color}` } as React.CSSProperties
        : {}),
      ...(el.shadow ? { textShadow: shadowCss(el.shadow) } : {}),
    }}>{el.text}</div>
  )
}

function ImageBody({ el, base }: { el: ImageElement; base: string }) {
  if (!el.src) {
    // Placeholder frames are invisible on TVs; in the manager they need to be
    // visible or the operator cannot find the slot to fill.
    return (
      <div style={{
        width: '100%', height: '100%',
        border: '2px dashed rgba(255,255,255,.35)',
        borderRadius: el.radius,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.6)',
        fontSize: Math.max(11, Math.min(el.w, el.h) * 0.12), fontFamily: 'Arial, sans-serif',
      }}>Photo</div>
    )
  }
  return <img src={base + el.src} alt="" style={{ width: '100%', height: '100%', objectFit: el.fit, display: 'block' }} />
}

export function SceneElementView({ el, base }: { el: SceneElement; base: string }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: el.x, top: el.y, width: el.w, height: el.h,
    opacity: el.opacity / 100,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  }

  if (el.type === 'text') {
    const t = el as TextElement
    return (
      <div style={{
        ...style,
        display: 'flex',
        alignItems: t.valign === 'top' ? 'flex-start' : t.valign === 'bottom' ? 'flex-end' : 'center',
        background: t.bgColor ? rgba(t.bgColor, t.bgOpacity) : undefined,
        borderRadius: t.bgColor ? t.radius : undefined,
      }}>
        <TextBody el={t} />
      </div>
    )
  }
  if (el.type === 'shape') return <div style={style}><ShapeSvg el={el as ShapeElement} /></div>
  if (el.type === 'image') {
    const i = el as ImageElement
    return (
      <div style={{
        ...style, overflow: 'hidden', borderRadius: i.radius || undefined,
        ...(i.shadow ? { boxShadow: shadowCss(i.shadow) } : {}),
      }}><ImageBody el={i} base={base} /></div>
    )
  }
  if (el.type === 'widget') {
    const w = el as WidgetElement
    return (
      <div style={{
        ...style, display: 'flex', alignItems: 'center', overflow: 'hidden',
        background: w.bgColor ? rgba(w.bgColor, w.bgOpacity) : undefined,
        borderRadius: w.bgColor ? w.radius : undefined,
      }}>
        <WidgetBody el={w} />
      </div>
    )
  }
  return <div style={style}><QrSvg el={el as QrElement} /></div>
}

export function backgroundStyle(design: Pick<Design, 'background'>, base: string): React.CSSProperties {
  const bg = design.background
  return {
    background: bg.color,
    backgroundImage: bg.gradient
      ? `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.from}, ${bg.gradient.to})`
      : undefined,
    ...(bg.imagePath ? { backgroundImage: `url("${base}${bg.imagePath}")`, backgroundSize: bg.imageFit === 'contain' ? 'contain' : bg.imageFit === 'fill' ? '100% 100%' : 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' } : {}),
  }
}

/** A design drawn at a given scale. `boxed` fits it into a width and derives
 *  the scale itself — what the thumbnail grids use. */
export function SceneView({
  design, base, scale, className, style,
}: {
  design: Pick<Design, 'width' | 'height' | 'background' | 'elements'>
  base: string
  scale: number
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={className}
      style={{
        width: design.width * scale,
        height: design.height * scale,
        position: 'relative',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{
        position: 'absolute', left: 0, top: 0,
        width: design.width, height: design.height,
        transform: `scale(${scale})`, transformOrigin: '0 0',
        ...backgroundStyle(design, base),
      }}>
        {design.background.imagePath && (
          <img src={base + design.background.imagePath} alt=""
            style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: design.background.imageFit || 'cover', display: 'block' }} />
        )}
        {design.elements.map(el => <SceneElementView key={el.id} el={el} base={base} />)}
      </div>
    </div>
  )
}

/** Thumbnail helper: fits a design inside a fixed-width box. */
export function SceneThumb({
  design, base, width, height,
}: {
  design: Pick<Design, 'width' | 'height' | 'background' | 'elements'>
  base: string
  width: number
  height: number
}) {
  const scale = Math.min(width / design.width, height / design.height)
  const w = design.width * scale, h = design.height * scale
  return (
    <div style={{
      width, height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0b1220', overflow: 'hidden',
    }}>
      <SceneView design={design} base={base} scale={scale} style={{ width: w, height: h }} />
    </div>
  )
}
