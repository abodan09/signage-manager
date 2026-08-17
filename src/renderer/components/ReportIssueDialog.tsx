import { useState } from 'react'

interface Props {
  version: string
  onClose: () => void
}

const CATEGORIES = [
  { value: 'bug',     label: '🐛 Bug / Something broken' },
  { value: 'feature', label: '✨ Feature request' },
  { value: 'question',label: '❓ Question / Help' },
  { value: 'other',   label: '📋 Other' },
]

const LABEL_MAP: Record<string, string> = {
  bug: 'bug', feature: 'enhancement', question: 'question', other: '',
}

export default function ReportIssueDialog({ version, onClose }: Props) {
  const [title, setTitle]           = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps]           = useState('')
  const [category, setCategory]     = useState('bug')
  const [submitted, setSubmitted]   = useState(false)

  function handleSubmit() {
    if (!title.trim()) return

    const body = [
      description.trim() && `## Description\n${description.trim()}`,
      steps.trim()       && `## Steps to Reproduce\n${steps.trim()}`,
      `## Environment\n- App version: ${version}\n- Platform: Windows (Electron)`,
    ].filter(Boolean).join('\n\n')

    const label  = LABEL_MAP[category] ? `&labels=${encodeURIComponent(LABEL_MAP[category])}` : ''
    const ghUrl  = `https://github.com/abodan09/signage-manager/issues/new?title=${encodeURIComponent(title.trim())}&body=${encodeURIComponent(body)}${label}`

    window.electronAPI.openExternal(ghUrl)
    setSubmitted(true)
  }

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
        width: 480,
        maxHeight: '85vh',
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Report an Issue</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 18 }}
          >✕</button>
        </div>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <div style={{ fontWeight: 600 }}>GitHub opened in your browser</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Your report has been pre-filled. Review and click <strong>Submit new issue</strong> on GitHub to publish it.
            </div>
            <button
              onClick={onClose}
              style={{ marginTop: 8, padding: '9px 24px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary, #f1f5f9)', cursor: 'pointer', fontSize: 13 }}
            >Close</button>
          </div>
        ) : (
          <>
            {/* Category */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {CATEGORIES.map(c => (
                  <button
                    key={c.value}
                    onClick={() => setCategory(c.value)}
                    style={{
                      padding: '9px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                      border: category === c.value ? '1px solid #3b82f6' : '1px solid var(--border)',
                      background: category === c.value ? 'rgba(59,130,246,0.12)' : 'transparent',
                      color: 'var(--text-primary, #f1f5f9)', textAlign: 'left',
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                Title <span style={{ color: '#f87171' }}>*</span>
              </label>
              <input
                className="form-input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Brief summary of the issue…"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                Description
              </label>
              <textarea
                className="form-textarea"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What happened? What did you expect?"
              />
            </div>

            {/* Steps */}
            {category === 'bug' && (
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                  Steps to Reproduce
                </label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={steps}
                  onChange={e => setSteps(e.target.value)}
                  placeholder="1. Open the app&#10;2. Go to…&#10;3. Click…"
                />
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
              Clicking <strong>Open GitHub</strong> will open GitHub in your browser with the form pre-filled.
              Version <strong>{version}</strong> will be attached automatically.
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={onClose}
                style={{ padding: '9px 20px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!title.trim()}
                style={{
                  padding: '9px 20px', borderRadius: 6,
                  background: title.trim() ? '#3b82f6' : '#334155',
                  border: 'none', color: '#fff', fontWeight: 600, fontSize: 13,
                  cursor: title.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Open GitHub ↗
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
