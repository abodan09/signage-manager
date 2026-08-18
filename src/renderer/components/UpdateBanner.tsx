import { useState, useEffect } from 'react'
import type { UpdateInfo } from '../types'

interface Props {
  info: UpdateInfo
  onDismiss: () => void
  /** The operator already pressed Update Now in the manual dialog; this banner
   *  is only here to show them it is happening. */
  startImmediately?: boolean
}

export default function UpdateBanner({ info, onDismiss, startImmediately }: Props) {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [showNotes, setShowNotes]   = useState(false)
  const notes = (info.releaseNotes ?? '').split('\n').map(l => l.trim()).filter(Boolean)

  useEffect(() => {
    window.electronAPI.onUpdateProgress(pct => setProgress(pct))
    window.electronAPI.onUpdateError(msg => { setError(msg); setInstalling(false) })
  }, [])

  function handleInstall() {
    if (!info.downloadUrl) {
      window.electronAPI.openReleaseUrl(info.releasePageUrl)
      return
    }
    setInstalling(true)
    setError(null)
    // The whole info object, not just the address: the checksum and length
    // travel with it so the main process can refuse an installer that did not
    // arrive intact.
    window.electronAPI.installUpdate(info)
  }

  useEffect(() => {
    if (startImmediately && info.downloadUrl && !installing) handleInstall()
    // Once, on the handover from the manual dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startImmediately])

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'linear-gradient(90deg, #1e3a5f 0%, #1e293b 100%)',
      borderBottom: '1px solid #3b82f6',
      padding: '10px 20px',
      display: 'flex', alignItems: 'center', gap: 12,
      fontSize: 13,
    }}>
      <span style={{ fontSize: 16 }}>🔄</span>
      <div style={{ flex: 1 }}>
        {installing ? (
          <>
            <span style={{ color: '#60a5fa', fontWeight: 600 }}>
              {/* A server that sends no Content-Length gives us no percentage,
                  and the old banner fell through to "a new version is ready"
                  with its buttons hidden while 78 MB quietly downloaded. */}
              {progress === null ? 'Starting download…' : `Downloading update… ${progress}%`}
            </span>
            <div style={{
              marginTop: 4, height: 3, borderRadius: 2,
              background: '#334155', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 2,
                background: '#3b82f6',
                width: `${progress ?? 3}%`,
                transition: 'width 0.3s',
              }} />
            </div>
          </>
        ) : error ? (
          <span style={{ color: '#f87171' }}>
            Update failed: {error} —{' '}
            <a
              onClick={() => window.electronAPI.openReleaseUrl(info.releasePageUrl)}
              style={{ color: '#60a5fa', cursor: 'pointer', textDecoration: 'underline' }}
            >
              download manually
            </a>
          </span>
        ) : (
          <span style={{ color: '#f1f5f9' }}>
            <span style={{ fontWeight: 600, color: '#60a5fa' }}>
              Update available: v{info.version}
            </span>
            {/* What is in it, before the operator commits to a download and a
                restart. The banner is the path most people see and it used to
                say only "a new version is ready", which is not enough to
                decide on. Kept to one line so the fixed-height strip the app
                pads for does not have to change. */}
            {' '}— {notes.length ? notes.slice(0, 2).join(' · ') : 'a new version of Signage Manager is ready.'}
            {notes.length > 2 && (
              <span
                onClick={() => setShowNotes(v => !v)}
                style={{ color: '#60a5fa', cursor: 'pointer', marginLeft: 6, textDecoration: 'underline' }}
              >{showNotes ? 'less' : `+${notes.length - 2} more`}</span>
            )}
            {showNotes && (
              <span style={{ display: 'block', marginTop: 4, color: '#cbd5e1', fontSize: 12 }}>
                {notes.slice(2).join(' · ')}
              </span>
            )}
          </span>
        )}
      </div>

      {!installing && (
        <>
          <button
            onClick={handleInstall}
            style={{
              padding: '6px 16px', borderRadius: 6,
              background: '#3b82f6', border: 'none',
              color: '#fff', fontWeight: 600, fontSize: 12,
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            {info.downloadUrl ? 'Update Now' : 'View Release'}
          </button>
          <button
            onClick={onDismiss}
            style={{
              padding: '6px 10px', borderRadius: 6,
              background: 'transparent',
              border: '1px solid #334155',
              color: '#94a3b8', fontSize: 12,
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            Later
          </button>
        </>
      )}
    </div>
  )
}
