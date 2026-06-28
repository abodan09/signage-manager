import { useState, useRef } from 'react'
import type { ContentItem, ContentType, ScheduleMode, TextPosition } from '../types'

interface Props {
  serverUrl: string
  item?: ContentItem
  onSave: (item: ContentItem) => void
  onClose: () => void
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

export default function ContentForm({ serverUrl, item, onSave, onClose }: Props) {
  const isEdit = !!item

  const [type, setType] = useState<ContentType>(item?.type ?? 'image')
  const [name, setName] = useState(item?.name ?? '')
  const [duration, setDuration] = useState(item?.durationSeconds ?? 10)
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(item?.scheduleMode ?? 'loop')
  const [startTime, setStartTime] = useState(item?.scheduleStartTime ?? '08:00')
  const [endTime, setEndTime] = useState(item?.scheduleEndTime ?? '18:00')
  const [days, setDays] = useState<string[]>(item?.scheduleDays ?? [...DAYS])
  const [isActive, setIsActive] = useState(item?.isActive ?? true)
  // html
  const [htmlUrl, setHtmlUrl] = useState(item?.htmlUrl ?? '')
  // text
  const [textContent, setTextContent] = useState(item?.textContent ?? '')
  const [textBgColor, setTextBgColor] = useState(item?.textBgColor ?? '#000000')
  const [textFgColor, setTextFgColor] = useState(item?.textFgColor ?? '#ffffff')
  const [textFontSize, setTextFontSize] = useState(item?.textFontSize ?? 72)
  const [textPosition, setTextPosition] = useState<TextPosition>(item?.textPosition ?? 'center')
  // file
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function toggleDay(d: string) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  async function handleSave() {
    if (!name.trim()) { setError('Name is required'); return }
    if (type === 'html' && !htmlUrl.trim()) { setError('URL is required'); return }
    if (type === 'text' && !textContent.trim()) { setError('Text content is required'); return }
    if ((type === 'image' || type === 'video') && !isEdit && !file) { setError('Please select a file'); return }

    setError('')
    setSaving(true)

    const fd = new FormData()
    fd.append('type', type)
    fd.append('name', name.trim())
    fd.append('durationSeconds', String(duration))
    fd.append('scheduleMode', scheduleMode)
    fd.append('isActive', String(isActive))

    if (scheduleMode === 'scheduled') {
      fd.append('scheduleStartTime', startTime)
      fd.append('scheduleEndTime', endTime)
      fd.append('scheduleDays', JSON.stringify(days))
    }

    if (type === 'html') {
      fd.append('htmlUrl', htmlUrl)
    } else if (type === 'text') {
      fd.append('textContent', textContent)
      fd.append('textBgColor', textBgColor)
      fd.append('textFgColor', textFgColor)
      fd.append('textFontSize', String(textFontSize))
      fd.append('textPosition', textPosition)
    } else if (file) {
      fd.append('file', file)
    }

    try {
      const url = isEdit
        ? `${serverUrl}/api/content/${item!.id}`
        : `${serverUrl}/api/content`
      const res = await fetch(url, { method: isEdit ? 'PUT' : 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      const saved: ContentItem = await res.json()
      onSave(saved)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const currentFileName = file?.name ?? item?.fileName ?? null

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Content' : 'Add Content'}</h2>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>

        {/* Content type */}
        <div className="form-group">
          <div className="form-label">Content Type</div>
          <div className="type-tabs">
            {(['image','video','html','text'] as ContentType[]).map(t => (
              <button
                key={t}
                className={`type-tab ${type === t ? 'active' : ''}`}
                onClick={() => setType(t)}
                disabled={isEdit}
              >
                {typeIcon(t)} {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Ad name…" />
        </div>

        {/* Content-specific fields */}
        {(type === 'image' || type === 'video') && (
          <div className="form-group">
            <div className="form-label">{type === 'image' ? 'Image File' : 'Video File'}</div>
            <input
              type="file" ref={fileRef} style={{ display: 'none' }}
              accept={type === 'image' ? 'image/*' : 'video/*'}
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            <div
              className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault(); setDragOver(false)
                const f = e.dataTransfer.files[0]
                if (f) setFile(f)
              }}
            >
              <div className="drop-icon">{type === 'image' ? '🖼️' : '🎬'}</div>
              {currentFileName
                ? <div style={{ fontSize: 13 }}>{currentFileName}</div>
                : <div>Click to select or drag & drop a {type} file</div>
              }
            </div>
          </div>
        )}

        {type === 'html' && (
          <div className="form-group">
            <label className="form-label">Web Page URL</label>
            <input className="form-input" value={htmlUrl} onChange={e => setHtmlUrl(e.target.value)} placeholder="https://example.com" />
          </div>
        )}

        {type === 'text' && (
          <>
            <div className="form-group">
              <label className="form-label">Text Content</label>
              <textarea className="form-textarea" value={textContent} onChange={e => setTextContent(e.target.value)} placeholder="Enter text to display…" rows={3} />
            </div>
            <div className="form-group">
              <label className="form-label">Position</label>
              <select className="form-select" value={textPosition} onChange={e => setTextPosition(e.target.value as TextPosition)}>
                <option value="center">Center (full screen)</option>
                <option value="top">Top</option>
                <option value="bottom">Bottom</option>
                <option value="ticker">Ticker (scrolling bottom bar)</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Background Color</label>
                <div className="color-row">
                  <input type="color" value={textBgColor} onChange={e => setTextBgColor(e.target.value)} />
                  <input className="form-input" value={textBgColor} onChange={e => setTextBgColor(e.target.value)} style={{ fontFamily: 'monospace' }} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Text Color</label>
                <div className="color-row">
                  <input type="color" value={textFgColor} onChange={e => setTextFgColor(e.target.value)} />
                  <input className="form-input" value={textFgColor} onChange={e => setTextFgColor(e.target.value)} style={{ fontFamily: 'monospace' }} />
                </div>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Font Size (px)</label>
              <input type="number" className="form-input" value={textFontSize} min={12} max={300} onChange={e => setTextFontSize(Number(e.target.value))} />
            </div>
          </>
        )}

        {/* Duration */}
        <div className="form-group">
          <label className="form-label">Display Duration (seconds)</label>
          <input type="number" className="form-input" value={duration} min={1} max={3600} onChange={e => setDuration(Number(e.target.value))} />
        </div>

        {/* Schedule mode */}
        <div className="form-group">
          <div className="form-label">Schedule Mode</div>
          <div className="radio-group">
            {([
              { mode: 'loop',      icon: '🔄', label: 'Loop',      desc: 'Always plays in rotation' },
              { mode: 'scheduled', icon: '🕐', label: 'Scheduled', desc: 'Time & day windows' },
              { mode: 'manual',    icon: '📤', label: 'Manual',    desc: 'Push on demand only' },
            ] as const).map(({ mode, icon, label, desc }) => (
              <div
                key={mode}
                className={`radio-option ${scheduleMode === mode ? 'selected' : ''}`}
                onClick={() => setScheduleMode(mode)}
              >
                <div className="radio-icon">{icon}</div>
                <div className="radio-label">{label}</div>
                <div className="radio-desc">{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scheduled options */}
        {scheduleMode === 'scheduled' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Start Time</label>
                <input type="time" className="form-input" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">End Time</label>
                <input type="time" className="form-input" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <div className="form-label">Days</div>
              <div className="days-row">
                {DAYS.map(d => (
                  <button
                    key={d}
                    type="button"
                    className={`day-chip ${days.includes(d) ? 'selected' : ''}`}
                    onClick={() => toggleDay(d)}
                  >
                    {DAY_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Active toggle */}
        <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="form-label" style={{ marginBottom: 0 }}>Active</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Show this content on TVs</div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 4 }}>{error}</div>}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Content'}
          </button>
        </div>
      </div>
    </div>
  )
}

function typeIcon(t: string) {
  return { image: '🖼️', video: '🎬', html: '🌐', text: '✏️' }[t] ?? '📄'
}
