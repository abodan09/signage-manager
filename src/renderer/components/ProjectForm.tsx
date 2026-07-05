import { useState, useRef } from 'react'
import type { ContentItem, Project, ScheduleMode } from '../types'

interface Props {
  serverUrl: string
  project?: Project
  existingContent: ContentItem[]    // all standalone content items (no projectId)
  onSave: () => void
  onClose: () => void
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_LABELS: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

export default function ProjectForm({ serverUrl, project, existingContent, onSave, onClose }: Props) {
  const isEdit = !!project

  const [name, setName]               = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [duration, setDuration]       = useState(project?.durationSeconds ?? 10)
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(project?.scheduleMode ?? 'loop')
  const [startTime, setStartTime]     = useState(project?.scheduleStartTime ?? '08:00')
  const [endTime, setEndTime]         = useState(project?.scheduleEndTime ?? '18:00')
  const [days, setDays]               = useState<string[]>(project?.scheduleDays ?? [...DAYS])
  const [isActive, setIsActive]       = useState(project?.isActive ?? true)

  const [files, setFiles]             = useState<File[]>([])
  const [dragOver, setDragOver]       = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function toggleDay(d: string) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleFileDrop(fileList: FileList | null) {
    if (!fileList) return
    const accepted = Array.from(fileList).filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/')
    )
    setFiles(prev => [...prev, ...accepted])
  }

  async function handleSave() {
    if (!name.trim()) { setError('Project name is required'); return }
    setError('')
    setSaving(true)

    try {
      const body: Record<string, any> = {
        name: name.trim(),
        description: description.trim(),
        durationSeconds: duration,
        scheduleMode,
        isActive,
      }
      if (scheduleMode === 'scheduled') {
        body.scheduleStartTime = startTime
        body.scheduleEndTime   = endTime
        body.scheduleDays      = JSON.stringify(days)
      }

      const url    = isEdit ? `${serverUrl}/api/projects/${project!.id}` : `${serverUrl}/api/projects`
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      const saved: Project = await res.json()

      // Upload files and/or attach existing content
      if (files.length > 0 || selectedIds.size > 0) {
        const fd = new FormData()
        files.forEach(f => fd.append('files', f))
        if (selectedIds.size > 0) fd.append('existingIds', JSON.stringify([...selectedIds]))
        const r2 = await fetch(`${serverUrl}/api/projects/${saved.id}/content`, { method: 'POST', body: fd })
        if (!r2.ok) throw new Error(await r2.text())
      }

      onSave()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Project' : 'New Project'}</h2>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 18 }}>✕</button>
        </div>

        {/* Name */}
        <div className="form-group">
          <label className="form-label">Project Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Morning Playlist" />
        </div>

        {/* Description */}
        <div className="form-group">
          <label className="form-label">Description (optional)</label>
          <input className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description…" />
        </div>

        {/* Multi-file upload */}
        <div className="form-group">
          <div className="form-label">Add Media Files (images &amp; videos)</div>
          <input
            type="file" ref={fileRef} style={{ display: 'none' }}
            accept="image/*,video/*"
            multiple
            onChange={e => handleFileDrop(e.target.files)}
          />
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFileDrop(e.dataTransfer.files) }}
          >
            <div className="drop-icon">🖼️🎬</div>
            {files.length === 0
              ? <div>Click or drag &amp; drop images / videos (multiple allowed)</div>
              : <div style={{ fontSize: 13 }}>{files.length} file{files.length !== 1 ? 's' : ''} selected: {files.map(f => f.name).join(', ')}</div>
            }
          </div>
          {files.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 6 }}
              onClick={() => setFiles([])}
            >
              Clear files
            </button>
          )}
        </div>

        {/* Attach existing content */}
        {existingContent.length > 0 && (
          <div className="form-group">
            <div className="form-label">Attach Existing Content</div>
            <div style={{
              maxHeight: 160, overflowY: 'auto',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '4px 0',
            }}>
              {existingContent.map(item => (
                <label
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 14px', cursor: 'pointer',
                    background: selectedIds.has(item.id) ? 'rgba(59,130,246,0.12)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <span style={{ fontSize: 14 }}>{typeIcon(item.type)} {item.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 'auto' }}>{item.type}</span>
                </label>
              ))}
            </div>
            {selectedIds.size > 0 && (
              <div style={{ fontSize: 12, color: '#60a5fa', marginTop: 4 }}>
                {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
              </div>
            )}
          </div>
        )}

        {/* Duration */}
        <div className="form-group">
          <label className="form-label">Duration per item (seconds)</label>
          <input type="number" className="form-input" value={duration} min={1} max={3600} onChange={e => setDuration(Number(e.target.value))} />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            Applied to every content item in this project
          </div>
        </div>

        {/* Schedule */}
        <div className="form-group">
          <div className="form-label">Schedule Mode</div>
          <div className="radio-group">
            {([
              { mode: 'loop',      icon: '🔄', label: 'Loop',      desc: 'Always in rotation' },
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
                  <button key={d} type="button" className={`day-chip ${days.includes(d) ? 'selected' : ''}`} onClick={() => toggleDay(d)}>
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
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Show this project's content on TVs</div>
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
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}

function typeIcon(t: string) {
  return { image: '🖼️', video: '🎬', html: '🌐', text: '✏️' }[t] ?? '📄'
}
