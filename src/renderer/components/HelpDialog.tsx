import { useState } from 'react'

const TABS = ['Quick Start', 'Android TV', 'LG webOS', 'Samsung Tizen'] as const
type Tab = typeof TABS[number]

interface StepProps { num: number; title: string; children: React.ReactNode }

function Step({ num, title, children }: StepProps) {
  return (
    <div style={{
      background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '18px 20px',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: 'rgba(59,130,246,.15)', color: '#60a5fa',
        fontSize: 13, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 10,
      }}>{num}</div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
        {children}
      </div>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return (
    <code style={{
      display: 'block', marginTop: 8,
      background: '#0f172a', border: '1px solid var(--border)',
      borderRadius: 6, padding: '7px 10px',
      fontFamily: 'monospace', fontSize: 12, color: '#60a5fa',
      wordBreak: 'break-all',
    }}>{children}</code>
  )
}

function QuickStart() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16 }}>
      <Step num={1} title="Start the Desktop App">
        Launch <b>Signage Manager</b> on your Windows PC. It automatically starts the local server on port 3001.
      </Step>
      <Step num={2} title="Upload Content">
        Go to <b>Content Library</b> and upload images, videos, or HTML pages. Set duration and schedule mode for each item.
      </Step>
      <Step num={3} title="Install a TV App">
        Install the TV player on your screen (Android, LG, or Samsung — see the tabs above). Enter the server URL shown in <b>Settings</b>.
      </Step>
      <Step num={4} title="Manage Devices">
        Once a TV connects, it appears in <b>Devices</b>. You can push content on demand or let the schedule run automatically.
      </Step>
      <Step num={5} title="Find the Server URL">
        Go to <b>Settings</b> to copy your server URL (e.g. <code style={{ fontSize: 11 }}>http://192.168.1.x:3001</code>). Enter this in any TV app.
      </Step>
      <Step num={6} title="Auto-reconnect">
        Every TV app reconnects automatically on reboot. The desktop app must be running for the TVs to show content.
      </Step>
    </div>
  )
}

function AndroidTV() {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.65 }}>
        The Android TV app works on TCL, Google TV, Android TV boxes, and similar devices.
        Install it once via ADB — it auto-starts on every boot.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16, marginBottom: 20 }}>
        <Step num={1} title="Enable Developer Mode">
          Settings → Device Preferences → About → scroll to <b>Build</b> → click it <b>7 times</b> until "Developer mode enabled" appears.
        </Step>
        <Step num={2} title="Enable USB / Network Debugging">
          Settings → Device Preferences → Developer Options → turn on <b>USB debugging</b>. Note the TV's IP address from Settings → Network.
        </Step>
        <Step num={3} title="Connect via ADB">
          On this PC, open a terminal:
          <Code>adb connect &lt;TV-IP&gt;</Code>
        </Step>
        <Step num={4} title="Install the APK">
          <Code>adb install signage-tv-player.apk</Code>
        </Step>
        <Step num={5} title="Configure Server URL">
          The app shows a setup screen on first launch. Enter the URL from <b>Settings</b>, or skip via ADB:
        </Step>
        <Step num={6} title="Done — auto-starts on boot">
          The TV app launches automatically every time the TV powers on. Hold <b>OK</b> for 3 seconds to return to the setup screen.
        </Step>
      </div>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '16px 20px',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>⚡ Skip setup via ADB</div>
        <Code>adb shell am start -n com.signage.tvplayer/.SetupActivity --es SERVER_URL "http://192.168.1.x:3001"</Code>
      </div>
    </div>
  )
}

function LGWebOS() {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.65 }}>
        The LG webOS app works on LG OLED, QNED, NanoCell, and UHD TVs (webOS 4+).
        Install it via LG's webOS Dev Manager — no ADB required.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16, marginBottom: 20 }}>
        <Step num={1} title="Enable Developer Mode">
          On your LG TV go to <b>Settings → Support → TV Information</b>, then click the LG logo <b>5 times</b> to reveal the Developer Mode app.
        </Step>
        <Step num={2} title="Install Developer Mode App">
          Open the <b>LG Developer Mode</b> app from the Content Store, sign in with a free LG developer account, and toggle <b>Dev Mode Status</b> ON.
        </Step>
        <Step num={3} title="Install webOS Dev Manager">
          On this PC, download <b>webOS TV Dev Manager</b> from the LG developer site (or the VS Code extension). Add your TV's IP address as a device.
        </Step>
        <Step num={4} title="Install the IPK">
          In Dev Manager, select your TV, click <b>Install App</b>, and choose <code style={{ fontSize: 11 }}>signage-webos-player.ipk</code>.
        </Step>
        <Step num={5} title="Configure Server URL">
          Launch <b>Signage Player</b> from the LG Home Screen. Enter the server URL from <b>Settings</b> and press Connect.
        </Step>
        <Step num={6} title="Done — reconnects automatically">
          The app auto-connects on next launch. Press <b>Back</b> on your remote to return to settings.
        </Step>
      </div>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '16px 20px',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>⚡ CLI install (ares-cli)</div>
        <Code>ares-install --device &lt;TV-name&gt; signage-webos-player.ipk</Code>
      </div>
    </div>
  )
}

function SamsungTizen() {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.65 }}>
        The Samsung Tizen app works on Samsung QLED, Neo QLED, The Frame, and similar TVs (Tizen 6.0+, 2021 models and newer).
        Install it via Tizen Studio.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 16, marginBottom: 20 }}>
        <Step num={1} title="Enable Developer Mode">
          On your Samsung TV go to <b>Apps</b>, then quickly enter <b>12345</b> on the remote. Toggle Developer Mode <b>ON</b> and enter this PC's IP address.
        </Step>
        <Step num={2} title="Restart the TV">
          The TV prompts you to restart. After reboot, a <b>DEVELOP MODE</b> banner appears at the top of the Apps screen.
        </Step>
        <Step num={3} title="Install Tizen Studio">
          Download <b>Tizen Studio</b> from the Samsung developer site and install it on this PC. Open <b>Device Manager</b> from the toolbar.
        </Step>
        <Step num={4} title="Connect the TV">
          In Device Manager, click <b>Remote Device Manager → Scan</b> or add the TV IP manually. Right-click → <b>Connect</b>. Status turns green.
        </Step>
        <Step num={5} title="Install the WGT">
          In Tizen Studio go to <b>Tools → Tizen → Install Tizen App</b>, select the TV, and choose <code style={{ fontSize: 11 }}>signage-tizen.wgt</code>.
        </Step>
        <Step num={6} title="Done — reconnects automatically">
          Launch <b>Signage Player</b> from the Samsung Smart Hub. Press <b>Back</b> on your remote to return to settings.
        </Step>
      </div>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '16px 20px',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>⚡ CLI install (Tizen CLI)</div>
        <Code>tizen sdb connect &lt;TV-IP&gt; && tizen install -n signage-tizen.wgt -t &lt;device-id&gt;</Code>
      </div>
    </div>
  )
}

interface HelpDialogProps { onClose: () => void }

export default function HelpDialog({ onClose }: HelpDialogProps) {
  const [tab, setTab] = useState<Tab>('Quick Start')

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg-primary, #0f172a)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        width: '100%', maxWidth: 900,
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>How To Use Signage Manager</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Setup guides for every supported platform
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', borderRadius: 6,
              padding: '6px 10px', cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 4, padding: '12px 24px 0',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '8px 16px', borderRadius: '6px 6px 0 0',
                border: '1px solid var(--border)',
                borderBottom: tab === t ? '1px solid var(--bg-primary, #0f172a)' : undefined,
                background: tab === t ? 'var(--bg-primary, #0f172a)' : 'transparent',
                color: tab === t ? 'var(--text-primary, #f1f5f9)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: tab === t ? 600 : 400,
                cursor: 'pointer', marginBottom: -1,
              }}
            >{t}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {tab === 'Quick Start'    && <QuickStart />}
          {tab === 'Android TV'     && <AndroidTV />}
          {tab === 'LG webOS'       && <LGWebOS />}
          {tab === 'Samsung Tizen'  && <SamsungTizen />}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 24px',
          borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0,
        }}>
          <span>
            Download TV apps at{' '}
            <a
              onClick={() => window.electronAPI.openExternal('https://signage.frozenbit.eu')}
              style={{ color: '#60a5fa', cursor: 'pointer', textDecoration: 'underline' }}
            >
              signage.frozenbit.eu
            </a>
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '7px 20px', borderRadius: 6,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              color: 'var(--text-primary, #f1f5f9)', fontSize: 13,
              cursor: 'pointer',
            }}
          >Close</button>
        </div>
      </div>
    </div>
  )
}
