import { Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import ContentPage from './pages/ContentPage'
import DevicesPage from './pages/DevicesPage'
import SettingsPage from './pages/SettingsPage'
import UpdateBanner from './components/UpdateBanner'
import HelpDialog from './components/HelpDialog'
import ReportIssueDialog from './components/ReportIssueDialog'
import type { UpdateInfo } from './types'

function AboutDialog({ version, onClose }: { version: string; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-primary, #0f172a)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '32px 40px',
        width: 360,
        textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
      }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="56" height="56" style={{ borderRadius: 12 }}>
          <rect width="512" height="512" rx="96" fill="#0f172a"/>
          <rect x="56" y="112" width="400" height="264" rx="22" fill="#1e293b" stroke="#3b82f6" strokeWidth="14"/>
          <rect x="82" y="138" width="348" height="212" rx="10" fill="#060c1a"/>
          <rect x="104" y="160" width="304" height="48" rx="8" fill="#3b82f6"/>
          <rect x="104" y="228" width="196" height="14" rx="5" fill="#334155"/>
          <rect x="104" y="252" width="256" height="14" rx="5" fill="#334155"/>
          <rect x="104" y="276" width="156" height="14" rx="5" fill="#334155"/>
          <rect x="104" y="300" width="220" height="14" rx="5" fill="#334155"/>
          <circle cx="364" cy="184" r="18" fill="#22c55e"/>
          <path d="M388 167 Q405 184 388 201" stroke="#22c55e" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.65"/>
          <path d="M400 155 Q421 184 400 213" stroke="#22c55e" strokeWidth="7" fill="none" strokeLinecap="round" opacity="0.35"/>
          <rect x="228" y="376" width="56" height="32" rx="10" fill="#1e293b"/>
          <rect x="172" y="408" width="168" height="20" rx="10" fill="#1e293b"/>
        </svg>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Signage Manager</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            Version {version}
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Digital signage management for Windows.
          <br/>Control TVs, schedules, and content from one place.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <a
            onClick={() => window.electronAPI.openExternal('https://signage.frozenbit.eu')}
            style={{ color: '#60a5fa', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
          >Website</a>
          <span style={{ color: 'var(--border)' }}>·</span>
          <a
            onClick={() => window.electronAPI.openExternal('https://github.com/abodan09/signage-manager')}
            style={{ color: '#60a5fa', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
          >GitHub</a>
        </div>
        <button
          onClick={onClose}
          style={{
            marginTop: 8, padding: '8px 24px', borderRadius: 6,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            color: 'var(--text-primary, #f1f5f9)', fontSize: 13, cursor: 'pointer',
          }}
        >Close</button>
      </div>
    </div>
  )
}

function CheckUpdatesDialog({
  onClose,
}: { onClose: () => void }) {
  const [state, setState] = useState<'checking' | 'up-to-date' | 'available' | 'error'>('checking')
  const [info, setInfo]   = useState<UpdateInfo | null>(null)

  useEffect(() => {
    window.electronAPI.checkForUpdates().then(result => {
      setInfo(result)
      setState(result.available ? 'available' : 'up-to-date')
    }).catch(() => setState('error'))
  }, [])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-primary, #0f172a)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '32px 40px',
        width: 380,
        textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      }}>
        {state === 'checking' && (
          <>
            <div style={{ fontSize: 36 }}>🔄</div>
            <div style={{ fontWeight: 600 }}>Checking for updates…</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Contacting GitHub releases</div>
          </>
        )}
        {state === 'up-to-date' && (
          <>
            <div style={{ fontSize: 36 }}>✅</div>
            <div style={{ fontWeight: 600 }}>You're up to date</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Version {info?.currentVersion} is the latest release.
            </div>
          </>
        )}
        {state === 'available' && info && (
          <>
            <div style={{ fontSize: 36 }}>🚀</div>
            <div style={{ fontWeight: 600 }}>Update available: v{info.version}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              You're on v{info.currentVersion}. A new version is ready to download.
            </div>
            {info.releaseNotes && (
              <div style={{
                width: '100%', textAlign: 'left',
                background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 14px', maxHeight: 160, overflowY: 'auto',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  What's new
                </div>
                {info.releaseNotes.split('\n').filter(Boolean).map((line, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-primary, #f1f5f9)', marginBottom: 4 }}>
                    <span style={{ color: '#3b82f6', flexShrink: 0 }}>•</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'center' }}>
              {info.downloadUrl && (
                <button
                  onClick={() => { onClose(); window.electronAPI.installUpdate(info.downloadUrl!) }}
                  style={{
                    padding: '9px 20px', borderRadius: 6,
                    background: '#3b82f6', border: 'none',
                    color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  }}
                >Update Now</button>
              )}
              <button
                onClick={() => { window.electronAPI.openReleaseUrl(info.releasePageUrl); onClose() }}
                style={{
                  padding: '9px 20px', borderRadius: 6,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  color: 'var(--text-primary, #f1f5f9)', fontSize: 13, cursor: 'pointer',
                }}
              >View Release</button>
            </div>
          </>
        )}
        {state === 'error' && (
          <>
            <div style={{ fontSize: 36 }}>⚠️</div>
            <div style={{ fontWeight: 600 }}>Couldn't check for updates</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Check your internet connection or visit the releases page.
            </div>
          </>
        )}
        <button
          onClick={onClose}
          style={{
            padding: '7px 20px', borderRadius: 6,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
          }}
        >Dismiss</button>
      </div>
    </div>
  )
}

export default function App() {
  const [updateInfo, setUpdateInfo]       = useState<UpdateInfo | null>(null)
  const [showHelp, setShowHelp]                 = useState(false)
  const [showAbout, setShowAbout]               = useState(false)
  const [showCheckUpdate, setShowCheckUpdate]   = useState(false)
  const [showReportIssue, setShowReportIssue]   = useState(false)
  const [version, setVersion]                   = useState('')

  useEffect(() => {
    window.electronAPI.getVersion().then(setVersion)

    window.electronAPI.onMenuEvent((event, payload) => {
      if (event === 'show-help')      setShowHelp(true)
      if (event === 'about')          setShowAbout(true)
      if (event === 'check-updates')  setShowCheckUpdate(true)
      if (event === 'report-issue')   setShowReportIssue(true)
      if (event === 'update-available' && payload) setUpdateInfo(payload)
    })
  }, [])

  return (
    <>
      {updateInfo && (
        <UpdateBanner info={updateInfo} onDismiss={() => setUpdateInfo(null)} />
      )}

      <div
        className="app-shell"
        style={updateInfo ? { paddingTop: 44 } : undefined}
      >
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/"          element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/content"   element={<ContentPage />} />
            <Route path="/devices"   element={<DevicesPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Routes>
        </main>
      </div>

      {showHelp        && <HelpDialog onClose={() => setShowHelp(false)} />}
      {showAbout       && <AboutDialog version={version} onClose={() => setShowAbout(false)} />}
      {showCheckUpdate && <CheckUpdatesDialog onClose={() => setShowCheckUpdate(false)} />}
      {showReportIssue && <ReportIssueDialog version={version} onClose={() => setShowReportIssue(false)} />}
    </>
  )
}
