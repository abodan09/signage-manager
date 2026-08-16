import { useMemo } from 'react'
import qrFactory from 'qrcode-generator'
import type {
  Design, ImageElement, QrElement, SceneElement, ShapeElement, TextElement,
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

function ShapeSvg({ el }: { el: ShapeElement }) {
  const w = Math.max(1, el.w), h = Math.max(1, el.h)
  const fill = el.fill ? rgba(el.fill, el.fillOpacity) : 'none'
  const hasStroke = !!el.stroke && el.strokeWidth > 0
  const inset = hasStroke ? el.strokeWidth / 2 : 0
  const strokeProps = hasStroke ? { stroke: el.stroke!, strokeWidth: el.strokeWidth } : {}
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="none">
      {el.kind === 'rect' && (
        <rect x={inset} y={inset} width={w - inset * 2} height={h - inset * 2} rx={el.radius} fill={fill} {...strokeProps} />
      )}
      {el.kind === 'ellipse' && (
        <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - inset} ry={h / 2 - inset} fill={fill} {...strokeProps} />
      )}
      {el.kind === 'triangle' && (
        <polygon points={`${w / 2},${inset} ${w - inset},${h - inset} ${inset},${h - inset}`} fill={fill} {...strokeProps} />
      )}
      {el.kind === 'line' && (
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={el.stroke ?? el.fill ?? '#ffffff'} strokeWidth={Math.max(1, el.strokeWidth || 4)} />
      )}
    </svg>
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
    return <div style={{ ...style, overflow: 'hidden', borderRadius: i.radius || undefined }}><ImageBody el={i} base={base} /></div>
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
