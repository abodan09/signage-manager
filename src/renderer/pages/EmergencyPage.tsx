import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Design, Device, DeviceGroup } from '../types'

// Emergency and Flash messages.
//
// The one page in this product where the cost of a slip is not a wrong picture
// on a wall. Three things follow from that, and they are the reason this looks
// different from the other pages:
//
//   * Anything already up is stated at the top, in red, before the operator
//     has to look for it — including a single control that takes everything
//     down. In an incident nobody should have to work out which of four
//     messages is on which wall.
//   * Activating asks first, and the question names how many screens it will
//     reach. "Are you sure?" is not a safeguard; "this will take over 14
//     screens" is.
//   * A live message shows the time left, counted down here rather than
//     waited for, so a message nobody is watching is still visibly finite.

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

type Kind = 'emergency' | 'flash'
type TargetKind = 'all' | 'groups' | 'devices'
type ContentKind = 'design' | 'app' | 'image' | 'text'

interface Override {
  id: string
  kind: Kind
  name: string
  targetKind: TargetKind
  targetIds: string[]
  contentKind: ContentKind
  designId?: string
  appInstanceId?: string
  imagePath?: string
  text?: string
  textColor?: string
  backgroundColor?: string
  seconds: number
  startedAt?: string
  endsAt?: string
  running: boolean
  deviceCount: number
  secondsRemaining: number
}

const BLANK = (kind: Kind): Partial<Override> => ({
  kind,
  name: '',
  targetKind: 'all',
  targetIds: [],
  contentKind: 'text',
  text: kind === 'emergency' ? '' : '',
  textColor: '#ffffff',
  backgroundColor: kind === 'emergency' ? '#b3261e' : '#1b2430',
  seconds: kind === 'emergency' ? 1800 : 600,
})

function mmss(total: number) {
  const s = Math.max(0, total)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n))
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

export default function EmergencyPage() {
  const serverUrl = useServerUrl()

  const [list, setList] = useState<Override[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [groups, setGroups] = useState<DeviceGroup[]>([])
  const [designs, setDesigns] = useState<Design[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [editing, setEditing] = useState<Partial<Override> | null>(null)
  const [confirming, setConfirming] = useState<Override | null>(null)
  const [flashText, setFlashText] = useState('')
  const [busy, setBusy] = useState(false)
  const [standingDown, setStandingDown] = useState(false)
  // Ticks once a second so a live message visibly runs down between polls.
  const [, setTick] = useState(0)

  const load = useCallback(() => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/overrides`).then(r => r.json())
      .then(d => setList(d.overrides ?? []))
      .catch(() => { /* a poll that missed is not worth shouting about */ })
  }, [serverUrl])

  useEffect(() => {
    if (!serverUrl) return
    load()
    Promise.all([
      fetch(`${serverUrl}/api/devices`).then(r => r.json()).catch(() => ({})),
      fetch(`${serverUrl}/api/groups`).then(r => r.json()).catch(() => ({})),
      fetch(`${serverUrl}/api/designs`).then(r => r.json()).catch(() => ({})),
    ]).then(([d, g, s]) => {
      setDevices(d.devices ?? [])
      setGroups(d.groups ?? g.groups ?? [])
      setDesigns(s.designs ?? [])
    })
    // Faster than the rest of the product polls: someone else may be
    // activating from another window while this one is open.
    const poll = setInterval(load, 3000)
    const tick = setInterval(() => setTick(n => n + 1), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [serverUrl, load])

  const running = useMemo(() => list.filter(o => o.running), [list])

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${serverUrl}${url}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'That did not work')
      load()
      return data
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'That did not work')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function activate(o: Override, text?: string) {
    const data = await send(`/api/overrides/${o.id}/activate`, 'POST',
      text ? { text } : {})
    if (data) {
      setNotice(`"${o.name}" is up on ${data.sent} screen${data.sent === 1 ? '' : 's'}` +
        (data.offline ? ` · ${data.offline} offline, will pick it up when they reconnect` : ''))
      setTimeout(() => setNotice(''), 8000)
    }
    setConfirming(null)
    setFlashText('')
  }

  async function standDownAll() {
    setStandingDown(true)
    await send('/api/overrides/stand-down-all', 'POST', {})
    setStandingDown(false)
  }

  async function save() {
    if (!editing) return
    const isNew = !editing.id
    const data = await send(
      isNew ? '/api/overrides' : `/api/overrides/${editing.id}`,
      isNew ? 'POST' : 'PUT',
      editing,
    )
    if (data) setEditing(null)
  }

  const targetSummary = (o: Partial<Override>) => {
    if (o.targetKind === 'all') return 'every screen'
    const n = (o.targetIds ?? []).length
    if (o.targetKind === 'groups') return `${n} group${n === 1 ? '' : 's'}`
    return `${n} screen${n === 1 ? '' : 's'}`
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Emergency & Flash</h1>
          <p className="subtitle">
            Prepared messages that take over your screens. Set them up before you need them.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => setEditing(BLANK('flash'))}>
            + Flash message
          </button>
          <button className="btn btn-primary" onClick={() => setEditing(BLANK('emergency'))}>
            + Emergency message
          </button>
        </div>
      </div>

      {/* Anything live is said first, in red, with one control to end all of it. */}
      {running.length > 0 && (
        <div style={{
          border: '1px solid var(--danger)', borderRadius: 'var(--radius)',
          background: 'rgba(239,68,68,.10)', padding: 14, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span className="badge badge-red">ON SCREEN NOW</span>
            <strong style={{ flex: 1 }}>
              {running.length === 1
                ? `"${running[0].name}" is showing on ${running[0].deviceCount} screen${running[0].deviceCount === 1 ? '' : 's'}`
                : `${running.length} messages are showing`}
            </strong>
            <button className="btn btn-danger" disabled={standingDown} onClick={standDownAll}>
              {standingDown ? 'Standing down…' : 'Stand everything down'}
            </button>
          </div>
          {running.map(o => (
            <div key={o.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 13, color: 'var(--text-secondary)', padding: '4px 0',
            }}>
              <span>{o.kind === 'emergency' ? '🚨' : '⚡'}</span>
              <span style={{ flex: 1 }}>{o.name} — {targetSummary(o)}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {mmss(Math.max(0, Math.round((Date.parse(o.endsAt ?? '') - Date.now()) / 1000)))} left
              </span>
              <button className="btn btn-ghost btn-sm"
                onClick={() => send(`/api/overrides/${o.id}/stand-down`, 'POST', {})}>
                Stand down
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>
      )}
      {notice && (
        <div style={{ color: 'var(--success, #22c55e)', marginBottom: 12 }}>{notice}</div>
      )}

      {!list.length && (
        <div style={{
          border: '1px dashed var(--border)', borderRadius: 'var(--radius)',
          padding: 32, textAlign: 'center', color: 'var(--text-secondary)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🚨</div>
          <div style={{ marginBottom: 4 }}>No messages prepared yet.</div>
          <div style={{ fontSize: 13 }}>
            The point of these is that they are ready before anything happens. Write them now.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {list.map(o => (
          <div key={o.id} className="card" style={{
            padding: 14,
            borderColor: o.running ? 'var(--danger)' : undefined,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 18 }}>{o.kind === 'emergency' ? '🚨' : '⚡'}</span>
              <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {o.name}
              </strong>
              {o.running && <span className="badge badge-red">LIVE</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {o.kind === 'emergency' ? 'Emergency' : 'Flash'} · {targetSummary(o)} · {o.deviceCount} screen{o.deviceCount === 1 ? '' : 's'} · {mmss(o.seconds)}
            </div>
            {o.contentKind === 'text' && (
              <div style={{
                background: o.backgroundColor, color: o.textColor,
                borderRadius: 6, padding: '10px 12px', fontSize: 13, fontWeight: 700,
                marginBottom: 10, maxHeight: 64, overflow: 'hidden',
              }}>{o.text}</div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              {o.running
                ? (
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => send(`/api/overrides/${o.id}/stand-down`, 'POST', {})}>
                    Stand down
                  </button>
                )
                : (
                  <button className="btn btn-danger btn-sm" onClick={() => { setConfirming(o); setFlashText(o.text ?? '') }}>
                    Activate
                  </button>
                )}
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(o)}>Edit</button>
              {!o.running && (
                <button className="btn btn-ghost btn-sm"
                  onClick={() => send(`/api/overrides/${o.id}`, 'DELETE')}>Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Activation asks first, and the question names the blast radius. */}
      {confirming && (
        <div className="modal-backdrop" onClick={() => setConfirming(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{confirming.kind === 'emergency' ? 'Put this emergency message up?' : 'Flash this message?'}</h2>
            </div>
            <div style={{ padding: 16 }}>
              <p style={{ marginBottom: 12 }}>
                <strong>{confirming.name}</strong> will take over{' '}
                <strong>{confirming.deviceCount} screen{confirming.deviceCount === 1 ? '' : 's'}</strong>{' '}
                for <strong>{mmss(confirming.seconds)}</strong>, replacing whatever they are playing.
              </p>
              {confirming.kind === 'flash' && confirming.contentKind === 'text' && (
                <div className="form-group">
                  <label className="form-label">Message</label>
                  <textarea className="form-input" rows={3} value={flashText}
                    onChange={e => setFlashText(e.target.value)} />
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    You can change the words now — this is the one that goes out.
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setConfirming(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={busy}
                onClick={() => activate(confirming, confirming.kind === 'flash' ? flashText : undefined)}>
                {busy ? 'Sending…' : confirming.kind === 'emergency' ? 'Put it up now' : 'Flash it now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <Editor
          value={editing}
          devices={devices}
          groups={groups}
          designs={designs}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={save}
          busy={busy}
        />
      )}
    </div>
  )
}

function Editor({ value, devices, groups, designs, onChange, onCancel, onSave, busy }: {
  value: Partial<Override>
  devices: Device[]
  groups: DeviceGroup[]
  designs: Design[]
  onChange: (v: Partial<Override>) => void
  onCancel: () => void
  onSave: () => void
  busy: boolean
}) {
  const set = (patch: Partial<Override>) => onChange({ ...value, ...patch })
  const ids = value.targetIds ?? []
  const toggle = (id: string) =>
    set({ targetIds: ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id] })

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{value.kind === 'emergency' ? 'Emergency message' : 'Flash message'}</h2>
          <button className="btn-icon" onClick={onCancel}>✕</button>
        </div>

        <div style={{ padding: 16, maxHeight: '62vh', overflowY: 'auto' }}>
          <div className="form-group">
            <label className="form-label">Name <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input className="form-input" value={value.name ?? ''}
              placeholder={value.kind === 'emergency' ? 'Fire — Building 1' : 'Fire drill notice'}
              onChange={e => set({ name: e.target.value })} />
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              For finding it in a hurry. It is not shown on screens.
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Which screens</label>
            <select className="form-select" value={value.targetKind ?? 'all'}
              onChange={e => set({ targetKind: e.target.value as TargetKind, targetIds: [] })}>
              <option value="all">Every screen</option>
              <option value="groups">Screens in certain groups</option>
              <option value="devices">Particular screens</option>
            </select>
          </div>

          {value.targetKind === 'groups' && (
            <div className="form-group">
              <label className="form-label">Groups</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {groups.map(g => (
                  <button key={g.id}
                    className={`btn btn-sm ${ids.includes(g.id) ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => toggle(g.id)}>{g.name}</button>
                ))}
                {!groups.length && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    No groups yet — make some on the Devices page, or target every screen.
                  </div>
                )}
              </div>
            </div>
          )}

          {value.targetKind === 'devices' && (
            <div className="form-group">
              <label className="form-label">Screens</label>
              <div style={{
                maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: 8,
              }}>
                {devices.map(d => (
                  <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                    <input type="checkbox" checked={ids.includes(d.id)} onChange={() => toggle(d.id)} />
                    <span className={d.status === 'online' ? 'dot-green' : 'dot-gray'} />
                    <span style={{ flex: 1 }}>{d.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{d.status}</span>
                  </label>
                ))}
                {!devices.length && (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>No screens paired yet.</div>
                )}
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">What it shows</label>
            <select className="form-select" value={value.contentKind ?? 'text'}
              onChange={e => set({ contentKind: e.target.value as ContentKind })}>
              <option value="text">A message typed here</option>
              <option value="design">A design</option>
            </select>
          </div>

          {value.contentKind === 'text' && (
            <>
              <div className="form-group">
                <label className="form-label">Message <span style={{ color: 'var(--danger)' }}>*</span></label>
                <textarea className="form-input" rows={3} value={value.text ?? ''}
                  placeholder="FIRE IN PROGRESS — leave by the nearest exit. Do not use the lift."
                  onChange={e => set({ text: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Background</label>
                  <input className="form-input" type="color" value={value.backgroundColor ?? '#b3261e'}
                    onChange={e => set({ backgroundColor: e.target.value })} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Words</label>
                  <input className="form-input" type="color" value={value.textColor ?? '#ffffff'}
                    onChange={e => set({ textColor: e.target.value })} />
                </div>
              </div>
            </>
          )}

          {value.contentKind === 'design' && (
            <div className="form-group">
              <label className="form-label">Design <span style={{ color: 'var(--danger)' }}>*</span></label>
              <select className="form-select" value={value.designId ?? ''}
                onChange={e => set({ designId: e.target.value })}>
                <option value="">Choose a design…</option>
                {designs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Make emergency designs in the Designer, so the wording is agreed before anyone needs it.
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Stays up for</label>
            <input className="form-input" type="number" min={10} max={43200}
              value={value.seconds ?? 600}
              onChange={e => set({ seconds: Number(e.target.value) })} />
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Seconds. Screens end it themselves when the time is up, even if this computer is asleep.
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={onSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
