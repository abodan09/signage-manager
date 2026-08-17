import { NavLink } from 'react-router-dom'
import { useEffect, useState, type ReactElement } from 'react'

/* Meridian line icons — 18x18, 1.8px stroke, currentColor. */
function Icon({ children }: { children: ReactElement }): ReactElement {
  return (
    <svg
      className="sidebar-nav-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const ICON_DASHBOARD = (
  <Icon><g><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></g></Icon>
)
const ICON_CONTENT = (
  <Icon><g><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 15-5-5-8 8" /></g></Icon>
)
const ICON_APPS = (
  <Icon><g><path d="M10 4.5a1.9 1.9 0 0 1 3.8 0V6h3.4a1 1 0 0 1 1 1v3.4h1.3a1.9 1.9 0 0 1 0 3.8h-1.3V18a1 1 0 0 1-1 1h-3.6v-1.4a1.9 1.9 0 0 0-3.8 0V19H6.2a1 1 0 0 1-1-1v-3.6H4a1.9 1.9 0 0 1 0-3.8h1.2V7a1 1 0 0 1 1-1H10z" /></g></Icon>
)
const ICON_TEMPLATES = (
  <Icon><g><rect x="3" y="7" width="13" height="13" rx="2" /><path d="M8 4h11a1 1 0 0 1 1 1v11" /></g></Icon>
)
const ICON_LAYOUTS = (
  <Icon><g><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="14" y1="4" x2="14" y2="20" /><line x1="14" y1="12" x2="21" y2="12" /></g></Icon>
)
const ICON_DEVICES = (
  <Icon><g><rect x="2" y="4" width="20" height="13" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></g></Icon>
)
const ICON_EMERGENCY = (
  <Icon><g><path d="M12 4.5 21 19.5H3z" /><line x1="12" y1="10" x2="12" y2="14" /><circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" /></g></Icon>
)
const ICON_SETTINGS = (
  <Icon><g><circle cx="12" cy="12" r="3.1" /><path d="M12 3v2.2M12 18.8V21M4.6 7.8l1.9 1.1M17.5 15.1l1.9 1.1M19.4 7.8l-1.9 1.1M6.5 15.1l-1.9 1.1" /></g></Icon>
)

const NAV: { to: string; icon: ReactElement; label: string }[] = [
  { to: '/dashboard', icon: ICON_DASHBOARD, label: 'Dashboard' },
  { to: '/content',   icon: ICON_CONTENT,   label: 'Content Library' },
  { to: '/apps',      icon: ICON_APPS,      label: 'Apps' },
  { to: '/templates', icon: ICON_TEMPLATES, label: 'Templates' },
  { to: '/layouts',   icon: ICON_LAYOUTS,   label: 'Screen Layouts' },
  { to: '/devices',   icon: ICON_DEVICES,   label: 'Devices' },
  { to: '/emergency', icon: ICON_EMERGENCY, label: 'Emergency' },
  { to: '/settings',  icon: ICON_SETTINGS,  label: 'Settings' },
]

export default function Sidebar() {
  const [serverUrl, setServerUrl] = useState('')
  const [online, setOnline] = useState(false)
  // A message taking over the walls has to be visible from every page, not just
  // from Emergency — so the rail carries the flag.
  const [liveCount, setLiveCount] = useState(0)

  useEffect(() => {
    window.electronAPI.getServerUrl().then(url => {
      setServerUrl(url)
      const check = () => {
        fetch(`${url}/api/health`)
          .then(() => setOnline(true))
          .catch(() => setOnline(false))
        fetch(`${url}/api/overrides`).then(r => r.json())
          .then(d => setLiveCount((d.overrides ?? []).filter((o: { running?: boolean }) => o.running).length))
          .catch(() => setLiveCount(0))
      }
      check()
      const t = setInterval(check, 5000)
      return () => clearInterval(t)
    })
  }, [])

  return (
    <aside className="sidebar-rail" style={{
      width: 228, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* logo */}
      <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid var(--sb-line)' }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 600,
          letterSpacing: '-0.2px', color: '#FFFFFF',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="34" height="34" style={{ borderRadius: 8, flexShrink: 0 }}>
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
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '1.5px',
          textTransform: 'uppercase', color: 'var(--sb-muted)', marginTop: 4,
        }}>Management Console</div>
      </div>

      {/* nav */}
      <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '1.4px',
          textTransform: 'uppercase', color: 'var(--sb-muted)', padding: '6px 12px 8px',
        }}>Console</div>
        {NAV.map(n => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `sidebar-nav-link${isActive ? ' active' : ''}`}
          >
            {n.icon}
            <span style={{ flex: 1 }}>{n.label}</span>
            {n.to === '/emergency' && liveCount > 0 && (
              <span className="sidebar-live" title={`${liveCount} message${liveCount === 1 ? '' : 's'} on screen now`}>Live</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* server status */}
      <div style={{
        padding: '16px 20px',
        borderTop: '1px solid var(--sb-line)',
        fontSize: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <span className={`dot ${online ? 'dot-green' : 'dot-gray'}`} />
          <span style={{ color: '#FFFFFF', fontWeight: 600, fontSize: 12.5 }}>
            {online ? 'Server Online' : 'Server Offline'}
          </span>
        </div>
        <div style={{
          color: 'var(--sb-muted)', fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '.2px', wordBreak: 'break-all',
        }}>
          {serverUrl}
        </div>
      </div>
    </aside>
  )
}
