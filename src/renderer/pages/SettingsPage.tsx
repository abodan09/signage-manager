import { useEffect, useState } from 'react'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

export default function SettingsPage() {
  const serverUrl = useServerUrl()
  const [copied, setCopied] = useState(false)
  const [health, setHealth] = useState<{ ok: boolean; connectedTVs?: number } | null>(null)

  useEffect(() => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/health`)
      .then(r => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }))
  }, [serverUrl])

  const tvUrl   = `${serverUrl}/tv/player`
  const adbCmd  = `adb shell am start -n com.signage.tvplayer/.SetupActivity --es SERVER_URL "${serverUrl}"`

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  return (
    <div>
      <h1>Settings</h1>
      <p className="subtitle">Connection details and setup instructions</p>

      {/* Server info */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Server Status</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span className={`dot ${health?.ok ? 'dot-green' : 'dot-gray'}`} />
          <span style={{ fontWeight: 500 }}>{health?.ok ? 'Running' : 'Not responding'}</span>
          {health?.ok && <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>· {health.connectedTVs ?? 0} TV(s) connected</span>}
        </div>
        <div className="form-group">
          <div className="form-label">Local Server URL</div>
          <div className="url-box">
            <span>{serverUrl}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(serverUrl)}>{copied ? 'Copied!' : 'Copy'}</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
            The server runs automatically when Signage Manager is open. All TVs must be on the same network.
          </div>
        </div>
      </div>

      {/* TV Player */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>TV Player</h2>
        <div className="form-group">
          <div className="form-label">Player URL (open this on any browser to preview)</div>
          <div className="url-box">
            <span>{tvUrl}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => copy(tvUrl)}>Copy</button>
              <button className="btn btn-primary btn-sm" onClick={() => window.electronAPI.openExternal(tvUrl)}>Preview ↗</button>
            </div>
          </div>
        </div>
      </div>

      {/* ADB setup */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Android TV App Setup</h2>
        <ol style={{ paddingLeft: 20, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 2 }}>
          <li>Open Android Studio and load the <code style={{ background: 'var(--bg-primary)', padding: '1px 6px', borderRadius: 4 }}>tv-app/</code> folder from the project.</li>
          <li>Build the APK: <b>Build → Build Bundle(s) / APK(s) → Build APK(s)</b></li>
          <li>Enable ADB on the TCL TV: Settings → Device Preferences → About → Build (click 7×) → Developer Options → USB debugging ON</li>
          <li>Find the TV&apos;s IP: Settings → Network → Status</li>
          <li>Connect: <code style={{ background: 'var(--bg-primary)', padding: '1px 6px', borderRadius: 4 }}>adb connect &lt;TV-IP&gt;</code></li>
          <li>Install APK: <code style={{ background: 'var(--bg-primary)', padding: '1px 6px', borderRadius: 4 }}>adb install app-debug.apk</code></li>
          <li>
            Optionally configure the server URL via ADB (skips the setup screen):
            <div className="url-box" style={{ marginTop: 8, fontSize: 12, wordBreak: 'break-all' }}>
              <span>{adbCmd}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => copy(adbCmd)} style={{ flexShrink: 0 }}>Copy</button>
            </div>
          </li>
        </ol>
      </div>

      {/* Fleet note */}
      <div className="card">
        <h2>Scaling to a Fleet</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          For multiple TVs, install the same APK on each and point them all to this server URL. Each TV auto-registers with a unique device ID. Use the <b>Devices</b> page to name and manage each screen individually, and use <b>Push Content</b> to override a specific TV on demand.
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 10 }}>
          For remote deployments (TVs not on the same LAN), run the server on a cloud VPS and update the TV app&apos;s server URL to the public address.
        </p>
      </div>
    </div>
  )
}
