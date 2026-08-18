import type { WhatsNew } from '../types'

interface Props {
  info: WhatsNew
  onClose: () => void
}

/**
 * Shown once, on the first run after an update. Not before installing: at that
 * point a change list is arguing for a decision the operator has already made.
 * Afterwards it answers the question they actually have — what changed on the
 * thing now in front of me.
 */
export default function WhatsNewDialog({ info, onClose }: Props) {
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
        padding: '28px 32px',
        width: 500,
        maxHeight: '85vh',
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div>
          <div style={{
            fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--accent)',
          }}>
            Updated from v{info.previousVersion}
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>
            What&rsquo;s new in v{info.version}
          </h2>
        </div>

        <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 0, listStyle: 'none' }}>
          {info.notes.map((n, i) => (
            <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.6 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                flexShrink: 0, marginTop: 7,
              }} />
              <span style={{ color: 'var(--text-primary)' }}>{n}</span>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <button
            onClick={() => window.electronAPI.openExternal(info.releasePageUrl)}
            style={{
              padding: '8px 0', background: 'none', border: 'none',
              color: 'var(--text-secondary)', fontSize: 12.5, cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Full release notes ↗
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '9px 24px', borderRadius: 6,
              background: 'var(--accent)', border: 'none',
              color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
