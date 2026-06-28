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
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="28" height="28" style={{ borderRadius: 5, flexShrink: 0 }}>
            <rect width="512" height="512" rx="96" fill="#0f172a"/>
            <rect x="56" y="112" width="400" height="264" rx="22" fill="#1e293b" stroke="#3b82f6" strokeWidth="14"/>
            <rect x="82" y="138" width="348" height="212" rx="10" fill="#060c1a"/>
            <rect x="104" y="160" width="304" height="48" rx="8" fill="#3b82f6"/>
            <rect x="104" y="228" width="196" height="14" rx="5" fill="#334155"/>
            <rect x="104" y="252" width="256" height="14" rx="5" fill="#334155"/>
            <circle cx="364" cy="184" r="18" fill="#22c55e"/>
            <path d="M388 167 Q405 184 388 201" stroke="#22c55e" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.65"/>
          </svg>
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
