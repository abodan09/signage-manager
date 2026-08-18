import { useState, useEffect } from 'react'
import type { UpdateInfo } from '../types'

interface Props {
  info: UpdateInfo
  onDismiss: () => void
}

export default function UpdateBanner({ info, onDismiss }: Props) {
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    window.electronAPI.onUpdateProgress(pct => setProgress(pct))
    window.electronAPI.onUpdateError(msg => { setError(msg); setInstalling(false) })
  }, [])

  async function handleInstall() {
    if (!info.downloadUrl) {
      window.electronAPI.openReleaseUrl(info.releasePageUrl)
      return
    }
    setInstalling(true)
    setError(null)
    window.electronAPI.installUpdate(info.downloadUrl)
  }

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
        {installing && progress !== null ? (
          <>
            <span style={{ color: '#60a5fa', fontWeight: 600 }}>
              Downloading update… {progress}%
            </span>
            <div style={{
              marginTop: 4, height: 3, borderRadius: 2,
              background: '#334155', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 2,
                background: '#3b82f6',
                width: `${progress}%`,
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
            {' '}— a new version of Signage Manager is ready.
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
