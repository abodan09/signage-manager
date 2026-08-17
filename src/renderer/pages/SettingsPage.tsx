import { useEffect, useState } from 'react'
import type { ServerSettings } from '../types'

function useServerUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => { window.electronAPI.getServerUrl().then(setUrl) }, [])
  return url
}

// The LAN address TVs must use. getServerUrl() returns http://localhost:… which
// only works on this PC — showing it as "the server URL" sent users typing an
// address their TV can never reach.
function useLanUrl() {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    const load = () => window.electronAPI.getLanUrl().then(u => { if (alive) setUrl(u) })
    load()
    const t = setInterval(load, 10_000)  // follows network changes
    return () => { alive = false; clearInterval(t) }
  }, [])
  return url
}

export default function SettingsPage() {
  const serverUrl = useServerUrl()
  const lanUrl    = useLanUrl()
  const [copied, setCopied] = useState(false)
  const [health, setHealth] = useState<{ ok: boolean; connectedTVs?: number } | null>(null)
  const [telemetry, setTelemetry] = useState<{ enabled: boolean; installId: string } | null>(null)
  const [settings, setSettings] = useState<ServerSettings | null>(null)
  const [pairMsg, setPairMsg] = useState('')

  useEffect(() => {
    window.electronAPI.getTelemetryStatus?.().then(setTelemetry).catch(() => {})
  }, [])

  const loadSettings = () => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/settings`).then(r => r.json()).then(setSettings).catch(() => {})
  }
  useEffect(loadSettings, [serverUrl])

  async function setPairingMode(mode: 'open' | 'required') {
    await fetch(`${serverUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingMode: mode }),
    })
    setPairMsg(mode === 'required'
      ? 'New screens must now be added with a code.'
      : 'Any screen on this network can connect again.')
    setTimeout(() => setPairMsg(''), 4000)
    loadSettings()
  }

  async function reloadPlayers() {
    const res = await fetch(`${serverUrl}/api/settings/reload-players`, { method: 'POST' })
    const d = await res.json().catch(() => ({ sent: 0 }))
    setPairMsg(`Reloaded ${d.sent} screen${d.sent === 1 ? '' : 's'}.`)
    setTimeout(() => setPairMsg(''), 4000)
  }

  function toggleTelemetry() {
    if (!telemetry) return
    const enabled = !telemetry.enabled
    setTelemetry({ ...telemetry, enabled })
    window.electronAPI.setTelemetryEnabled(enabled)
  }

  useEffect(() => {
    if (!serverUrl) return
    fetch(`${serverUrl}/api/health`)
      .then(r => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }))
  }, [serverUrl])

  const tvUrl   = `${serverUrl}/tv/player`
  const adbCmd  = `adb shell am start -n com.signage.tvplayer/.SetupActivity --es SERVER_URL "${lanUrl}"`

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
          <div className="form-label">Server URL for TVs — enter this on the TV setup screen</div>
          <div className="url-box">
            <span style={{ fontWeight: 600 }}>{lanUrl || 'Detecting network address…'}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(lanUrl)}>{copied ? 'Copied!' : 'Copy'}</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
            The server runs automatically when Signage Manager is open. All TVs must be on the same network as this PC
            (VPN and virtual adapters are ignored automatically).
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

      {/* Screen pairing */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Screen Pairing</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 16 }}>
          Controls whether a TV can connect to this server on its own, or must be added with a code
          from the Devices page.
        </p>

        {settings && (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <span className="badge badge-green">{settings.pairedCount} paired</span>
              <span className="badge badge-gray">{settings.unpairedCount} unpaired</span>
              {settings.legacyCount > 0 && (
                <span className="badge badge-gray">{settings.legacyCount} from before pairing</span>
              )}
            </div>

            {(['open', 'required'] as const).map(mode => (
              <label
                key={mode}
                style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer',
                  padding: '12px 14px', borderRadius: 8, marginBottom: 8,
                  border: `1px solid ${settings.pairingMode === mode ? '#3b82f6' : 'var(--border)'}`,
                  background: settings.pairingMode === mode ? 'rgba(59,130,246,0.08)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="pairing-mode"
                  checked={settings.pairingMode === mode}
                  onChange={() => setPairingMode(mode)}
                  style={{ marginTop: 3, accentColor: '#3b82f6', cursor: 'pointer' }}
                />
                <span>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>
                    {mode === 'open' ? 'Open — any screen on this network can connect' : 'Required — new screens must be added with a code'}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.6 }}>
                    {mode === 'open'
                      ? 'The original behaviour. Simplest on a private network you control.'
                      : 'Recommended on shared or guest Wi-Fi. Screens already connected keep working.'}
                  </div>
                </span>
              </label>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={reloadPlayers}>
                Reload all screens
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center' }}>
                Run this after updating, before switching to Required — it pulls every screen onto the new player.
              </span>
            </div>

            {pairMsg && (
              <div style={{ color: 'var(--success)', fontSize: 13, marginTop: 12 }}>{pairMsg}</div>
            )}
          </>
        )}
      </div>

      {/* Privacy */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Privacy</h2>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <input
            type="checkbox"
            id="telemetry-toggle"
            checked={telemetry?.enabled ?? true}
            onChange={toggleTelemetry}
            disabled={!telemetry}
            style={{ marginTop: 3, width: 16, height: 16, accentColor: '#3b82f6', cursor: 'pointer' }}
          />
          <label htmlFor="telemetry-toggle" style={{ cursor: 'pointer' }}>
            <div style={{ fontWeight: 500, fontSize: 14 }}>Share anonymous usage statistics</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.6 }}>
              Helps improve Signage Manager by reporting which features are used and that the app is running.
              Only a random install ID, app version, OS and named feature events are sent — never your content,
              media, file names, or any personal data.
              {telemetry && <> Install ID: <code style={{ background: 'var(--bg-primary)', padding: '1px 6px', borderRadius: 4 }}>{telemetry.installId.slice(0, 8)}</code></>}
            </div>
          </label>
        </div>
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
