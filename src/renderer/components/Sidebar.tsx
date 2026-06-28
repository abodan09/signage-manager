import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'

const NAV = [
  { to: '/dashboard', icon: '⬛', label: 'Dashboard' },
  { to: '/content',   icon: '🖼️', label: 'Content Library' },
  { to: '/devices',   icon: '📺', label: 'Devices' },
  { to: '/settings',  icon: '⚙️', label: 'Settings' },
]

export default function Sidebar() {
  const [serverUrl, setServerUrl] = useState('')
  const [online, setOnline] = useState(false)

  useEffect(() => {
    window.electronAPI.getServerUrl().then(url => {
      setServerUrl(url)
      const check = () =>
        fetch(`${url}/api/health`)
          .then(() => setOnline(true))
          .catch(() => setOnline(false))
      check()
      const t = setInterval(check, 5000)
      return () => clearInterval(t)
    })
  }, [])

  return (
    <aside style={{
      width: 220, flexShrink: 0,
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      padding: '20px 0',
    }}>
      {/* logo */}
      <div style={{ padding: '0 20px 24px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 24 }}>📡</span>
          <span>Signage</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>Management Console</div>
      </div>

      {/* nav */}
      <nav style={{ flex: 1, padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(n => (
          <NavLink
            key={n.to}
            to={n.to}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 'var(--radius)',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isActive ? 'var(--bg-tertiary)' : 'transparent',
              textDecoration: 'none', fontWeight: isActive ? 500 : 400,
              fontSize: 14, transition: 'all 0.15s',
            })}
          >
            <span>{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* server status */}
      <div style={{
        padding: '14px 16px',
        borderTop: '1px solid var(--border)',
        fontSize: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span className={`dot ${online ? 'dot-green' : 'dot-gray'}`} />
          <span style={{ color: online ? 'var(--success)' : 'var(--text-secondary)', fontWeight: 500 }}>
            {online ? 'Server Online' : 'Server Offline'}
          </span>
        </div>
        <div style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
          {serverUrl}
        </div>
      </div>
    </aside>
  )
}
