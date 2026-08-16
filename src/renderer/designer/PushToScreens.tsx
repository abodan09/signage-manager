import { useEffect, useState } from 'react'
import type { ContentItem, Design, Device, DeviceGroup } from '../types'

/** Publishing a design does two separable things, and the dialog keeps them
 *  separable: it always adds the design to the playlist every screen plays,
 *  and it optionally interrupts chosen screens to show it right now. */
export function PushToScreens({
  serverUrl, design, onClose,
}: {
  serverUrl: string
  design: Design
  onClose: () => void
}) {
  const [devices, setDevices] = useState<Device[]>([])
  const [groups, setGroups] = useState<DeviceGroup[]>([])
  const [duration, setDuration] = useState(15)
  const [target, setTarget] = useState<string>('')   // '' | device:<id> | group:<id>
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    if (!serverUrl) return
    Promise.all([
      fetch(`${serverUrl}/api/devices`).then(r => r.json()),
      fetch(`${serverUrl}/api/groups`).then(r => r.json()),
    ]).then(([d, g]) => {
      setDevices(d.devices ?? [])
      setGroups(g.groups ?? [])
    }).catch(() => { /* the playlist path still works without a target list */ })
  }, [serverUrl])

  const online = devices.filter(d => d.status === 'online')

  async function publish() {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${serverUrl}/api/designs/${design.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationSeconds: duration }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not add this design to your screens')
      const item = data.item as ContentItem

      if (target) {
        const [kind, id] = target.split(':')
        const url = kind === 'group'
          ? `${serverUrl}/api/groups/${id}/push`
          : `${serverUrl}/api/devices/${id}/push`
        const pushRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentId: item.id }),
        })
        const pushData = await pushRes.json().catch(() => ({}))
        if (!pushRes.ok) {
          // The playlist part already succeeded — say so rather than implying
          // the whole thing failed.
          throw new Error(`Added to the playlist, but could not show it now: ${pushData.error || 'the screen is offline'}`)
        }
        setDone('Added to your playlist and showing now.')
      } else {
        setDone('Added to your playlist. It will appear in the rotation.')
      }
      setTimeout(onClose, 2200)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not push this design')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Push to screens</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <p className="subtitle" style={{ marginBottom: 18 }}>
          <b>{design.name}</b> joins the playlist that every paired screen plays.
        </p>

        <div className="form-group">
          <label className="form-label">Show for</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input className="form-input" type="number" min={1} max={3600} value={duration} style={{ width: 110 }}
              onChange={e => setDuration(Math.max(1, Math.min(3600, Number(e.target.value) || 15)))} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>seconds each time it comes round</span>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Also show it right now on</label>
          <select className="form-select" value={target} onChange={e => setTarget(e.target.value)}>
            <option value="">Nothing — just add it to the playlist</option>
            {groups.length > 0 && (
              <optgroup label="Groups">
                {groups.map(g => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.name}{g.onlineCount !== undefined ? ` (${g.onlineCount} online)` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {online.length > 0 && (
              <optgroup label="Screens">
                {online.map(d => <option key={d.id} value={`device:${d.id}`}>{d.name}</option>)}
              </optgroup>
            )}
          </select>
          {!online.length && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              No screens are online right now — the design still goes into the playlist.
            </div>
          )}
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 4 }}>{error}</div>}
        {done && <div style={{ color: 'var(--success)', fontSize: 13, marginTop: 4 }}>{done}</div>}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !!done} onClick={publish}>
            {busy ? 'Pushing…' : 'Push to screens'}
          </button>
        </div>
      </div>
    </div>
  )
}
